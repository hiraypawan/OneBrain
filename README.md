# OneBrain — Context, capture, and reviewed action

> **Google-only authentication:** Account sign-up/sign-in now uses Google. See [secure setup steps](docs/GOOGLE-AUTH-SETUP.md) and [PR/release gates](docs/PR-RELEASE-GATES.md). Password login is retired; live Google configuration is still required.
> **Build status:** Neural Canvas, pocket voice, opt-in proactive conversation, local encrypted vault, utilities, and a real local D1-backed shared platform are implemented within the documented limits. **The full 175-item product scope is not complete.** See the [numbered requirement ledger](docs/IMPLEMENTATION-STATUS.md).
>
> Start the full stack with the [platform setup guide](docs/PLATFORM-SETUP.md). No production deployment, remote migration, paid API activation, or live connector authorization was performed.

## Working surfaces

- **`/` and `/active`:** black/amber context map, accessible list/Today/Activity views, local structured capture, explicit links, calculations, financial review, undo and export. Voice start/pause/resume/stop, Silent Mode, optional active-session wake phrase and recognition aliases.
- **Proactive conversation:** separately consented history topics and preference questions, at least 90 seconds of quiet, cooldown/session/day caps, quiet hours and snooze. No response is never consent.
- **`/operations`:** server accounts, shared workspaces and roles, linked records/projects/financial logs, reviewed imports, connector administration, exact approval hashes, leased scheduling, durable receipts, inbox and audits.
- **Shared voice capture:** explicitly select a workspace in Operations, then use `shared task: ...` or `server reminder: ...` in voice/Ask OneBrain. Review the destination and say **save shared**. Reminders remain drafts until separately approved; local records are never silently uploaded.
- **`/utilities`:** local calculations, units and dates, session-only timers/stopwatch, explicit source-linked FX/weather lookup. Live source requests failed with connection resets in this sandbox; successful live lookups remain unverified, and failures never produce invented values.
- **`/vault`:** password-derived AES-GCM local storage, lock on hide/inactivity, encrypted backup/restore. Not an audited password manager; no voice/AI secret entry.

Device-local records, server workspace records and encrypted vault entries are separate storage boundaries. General browser speech and optional AI may use external processors. Hosted APIs have quotas; **free unlimited service is not promised**. No automatic paid overflow or payment collection exists.

HTTP adapters exist for Calendar, Sheets, Gmail, Telegram, Slack, Todoist, Notion, HubSpot, Home Assistant, signed webhooks and a limited JSON-HTTP MCP transport. **Written adapters are not evidence of live authorization or successful delivery.** See the setup guide for exact supported actions and limits.

## Verification

- 183 frontend unit tests; 45 Workers tests; 29 production-browser tests pass.
- Next 15.5.25 production build and frontend/Workers/legacy Express TypeScript checks pass.
- Production dependency audits: zero reported vulnerabilities across all three packages. Frontend/Workers development tooling still has five findings each; this is not a completed security audit.
- Real phones/earbuds, live providers, production deployment, enterprise compliance, billing and the other unfinished requirements remain explicitly tracked.

```sh
npm --prefix frontend test
npm --prefix workers/api test
# Both local servers must be running for browser tests:
npm --prefix frontend run test:e2e
```

---
## Previous application documentation (historical capabilities; verify before relying on them)

# 🧠 OneBrain — Your Personal AI in Your Earbuds

**LIVE: https://onebrains.pages.dev** (HTTPS — works on iPhone + Android, installable PWA)
- App (Workers build): https://onebrain.pawanhiray88.workers.dev
- API: https://onebrain-api.pawanhiray88.workers.dev · Database: Cloudflare D1 (APAC)
- Custom domains (go live once handcricket.com nameservers point to Cloudflare):
  app → `onebrain.handcricket.com` · API → `api.handcricket.com`

Press **Active**, talk, and hear answers in your earbuds. No required install or API key for basic local features. Hosted AI availability and quotas vary.
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
- 🔒 **Private by design** — local export/delete controls; browser recognition may process audio remotely

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
The app does not intentionally retain raw audio; browser speech recognition may upload audio for processing. Conversations live in your browser
(IndexedDB) and, if you log in, in your own synced account. Settings →
Data export downloads everything; Delete everything wipes it.


### Current interface

**Today** is the main screen: save a thought, ask a question, start talking, and revisit your records. **Your space** is the second screen: find account controls, preferences, reminders, connected work, utilities, vault and conversation history in searchable panels. Old feature links redirect there.

See [UI design, feature locations and verification boundaries](docs/UI-DESIGN.md). This rework does not change the draft PR's incomplete-product or no-deployment status.
