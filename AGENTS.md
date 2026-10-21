# AGENTS.md — working on OneBrain

Read this first. It is the shortest path to making a correct change, for AI
coding agents and humans alike. System design: [ARCHITECTURE.md](ARCHITECTURE.md).
Frontend logic map: [frontend/lib/README.md](frontend/lib/README.md).
All other docs: [docs/README.md](docs/README.md).

## What this is

A voice-first assistant in the browser. Next.js 15 frontend (deployed to
Cloudflare Workers with OpenNext) plus a Cloudflare Workers API with D1 for
accounts and shared workspaces. It works with no key and no account, speaks
in the user's own English (or their language), and keeps data on the device
unless the user explicitly shares it.

## Repository map

| Path | What lives there |
|---|---|
| `frontend/app/` | Next.js routes. `app/api/*` are server route handlers (chat, speech/tts, geo, web proxy, media, utilities, Google sign-in, platform proxy). |
| `frontend/components/` | React UI, grouped by surface: `today/`, `voice/`, `track/`, `control/` (Your space panels), `settings/`, `features/` (feature cards), `workspace/`, `ui/`. |
| `frontend/hooks/` | `useAssistant.ts` (the voice session state machine), `useVoicePrint.ts`, `useLocale.ts`, `useBackgroundKeepalive.ts`. |
| `frontend/lib/` | All logic, pure and unit-tested, in domain folders: `core`, `locale`, `voice`, `ai`, `features`, `platform`, `server` (server-only), `storage`, `workspace`. |
| `frontend/store/` | Zustand stores: `assistant` (session, settings, messages), `features`, `media`, `workspace`. |
| `frontend/__tests__/` | Vitest unit tests (+ `helpers/`). `frontend/e2e/` Playwright browser tests. |
| `workers/api/` | The platform API Worker (Hono + D1): auth, spaces, records, jobs, connectors, plans. `migrations/` for D1. |
| `backend/` | Retired Express server; kept only for its integration test. Do not add features. |
| `scripts/` | Platform setup, capacity budget, deploy gates, entitlement key minting. |
| `docs/` | Setup guides, status ledger, roadmap; `docs/archive/` is history, not current truth. |

## Commands

```sh
# install (Node 22+)
npm --prefix frontend ci
(cd workers/api && npm ci)          # run inside the folder; --prefix fails here

# frontend
cd frontend
npm run dev                          # http://localhost:3000
npm run typecheck                    # tsc --noEmit
npm run lint                         # eslint .
npm test                             # vitest (unit, ~20 s)
npm run build                        # next build
npm run build:cloudflare             # OpenNext bundle, exactly what deploys
npm run test:e2e                     # Playwright; needs both local servers (docs/PLATFORM-SETUP.md)

# workers API
cd workers/api
npm run typecheck && npm test
npm run dev                          # wrangler dev on :8787 with local D1
```

Before you finish a change: typecheck, lint and unit tests must pass; run
`npm run build` for anything touching routes, config or imports.

## Where to change things

| Task | Start here |
|---|---|
| A new voice command or deterministic skill | `lib/features/feature-engine.ts` (router) + a pure module in `lib/features/`; add its phrases to `lib/features/intents.ts` |
| How the AI is prompted (rules, language, clock) | `lib/ai/prompt.ts`, `lib/ai/gemini.ts` (`SYSTEM`, `buildSystem`) |
| Which AI providers are tried, in what order | `lib/ai/brain.ts`; server side `app/api/chat/route.ts` |
| Listening (recognizer, end of sentence, barge-in) | `hooks/useAssistant.ts` → `lib/voice/transcript-gate.ts`, `barge-in.ts`, `commands.ts` |
| Speaking (voices, audio, iPhone unlock) | `hooks/useAssistant.ts` `speak()` → `lib/voice/tts.ts`, `speech.ts`, `audio.ts`; server `lib/server/tts-server.ts` |
| Languages, countries, accents, money/date formats | `lib/locale/` (`voice-languages.ts`, `countries.ts`, `format.ts`) |
| Settings (new preference) | `lib/core/types.ts` + `lib/storage/settings.ts` (default + normalise) + UI in `components/settings/` |
| Track tab (expenses, food, health, workouts) | `lib/features/track.ts`, `fitness.ts`; UI `components/track/` |
| Sign-in | `lib/server/google-auth-server.ts`, `app/api/auth/google/*`; Workers `workers/api/src/platform/google-auth.ts` |
| Plans and quotas | `lib/platform/plans.ts`, `entitlements.ts`; Workers `src/platform/entitlements.ts` |
| Shared workspaces / connectors / jobs | `workers/api/src/platform/*` (+ `migrations/` for schema) |

