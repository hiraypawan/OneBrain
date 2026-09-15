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
   - the caller's own AI key (their quota, their plan) → natural speech with
     Indian-language support;
   - a keyless community audio model → sound for zero-setup users;
   - otherwise `{ fallback: true }`, and the client uses the browser voice.
   Host provider keys are never read, so hosting cost stays at zero.
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
4. **Audio unlock on first gesture** (`primeAudioOutputOnGesture`): one tap
   anywhere unlocks the shared element for the whole session, which is what iOS
   requires before later programmatic playback.
5. **Hardened browser-voice fallback** (`speakChunksWithBrowserVoice`):
   the `cancel()`/`speak()` race is no longer possible, `voice` and `lang` are
   always kept consistent, a stall is detected in 5 s and retried once with the
   engine default voice, and Chrome's long-speech pause is resumed.
6. **Honest reporting and a one-tap retry**: every outcome is logged as a
   `tts-*` background event, and when audio could not play the notice offers
   **Hear it**, which replays the prepared audio from a real tap (always allowed).
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

- Community-tier speech is a third-party service: quality and availability are
  not guaranteed, and offline use falls back to the browser voice.
- A pinned output device is honoured only where the browser supports
  `setSinkId` (Chromium). Everywhere else the OS decides.
- Reply language coverage depends on the provider; the browser voice still
  handles languages without a cloud voice installed.
- Audio is cached locally per reply text; cache clearing is part of normal
  site-data clearing.
- Physical-device matrix in [DEVICE-VALIDATION.md](DEVICE-VALIDATION.md) is
  still the reference for what has and has not been certified.
