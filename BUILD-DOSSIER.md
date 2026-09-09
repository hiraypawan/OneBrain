# OneBrain — What Was Built (Build Dossier, Sept 2026)

## 1. The idea in one paragraph
OneBrain is a mobile-first website that turns the earbuds you already own into a
Jarvis-style personal AI. Open the site, press **Active**, talk — answers come back
as voice in your earbuds. It remembers conversations, learns topics and routines,
fires reminders, recognizes your voice, and works in English, Hindi, Hinglish,
Marathi and other languages. No app install, no API key, no money required.

## 2. How it works (the loop)
```
You speak → phone mic → speech-to-text (free, on-device/browser)
        → AI brain chain (Puter → your Gemini key → Pollinations → offline)
        → reply split (your language + English) → scrubbed for speech
        → voice in earbuds (language-matched voice)
        → saved to memory (IndexedDB, synced to backend if configured)
```

## 3. AI brain chain (zero setup, best-effort order)
1. **Puter browser AI** (GPT/Qwen-class, keyless, your own fair-use quota)
2. **Gemini key** — yours (Settings) or host's (`GEMINI_API_KEY`), 4-model fallback chain
3. **Host OpenAI key** (optional, best quality)
4. **Pollinations keyless community API** (bare-shape requests; shared quota, peak limits)
5. **Offline smart replies** (never silent)

Every provider failure is logged; a rejected *user* key is spoken aloud as a
plain-language fix-it message instead of failing silently.

## 4. Voice system
- **Listen:** Web Speech API (free, continuous) in your Settings language
  (Hinglish/Hindi/English/Marathi); typed fallback everywhere; hold-to-talk button.
- **Noise discipline:** echo-cancellation + noise-suppression requested, <0.3
  confidence hearings (song lyrics/TV bleed) ignored, listening pauses while
  OneBrain itself speaks (no self-hear), mic auto-recovers if another device/app grabs it.
- **Speak:** replies scrubbed (no emojis/markdown/URLs read aloud, abbreviations
  expanded), language-matched TTS voice per script (Devanagari→Hindi/Marathi, etc.),
  cloud TTS if keys exist, browser voice otherwise — all routed to earbuds by the OS.
- **Speaker awareness:** on-device pitch profiles (autocorrelation DSP, no server).
  Enroll once in Settings; voices get male/female tags; strangers get flagged so
  group chatter never silently mixes into your answers.

## 5. Memory & learning
- Every chat persisted to IndexedDB (survives refresh/close); history list with
  re-open + delete; memory toggle that actually gates storage; GDPR export + wipe.
- Memory page: top topics, routine notes ("asks the time ~8pm"), active hours;
  timeline page: 14-day activity bars. Backend digest mirrors it for cloud accounts.
- Reminders: daily or one-time, fire notifications while open, auto-mark done.

## 6. Accounts & backend (all real, all tested)
- Backend: Express + TypeScript + **SQLite file DB** (no Docker/server to install).
- Real signup/login (validation + bcrypt), JWT sessions surviving refresh, logout,
  password-reset token flow, Google OAuth (activates with env keys), honest
  `/config` endpoint so the UI hides unconfigured options.
- Device-local SHA-256 accounts when no backend is configured.
- Backup/restore sync every 5 min, per-user conversations/messages/reminders/digest APIs.

## 7. Background, per platform (honest)
- **Android Chrome:** foreground full; minimized keeps listening minutes-long with
  persistent notification (Stop/Open actions, tap-resume); MediaSession earbud
  buttons; wake lock; black-screen battery page (/night); auto-recovery on return.
- **iPhone (any browser):** foreground full; background/lock behavior is
  device-dependent — observed working even locked on real iPhones (persistent
  audio session + PWA). The app's live 📡 indicator and Debug flight recorder
  always report the ground truth. A native app remains the only *guaranteed*
  lock-screen path.
- Multipoint earbuds (phone+laptop): disconnects detected, auto-reconnect ×3,
  user told what's happening. BT call-quality dip while mic is live is hardware law.

## 8. File map (where things live)
- `frontend/app/active/page.tsx` — voice screen (client-only, hydration-proof)
- `frontend/hooks/useAssistant.ts` — mic/AI/voice engine
- `frontend/hooks/useBackgroundKeepalive.ts` — suspend/resume tracking
- `frontend/lib/gemini.ts|puter.ts|speech.ts|voiceprint.ts|reminders.ts|digest.ts|background.ts|db.ts|sync.ts|localAuth.ts` — pure, tested logic
- `frontend/store/assistant.ts` — state (persisted prefs, session data)
- `frontend/public/sw.js` — offline cache + notification actions (prod)
- `backend/src/{db.ts,routes/*,middleware/*}` — SQLite API
- `run.bat` — double-click launcher (kills server on close)

## 9. Verification status
- Frontend + backend typecheck clean; **42/42 unit tests pass** (brain chain,
  speech scrub, pitch DSP, reminders, background states, keyless providers);
  12/12 frontend pages + backend auth→sync→digest chain tested live over HTTP.
- Not yet done by anyone: real-phone testing → see `PHONE-TEST.md`.
- Deliberately refused: geolocation keepalive (buys zero mic time, burns battery).

## 10. Run it
`run.bat` (frontend :3000). Backend optional: `cd backend && npm install`,
copy `.env.example` → `.env`, `npm run dev` (:5000), set
`NEXT_PUBLIC_API_URL=http://localhost:5000` in `frontend/.env.local`.