## Conventions

- **TypeScript strict.** Import app code through `@/` (`@/lib/voice/speech`);
  inside `lib/` relative imports are fine.
- **Pure first.** Put logic in `lib/` with no DOM/React; components, hooks
  and route handlers stay thin. Every pure module gets tests in `__tests__/`.
- **Comments explain why.** Each file opens with what it is for and any
  non-obvious constraint (iOS audio rules, provider limits, privacy). Keep
  that header accurate when you change behaviour.
- **Tests test behaviour, not source text.** No reading `.ts` files in tests.
  Locale-dependent tests use `useDevice()` / `useHinglishSpeaker()` from
  `__tests__/helpers/locale.ts`; every file starts on a pinned test device.
- **User-facing wording is English** and goes through the locale:
  - built-in spoken replies: `localized(english, hinglish)` from `lib/locale/active`;
  - money, dates, times, weights: `formatMoney`, `formatDate`, `formatTime`, `formatWeight` from `lib/locale/format`;
  - never hardcode `'en-IN'`, `₹`, `'INR'`, IST or Indian helplines — read `activeLocale()` (client) or pass the country explicitly (server).
- **India-only helpers** (station names, Devanagari transliteration, Indian
  rail, Hinglish phrasing) run only when `activeLocale().indian` /
  `.hinglish` is true. Recognition patterns may stay bilingual.
- **New setting values** must stay backward compatible; migrations bump
  `SETTINGS_VERSION` in `lib/storage/settings.ts`.

## Invariants (do not break)

1. **No silent uploads.** Local data reaches the server only after sign-in and
   an explicit save/approval. Vault contents never leave the device or reach AI.
2. **Never invent live facts.** Trains, flights, weather, prices, balances:
   fetched and attributed, or "I couldn't verify". No action claimed without a receipt.
3. **No host keys, no payments.** Never spend operator API keys for users;
   plans use operator-minted keys, no checkout.
4. **Server-only stays server-only.** `lib/server/*` is imported only from
   `app/api/*`. Browser code calls relative `/api/...` URLs only.
5. **Treat input as hostile.** Bound and validate request bodies
   (`lib/server/request-body.ts`), keep the `/api/web` SSRF guard, normalise
   stored settings, keep OAuth return paths same-site.
6. **Crisis support stays safe.** Only well-established helpline numbers go in
   `lib/locale/countries.ts`; unknown countries get findahelpline.com.
7. **iPhone audio rules.** Audio unlock runs synchronously inside the user's
   gesture (`lib/voice/audio.ts`); don't move it behind an `await`.

## Gotchas

- `npm run build:cloudflare` needs `--dangerouslyUseUnsupportedNextVersion`
  (already in the script): OpenNext refuses Next 15 two years after its release.
- The sandbox/CI has no access to Google or Cloudflare: live TTS, OAuth and
  provider health can't be verified there — say so instead of claiming it.
- Playwright needs the Workers API running with a local D1
  (`scripts/setup-platform.mjs`); see `docs/PLATFORM-SETUP.md`.
- Pushing to `main` deploys production. Work on a branch and open a PR.
