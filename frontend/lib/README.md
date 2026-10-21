# frontend/lib — the app's logic

Everything here is plain TypeScript: no React, and (outside `server/`) safe
to run in the browser. Most modules are pure and have tests in
`frontend/__tests__/`. Components, `hooks/useAssistant.ts` and the
`app/api/*` route handlers are thin wiring around these modules.

Import with the alias: `import { formatMoney } from '@/lib/locale/format'`.

## Folders

| Folder | Responsibility | Depends on |
|---|---|---|
| `core/` | Shared types (`UserSettings`, messages, reminders) and tiny helpers. | nothing |
| `locale/` | Where the user is and how they talk: countries, voice languages, detection, formatting. | nothing |
| `voice/` | Speech in and out on the device: recognizer gate, barge-in, commands, voice choice, audio unlock, TTS client, platform capability notices. | `core`, `locale` |
| `ai/` | Talking to models: the provider chain, prompt building, context and memory recall, web facts. | `core`, `locale` |
| `features/` | What the assistant can do without guessing: the feature router and every skill. | everything above, stores |
| `platform/` | Client side of accounts and the server workspace: platform API client, plans, entitlements, sync. | `core` |
| `server/` | **Server-only** helpers for `app/api/*`: request limits, platform transport, Google sign-in, speech synthesis. | `core`, `locale` (pure files) |
| `storage/` | On-device persistence: IndexedDB, settings normalisation, vault. | `core`, `locale` |
| `workspace/` | Workspace records on the device: captures, validation, local answers. | `core`, `locale` |

Rules: `server/` is never imported by client code; `core/` and `locale/`'s
pure files (`countries`, `voice-languages`, `resolve`, `text-language`) import
nothing app-specific so they work everywhere, including route handlers.

## Modules

### core
- `types.ts` — app-wide types; add new settings here and in `storage/settings.ts`.
- `utils.ts` — `cn()` for Tailwind class names.

### locale
- `countries.ts` — per-country English variant, currency, units, emergency and crisis line; time zone → country.
- `voice-languages.ts` — the languages OneBrain listens/talks in (recognition tag, voice tag, reply language) and `auto` resolution.
- `resolve.ts` — settings + device signals → `ResolvedLocale` (pure).
- `detect.ts` — reads the browser's time zone and languages; optional `/api/geo` lookup.
- `active.ts` — the running app's locale (`activeLocale()`), `localized(en, hinglish)` for built-in replies.
- `format.ts` — `formatMoney`, `formatDate`, `formatTime`, `formatWeight`, `currencyFromText`.
- `text-language.ts` — which language a piece of text is in (script + common words).

### voice
- `transcript-gate.ts` — turns raw recognition results into one accepted utterance; waits for the end of the sentence.
- `barge-in.ts` — talking over the reply: stop, keep listening, resume from the sentence boundary.
- `commands.ts` — exact session/media commands (stop, pause, repeat, new chat, play/pause music).
- `speech.ts` — text cleanup for speech, `ttsLangFor` (which voice reads a text), `pickTtsVoice` (most natural installed voice), browser-voice playback.
- `speech-split.ts` — sentence-aware splitting for progressive speech.
- `tts.ts` — client for `/api/speech/tts` (real audio bytes, cached, tiered).
- `audio.ts` — mic/speaker devices, iPhone audio unlock and audio-session rules.
- `capabilities.ts` — platform/browser detection, Firefox/in-app notices, where to re-allow the mic.
- `environment.ts` — room loudness → end-of-speech timing.
- `voiceprint.ts` — pitch-based "is this the owner speaking" profiles (not authentication).
- `voice-input.ts` — wake phrase and recognition aliases.
- `pronunciation.ts`, `transliterate.ts` — India-only repairs: station names, Devanagari → Roman.
- `numbers.ts` — spoken numbers (English + Hindi words).
- `background.ts` — background/lock-screen state machine.

### ai
- `brain.ts` — the provider chain: facts → Puter (if connected) → `/api/chat` → offline.
- `chat-chain.ts` — attaches the user's locale (language, country, time zone) to every chat turn.
- `prompt.ts` — the system prompt for a turn: clock, understanding rules, reply language, units/money, length, context.
- `gemini.ts` — Gemini/Pollinations calls, `SYSTEM`, `buildSystem` (clock in the user's time zone), offline fallback.
- `openai-compatible.ts`, `puter.ts` — other providers (user key; Puter only when connected).
- `context.ts`, `context-envelope.ts`, `profile.ts`, `recall.ts`, `summarize.ts`, `digest.ts` — what the model knows about the user, within a budget.
- `knowledge.ts`, `websearch.ts` — Wikipedia facts and keyless live web search/reading.
- `personas.ts` — mentor modes (English tutor, gym coach…).

### features
- `feature-engine.ts` — the router every turn passes through before the AI.
- `intents.ts` — canonical phrases (hint chips and "did you mean…?"), tagged by audience.
- `fuzzy.ts` — recovering from one misheard word.
- Skills: `fitness.ts` (logging), `track.ts` (Track tab maths), `reminders.ts`, `todo.ts`, `briefing.ts`, `today-brief.ts`, `email.ts`, `translate.ts`, `story.ts`, `nightmind.ts` (night notes + crisis reply), `witness.ts` (safety mode), `workout.ts`, `research.ts`, `scribe.ts`, `media.ts`, `transit.ts` (India), `timetravel.ts`, `utilities.ts`, `space-search.ts`, `shared-voice.ts`, `connected-brief.ts`, `proactive.ts`.

### platform
- `platform.ts` — client for `/api/platform/*` (same-origin proxy).
- `plans.ts`, `entitlements.ts` — plan gates and who decided the plan.
- `sync.ts`, `session-hint.ts`, `auth-return.ts`, `localAuth.ts` — sync, sign-in presence and return paths.

### server (route handlers only)
- `request-body.ts` — bounded body reading and validation errors.
- `platform-server.ts` — transport to the Workers API (service binding or URL).
- `google-auth-server.ts` — Google sign-in start/callback helpers.
- `tts-server.ts` — speech synthesis: user-key tier and keyless Google read-aloud in the user's accent.

### storage
- `db.ts` — IndexedDB (Dexie) tables.
- `settings.ts` — defaults, normalisation and migrations (`SETTINGS_VERSION`).
- `vault.ts`, `vault-storage.ts` — the encrypted local vault.
- `janitor.ts` — keeps device storage bounded.

### workspace
- `model.ts` — captures, amounts, calculations, summaries, search.
- `validation.ts` — what a record may contain.
- `voice.ts` — local answers and capture drafts for typed/spoken lines on Today.
