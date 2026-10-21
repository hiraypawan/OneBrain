# OneBrain architecture

OneBrain is a voice-first personal assistant that runs in the browser (phone,
tablet or desktop) and needs no install, no account and no API key to start.
It listens, answers out loud, remembers what you allow on your device, and
can optionally share a workspace with other people through a server.

This page explains how the parts fit together. For "where do I change X?"
see [AGENTS.md](AGENTS.md); for the module-by-module map of the frontend
logic see [frontend/lib/README.md](frontend/lib/README.md).

## Runtime topology

```
 Browser (iPhone / Android / Mac / Windows)
 ├─ Next.js 15 app (React 18, Zustand stores, IndexedDB via Dexie)
 ├─ Web Speech API: SpeechRecognition (mic → text), speechSynthesis (fallback voice)
 └─ <audio> playback of real speech bytes
        │  HTTPS (same origin only)
        ▼
 https://onebrains.pages.dev  ── Cloudflare Pages alias (frontend/pages-deploy/_worker.js)
        │  service binding APP
        ▼
 Worker "onebrain"  ── the Next.js app built by OpenNext (frontend/, wrangler.jsonc)
 ├─ pages + static assets (ASSETS binding)
 ├─ app/api/* route handlers: chat, speech/tts, geo, web, media, utilities, auth
 └─ /api/platform/* → same-origin proxy (cookie stays httpOnly)
        │  service binding PLATFORM_API (private, no public URL)
        ▼
 Worker "onebrain-api"  ── workers/api (Hono app, routes in src/platform/*)
 ├─ D1 database "onebrain-db" (accounts, sessions, spaces, records, jobs, receipts, quotas)
 ├─ Google OAuth (PKCE), sessions, plans/entitlements and quota ledger
 ├─ connectors (Calendar, Gmail, Slack, Notion, …) behind explicit approvals
 └─ cron: leased job runner + maintenance
```

`backend/` is a retired Express server kept only for its integration test; no
deployed path uses it.

External services are all optional and keyless by default: Google's public
read-aloud voice for speech audio, Pollinations as a community chat model,
Wikipedia and scraped web search for facts, Puter only when a user connects
it, and the user's own Gemini/OpenAI-compatible key when they add one. Host
API keys are never spent on users' behalf.

## A voice turn, end to end

```
mic ─▶ SpeechRecognition (lang = locale.voice.recognition)
     ─▶ transcript-gate      (lib/voice)   accept/merge results into one utterance;
                                            wait for the end of the sentence, not silence
     ─▶ India-only repair     (lib/voice)   Devanagari→Roman, station names (locale.indian)
     ─▶ voice commands        (lib/voice)   stop / pause / repeat / new chat / media
     ─▶ feature router        (lib/features/feature-engine.ts)
          deterministic handlers first: logging, Track, reminders, translator,
          witness, workout, email drafts, stories, transit (India), research…
     ─▶ AI chain              (lib/ai/brain.ts)  only when no feature owns the turn
          facts (Wikipedia, live web) → Puter (if connected) → /api/chat
          (user key → community model) → offline answer
     ─▶ speak()               (hooks/useAssistant.ts)
          1. real audio bytes: /api/speech/tts (user key tier, then keyless
             Google read-aloud in the user's accent), played through <audio>
          2. fallback: the browser's speechSynthesis with the most natural
             installed voice for the language (lib/voice/speech.ts)
```

The React hook `hooks/useAssistant.ts` owns the session state machine (start,
listen, think, speak, barge-in, recover after background/lock); everything it
calls is a pure module in `frontend/lib/` with unit tests.

## Locale: who is talking, from where

`frontend/lib/locale/` decides how OneBrain listens, talks and formats for
each user. Detection needs no permission prompt:

1. **Country** — an explicit Settings choice, else the device time zone
   (`Europe/London` → GB; VPNs don't change it), else the network country
   from `/api/geo` (Cloudflare's `CF-IPCountry`, fetched only when the zone is
   unknown, cached a week), else the browser language region.
2. **Language** — Settings, or `auto`: English stays English in the country's
   accent (en-GB, en-US, en-AU, en-CA, en-IN, …); a supported device language
   (Spanish, French, German, Japanese, …) is used as is; anything else falls
   back to English, the product's primary language.

The resolved locale drives the recognizer language, the reply language rule
and spelling in the prompt, the user's clock and time zone, units and money,
the browser voice and read-aloud accent, crisis helplines, built-in replies
(English, or Hinglish for Hinglish speakers) and which India-only helpers run.
Client code reads it through `activeLocale()` / `useLocale()`; the chat
request carries `language`, `country` and `timeZone`, which the server
validates before building the prompt.

Prerendered HTML cannot know any of this (or the device's clock), so
components render locale- and clock-dependent text only after hydration:
`useLocale()` returns a neutral locale and `useNow()` returns null until then.

## Data and privacy boundaries

| Where | What | Notes |
|---|---|---|
| Device (IndexedDB, `lib/storage/db.ts`) | conversations, memory, reminders, workspace items, fitness/expense logs, drafts | The default. Nothing uploads without an explicit action. Memory can be paused. |
| Device (`localStorage`) | settings, the user's own AI key, device choices, cached plan and geo hint | Settings are normalised on every read (`lib/storage/settings.ts`). |
| Device vault (`lib/storage/vault*.ts`) | secrets the user stores | Password-derived AES-GCM; never searched, never sent to AI. |
| Server (D1 via `onebrain-api`) | accounts, shared spaces, records, jobs, receipts, quotas | Only after Google sign-in and an explicit save/approval. |
| Third parties | speech recognition (browser vendor), reply text to the TTS/AI provider in use | Stated in the UI; keyless tiers first, user keys only when added. |

## Key design rules

- **Honest by construction.** Live data (trains, weather, prices, flights) is
  either fetched and labelled with its source, or the answer says it could
  not be verified. Nothing is invented, and no action is claimed without a
  receipt.
- **Pure core, thin shells.** Logic lives in `frontend/lib/**` as pure,
  unit-tested functions. React components, the hook and route handlers only
  wire inputs and outputs.
- **Server-only code stays server-side.** `frontend/lib/server/*` is imported
  only by `app/api/*` route handlers.
- **Untrusted input everywhere.** Request bodies are size-bounded and
  validated; stored settings are normalised; the web proxy blocks private
  addresses; OAuth uses PKCE and same-site return paths.
- **No payments.** Plans are enforced server-side with operator-minted keys;
  there is no checkout, invoice or renewal anywhere.

## Build, test and deploy

- **Unit tests**: Vitest (`frontend/__tests__`, `workers/api/__tests__`). The
  test setup pins a locale "device" so results never depend on the machine.
- **Browser tests**: Playwright (`frontend/e2e`, Chromium in CI); a
  cross-browser compatibility matrix runs on demand.
- **CI** (`.github/workflows/ci.yml`): audits, unit tests, lint, build,
  typecheck and the browser suite for the frontend; typecheck and tests for
  the Workers API and the legacy backend.
- **Deploy** (`.github/workflows/deploy-cloudflare.yml`, on push to `main`):
  apply D1 migrations, publish `onebrain-api`, provision sign-in secrets,
  build with OpenNext, publish the `onebrain` Worker and the Pages alias, then
  verify the live site serves HTML and CSS.
