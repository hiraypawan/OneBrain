# Spoken replies: why they were text-only, and what changed

## The symptom

Ask OneBrain a question on a phone, tablet or laptop, in any output setup —
phone speaker, Bluetooth neckband, earbuds, desk speaker — and the answer
appeared as text with no audio. Nothing reported an error.

## Root cause

Spoken replies depended entirely on `window.speechSynthesis` (the browser voice).

That API is the single least dependable audio path on the platforms this app is
used on:

| Platform | What actually happens |
|---|---|
| iOS Safari / iPhone | Refuses to start without a *fresh* user gesture. Any reply produced after a network round-trip is silently dropped. Replies inside an installed PWA are worse. |
| Android Chrome | `getVoices()` often returns an empty list, so no voice is selected; some engines swallow the utterance without firing `start` or `error`. |
| Chrome / Edge on Windows & macOS | Usually works, but `cancel()` called immediately before `speak()` can swallow the utterance, and long replies stop mid-sentence. |
| All platforms | It cannot be routed. `setSinkId` does not apply to `speechSynthesis`, so the app could never direct speech to a chosen neckband — only the OS default decided. |

So "just text" was not one broken device setting: the only audio path available
was the one most likely to fail quietly.

## What changed

Replies are now **real audio bytes played through an `<audio>` element**, with
the browser voice kept only as a fallback.

1. **Provider chain — `POST /api/speech/tts`** (`frontend/app/api/speech/tts/route.ts`,
   helpers in `frontend/lib/tts-server.ts`):
   - the caller's own Gemini key (their quota, their plan) → natural speech with
     Indian-language support;
   - a keyless read-aloud voice (Google Translate's public text-to-speech:
     English with an Indian accent via `translate.google.co.in`, Hindi,
     Marathi, Bengali, Gujarati, Punjabi, Tamil, Telugu, Kannada, Malayalam,
     Urdu and more) → sound for zero-setup users. Text goes out in ≤180-character
     pieces (the endpoint's limit is 200), fetched three at a time and joined
     in order; a blocked request falls back to the `batchexecute` RPC that gTTS
     uses; any missing piece returns the whole reply to the browser voice;
   - otherwise `{ fallback: true }`, and the client uses the browser voice.
   Each tier has a time budget (user key 12 s, keyless 7 s) inside the
   client's own timeout, and the client asks for each tier once (`tier:
   "user"` / `"keyless"`), so a slow key is never paid for twice.
   Host provider keys are never read, so hosting cost stays at zero.
   *(Until 2026-10-21 the keyless tier was Pollinations `openai-audio`, which
   was withdrawn upstream — "Model not found" — so every zero-setup reply had
   silently dropped to the browser voice.)*
2. **Client audio engine** (`frontend/lib/tts.ts`, `frontend/lib/audio.ts`):
   audio is cached in Cache Storage by text+language, played through one shared
   `<audio>` element, published to the Media Session (lock screen, headset
   buttons), and pinned with `setSinkId` only when the user explicitly pins a
   device.
3. **Automatic output detection** (`startOutputRouting`, `activeSinkId`):
   outputs are listed on load and re-resolved on every `devicechange` and tab
   focus. The system default — where the neckband, earbuds or speaker already
   are — is used with nothing to configure. On Chromium the reply is routed
   through `setSinkId`; on iOS/Safari the system alone decides, and it already
   plays through the connected Bluetooth device.
4. **Audio unlock on real gestures** (`unlockAudioOutput`,
   `primeAudioOutputOnGesture`). iOS WebKit *drops* `speechSynthesis.speak()` —
   no event, nothing queued — until one `speak()` has run **during** a user
   gesture (`SpeechSynthesis::speak`, `RequireUserGestureForSpeechStart`), and
   the `<audio>` element needs `play()` *called* inside a gesture once. The
   unlock primes the speech engine and calls `play()` **synchronously** in the
   handler (never after an `await`), listens only to activation-triggering
   events (`click`, `touchend`, `pointerup` for touch/pen, `keydown`,
   `mousedown` — a touch `pointerdown` does not count), and keeps trying on
   later taps until both are confirmed. *(Before 2026-10-21 the engine was
   primed after `await el.play()` and only on the first `pointerdown`, so on
   iPhone it was never unlocked: "Speech was queued but never started".)*
   A playing reply is never paused or replaced by an unlock.
5. **Hardened browser-voice fallback** (`speakChunksWithBrowserVoice`):
   the engine is cancelled only when it is actually busy (and then given time
   to settle), `voice` and `lang` are always kept consistent — with the engine's
   exact tag (`en-IN`, not `en-in`) — a stall is detected in 5 s and retried
   once with the engine default voice, and Chrome's long-speech pause is
   resumed. On iPhone/iPad the recognizer is closed while the built-in voice
   talks (iOS turns "system speech" down while the mic is open), and when
   nothing is capturing a `playback` audio session is requested (iOS 17+) so
   the Ring/Silent switch does not mute it; a one-time tip mentions Silent mode.
   Whatever the audio voice could not finish is spoken by the browser voice
   (never the already-heard part again), so a partial outage is not silence.
   Replies are fetched progressively: a short first piece (≤220 characters)
   so the first words come quickly, then ≤900-character pieces fetched while
   the previous one plays.
6. **Automated browsers are skipped deliberately**: headless/WebDriver sessions have no audio device and must not send reply text to a provider, so they go straight to the browser voice (`navigator.webdriver`). An operator can force the same with `NEXT_PUBLIC_ENABLE_CLOUD_SPEECH=0`.
7. **Honest reporting and a one-tap retry**: every outcome is logged as a
   `tts-*` background event, and when audio could not play the notice offers
   **Hear it** ("Say that again" / "Play it now" on the voice screen). It is
   available for every reply — not only when audio was cached — and unlocks
   sound inside the tap before replaying the cached audio (when it covers the
   whole reply) or speaking the reply again.
   Silent Mode keeps its explicit "text only" notice.

## What to verify on a real device

1. Connect the neckband/earbuds **before** asking a question.
2. Ask by voice and by typing. All four steps must hold:
   speech → transcript → answer → **audible reply**.
3. Disconnect the earbuds mid-session and ask again: audio must move to the
   phone speaker. Reconnect and ask again: it must move back.
4. Lock the screen during a reply; the lock screen should show OneBrain as the
   media source.
5. iPhone/iPad: audio follows the system output; the in-app picker is only a
   pin, not a requirement.
6. With no network, the reply must still be spoken (browser voice fallback) and
   the notice must say why.

Silent Mode remains the deliberate exception: it stays text-only by design, and
says so out loud on screen.

## Limits

- The keyless read-aloud voice is an unofficial third-party endpoint: quality
  and availability are not guaranteed (Google may rate-limit shared server
  addresses), and offline use falls back to the browser voice. A user's own
  Gemini key is the dependable natural-voice option.
- On iPhone, the built-in voice can still be quiet or on the earpiece while a
  voice session holds the microphone; the read-aloud audio path does not have
  that problem, which is why it is tried first.
- A pinned output device is honoured only where the browser supports
  `setSinkId` (Chromium). Everywhere else the OS decides.
- Reply language coverage depends on the provider; the browser voice still
  handles languages without a cloud voice installed.
- Audio is cached locally per reply text; cache clearing is part of normal
  site-data clearing.
- Physical-device matrix in [DEVICE-VALIDATION.md](DEVICE-VALIDATION.md) is
  still the reference for what has and has not been certified.
