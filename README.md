# 🧠 OneBrain — Your Personal AI in Your Earbuds

**LIVE: https://onebrains.pages.dev** (HTTPS — works on iPhone + Android, installable PWA)
- App (Workers build): https://onebrain.pawanhiray88.workers.dev
- API: https://onebrain-api.pawanhiray88.workers.dev · Database: Cloudflare D1 (APAC)
- Custom domains (go live once handcricket.com nameservers point to Cloudflare):
  app → `onebrain.handcricket.com` · API → `api.handcricket.com`

Press **Active**, talk, and hear answers in your earbuds. No install, no API key, no cost.
Works in English, Hindi, Hinglish, Marathi — and 10+ more scripts.

## What it does
- 🎤 **Voice-first chat** — continuous listening, hands-free replies in your earbuds
- 🧠 **Memory that answers** — every chat is remembered; the AI recalls your old
  topics, routines and summaries when replying (keyword recall + rolling summaries)
- 🌍 **Bilingual replies** — answers in your language plus a short English version
- 🗣️ **Right voice, right language** — Marathi answers in a Marathi voice, etc.
- 🎙️ **Speaker awareness** — enroll your voice once; strangers nearby get tagged
  (male/female) or ignored, never silently mixed into your answers
- 🎵 **Free music, podcasts & videos** — "play kesariya" searches keyless sources,
  no accounts, no keys, with a mini-player
- 🔔 **Reminders** — daily or one-time, spoken confirmation, fire notifications
- 📰 **Live facts** — Wikipedia layer answers current-affairs questions keylessly
- 🎧 **Bluetooth coexistence** — pin mic/speaker per device, auto-reconnects,
  hands the mic back to other apps instantly
- 📴 **Offline mode** — queues and smart-replies without internet
- 🔒 **Private by design** — raw audio never leaves your phone; one-click export/delete

## Who it's for (use cases)
- **Commuters** — train times, traffic sense, hold-to-talk without looking at the phone
- **Students** — maths solved step-by-step, meanings, exam facts, spoken aloud
- **Homemakers & multitaskers** — reminders, timers-by-voice, hands busy, ears free
- **Seniors** — big targets, one-tap Active, patient voice, no typing needed
- **Visually impaired users** — fully operable by voice + earbud buttons
- **Language learners** — ask in Hinglish, read the English version below every answer
- **Night-shift / safety** — witness-style companion talk, emergency-ready design
- **Curious minds** — current events, contestants, capitals, scores — answered live

## How it works (30 seconds)
1. Open the site on your phone, allow the mic
2. Connect Bluetooth earbuds (phone settings)
3. Press **Active** → speak → hear the answer in your earbuds
4. Earbud buttons: play/pause = start/stop, next = repeat answer

## Brain chain (zero setup, automatic per question)
Puter browser AI → your Gemini key (optional, best quality) → live Wikipedia
facts → Pollinations keyless → offline smart replies. First success wins.

## Run it locally
```bash
# Frontend (http://localhost:3000) — or just double-click run.bat
cd frontend
npm install
cp .env.example .env.local
npm run dev

# Backend (http://localhost:5000) — real accounts + cloud sync, zero infra
cd ../backend
npm install              # express, bcryptjs... (node:sqlite is built into Node 24)
cp .env.example .env     # set JWT_SECRET; Google/SMTP optional
npm run dev              # data/onebrain.db is created automatically
```
Set `NEXT_PUBLIC_API_URL=http://localhost:5000` in `frontend/.env.local` to use
the backend. Without it, the app runs device-local (IndexedDB accounts + storage).

## Free AI — zero setup (default)
Out of the box, OneBrain answers via built-in keyless providers — no key needed
from you or your users: Puter browser AI, live Wikipedia facts, Pollinations
fallback, offline replies. Shared/fair-use: fine for real use, occasionally
limited at peak.

## Optional: your own Gemini key (best quality)
Each user pastes a free key (aistudio.google.com → Get API key, ~1 min) in
Settings → AI key, or hosts set `GEMINI_API_KEY`. Chain per question:
Puter → Gemini key → host `OPENAI_API_KEY` → Pollinations → offline.

## Bluetooth multipoint & background music
- **Earbuds on 2 devices:** disconnects detected, auto-reconnect ×3 with notices.
- **Music/YouTube alongside:** echo-cancellation + noise-suppression, lyric-bleed
  ignored, listening pauses while OneBrain speaks, 🎙 Hold to talk minimizes
  call-quality dips (Bluetooth hardware law while any mic is live).
- **Lock screen:** varies by device — observed working locked on real iPhones;
  the app's 📡 line + Debug flight recorder always show the live truth.

## Deploy (Cloudflare)
- Push to `main` → GitHub Actions auto-deploys frontend (onebrains.pages.dev)
  + API worker. Needs repo secret `CLOUDFLARE_API_TOKEN`.
- Manual: `cd frontend && npx opennextjs-cloudflare build && npx opennextjs-cloudflare deploy`;
  `cd workers/api && npx wrangler deploy`.

## Privacy
Raw audio never stored or uploaded. Conversations live in your browser
(IndexedDB) and, if you log in, in your own synced account. Settings →
Data export downloads everything; Delete everything wipes it.
