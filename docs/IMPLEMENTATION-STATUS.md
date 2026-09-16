# OneBrain implementation status

> **Google-only authentication update (2026-09-11):** Password/local account login and legacy JWT OAuth are retired. Follow [Google setup](GOOGLE-AUTH-SETUP.md) and [PR gates](PR-RELEASE-GATES.md). Sign-in requires private, environment-specific operator OAuth configuration; the full live Google consent/sign-in flow is not verified. Prior password/authentication descriptions below are historical where they conflict with this update.
> **Entitlements and media update (2026-09-15):** Server-side plans and quota ledgers now decide Pro/Family access (no payments, no checkout; keys are operator-minted). Music and podcast playback was revived as an opt-in panel, which **reverses row 170**; that reversal needs maintainer sign-off and its keyless third-party sources were not reachable from the build sandbox, so live playback is unproven. See [free-tier capacity](FREE-TIER-CAPACITY.md) and [platform setup](PLATFORM-SETUP.md).

Updated 2026-09-16 (previous revisions 2026-09-15 and 2026-09-11). **Full 175/175 completion has not been reached.** The additional proactive-conversation requirement is retained as row 176. This ledger separates working code, bounded implementations, live verification and unfinished software; nothing marked incomplete has been removed from scope.

## Current implemented paths

- **Two-screen UI rework → five-tab shell (2026-09-16):** Today stayed the first-use capture/answer screen, and the navigation became **Today · Voice · Track · Space · You** (`components/AppHeader.tsx`), reusing the existing mobile bottom-bar CSS with 44 px targets, `aria-current="page"` and prefix-based highlighting so old URLs still light the right tab. `/voice` is the full-screen listening surface, `/track` is the logged-life tab, `/you` is the preferences summary. Your space is now four grouped sections behind one search box instead of a fifteen-tile wall, and retired `?panel=` routes redirect. **The 1,541-line `components/workspace/NeuralWorkspace.tsx` was not rewritten** — the promised “calm brief” rebuild of Today is still open; only its navigation and CSS ownership changed. Decorative demo widgets (`gooey-nav`, `gravity-letters`, `fluid-orb`, `notification-bell`) were deleted with their styles, and the added UI shares one stylesheet (`app/shell.css`). The `theme` preference gained a real control (Your space → Advanced, **Dark** or **Light (beta)**) after having neither a switch nor a consumer; nothing claims the light palette is fully reviewed. Old feature URLs redirect to their panel. See [design decisions and verification limits](UI-DESIGN.md). Public Appllama skills informed the rework; MCP access was unavailable.
- **Logged-life surfaces over one store (2026-09-16):** Track reads the same `fitnessLogs` Dexie table the Fitness panel writes — no parallel database. `lib/track.ts` owns ranges (day/week/month, anchored in the URL), the deterministic expense-category classifier, budget status/pace, per-day bar series, meal bucketing and the CSV format shared with Your space → Fitness; `components/track/*` renders the four lenses and quick log forms. Monthly budget and daily goals live in `db.kv` under `track:goals`. Every figure is derived from user-made logs: empty windows say so, calorie values stay `≈` and non-medical, and there is no purchase, sync or “we checked your calendar” claim anywhere in the copy. Deterministic voice answers now carry a “View in Track →” deep link (`kind: 'track'` feature card).
- **One To-Do, three homes (2026-09-16):** `lib/todo.ts` merges canvas `task:` items, reminders and (only after an explicit click) shared server task records into one list with due state, inferred priority (stored as a machine line on the canvas item, not a new column), dedupe across origins and write-back to whichever origin owns a row; a shared record is deliberately **not** toggled from here because it needs its revision. `lib/space-search.ts` gives Your space one ranked query box across notes, tasks, decisions, conversations, messages, stories, drafts, the log and the catalog — vault contents are never searched.
- **Context envelope, rolling summary and intent recovery (2026-09-16):** `lib/context-envelope.ts` builds a token-budgeted block (open tasks → reminders → recent log → rolling conversation summary → saved conversation titles → already-loaded server note), truncates by priority and reports what was left out on the answer line; the block is presented to providers as untrusted user data that may not be used as instructions, and the “never claim to have checked a calendar” guard is part of it. The every-20-user-message summary was replaced by `rollingSummaryStep` (6-turn window or 2,400 un-summarized characters, throttled to 30 s). `lib/fuzzy.ts` + `lib/intents.ts` add “did you mean…?” recovery that only runs a canonical phrase after an explicit yes (2-minute expiry, cancelled by any other utterance), never for sentences another path already owns (session, media, reminder grammar) — enforced by a unit test that replays every transcript the Playwright specs type. Embedding-based recall is **still not implemented** (needs a vector-store decision).

- **Server-side entitlements:** a plan row plus a per-feature quota ledger in D1 (migration 0008) decide Free/Pro/Family. Quotas are consumed atomically server-side, `/me` stays a single-read identity+plan call, and usage arrives with `/bootstrap` and `GET /entitlements`. Keys are minted by the operator (`scripts/mint-entitlement-keys.mjs`), stored hashed, and shown once. **No payment, checkout, invoice or renewal path exists**, and the client cannot mint its own plan: the former in-bundle `mintBetaKey` was removed from `lib/plans.ts`. When the server cannot be reached the client keeps the last confirmed plan for 24 hours, marks it unverified, and never silently upgrades or downgrades. Translator minutes remain device-counted because sessions are device-local; the server ledger counts research, email, scribe and story.
- **Music and podcast playback (reintroduced, opt-in):** a single sticky player mounted in the root layout, driven by `store/media.ts`, reachable by voice (“play kesariya”, “gaana band”, “next song”) or from Your space → Music. Search fans out to keyless community sources (JioSaavn search, Apple podcast directory + show RSS, public Invidious instances) with bounded parallel timeouts; failures auto-advance and are announced plainly, and a YouTube search hand-off is offered when nothing streams. This reverses row 170 and is not live-verified.
- **Logged-data voice recall (2026-09-16):** questions about logged expenses/food/fitness over date ranges (“what expenses did I do yesterday”, “kal kitna kharcha”, “how much did I spend this week”) are answered deterministically from the on-device log — offline, never guessed. Recent log entries are also injected into AI context, which previously never saw them. Plain log statements (“kharcha 200 chai”) still log; empty ranges answer honestly and teach the log phrase.
- **Interface clarity:** the Today hint line became grouped, tappable “try one of these” phrases that run the real transcript path; jargon labels were replaced (“Pocket mode” → “Screen-off mode”, “Dark screen” → “Screen off”, “Evidence, not just done” → “What you actually did”); Music is a searchable catalog entry; and plan surfaces state who decided the plan (server, device-beta or nothing) with matching local/server badges. Strings asserted by the browser suite are pinned by `frontend/__tests__/ui-clarity.test.ts`.
- Neural Canvas, local structured/linked capture, financial review, undo/export, responsive accessible controls and opt-in proactive conversation.
- Discoverable Google sign-in and a unified Account / Voice & conversation / Memory & privacy / Advanced settings interface, including restyled export and diagnostics. Shared quick-setting controls, server-confirmed account states, failure-aware sign-out, transactional local database deletion and explicit microphone-only enrollment.
- Pocket voice start/pause/resume/stop, optional active-session wake phrase, recognition aliases, Silent Mode and resource/cancellation guards. Real physical-device behavior is not certified.
- Real D1-backed shared accounts/spaces/RBAC, records/assignees/dependencies/financial fields, compare-and-swap edits, atomic reviewed linked imports and database allowance guards.
- Operations UI, encrypted connector credentials and supported HTTP adapters, exact review/approval hashes, leased execution, bounded recurrence, durable inbox/receipts/audit and safe ambiguous-outcome handling.
- Explicit shared voice commands with named destination and “save shared” confirmation. Server reminders remain drafts until separately approved in Operations. No implicit upload of local memories.
- Deterministic utilities, explicit source-linked FX/weather requests, and an at-rest encrypted local vault with lock/backup/restore. No secret voice entry.

## Latest verification

**Current audit:** [2026-09-11 functionality, data-safety and compatibility report](AUDIT-2026-09-11.md). It records concrete fixes, strengthened browser tests, cross-engine evidence and remaining incomplete work.

- **664 frontend unit tests (56 files) and 88 Workers tests pass locally (2026-09-16)**, covering the Track engine, the unified To-Do merge, space search, the context envelope, the rolling-summary policy and the “did you mean” gate; the five-tab shell and no-dead-link guarantees are pinned by `__tests__/shell-ux.test.ts`, and the renamed nav/panel strings were updated deliberately in `ui-clarity`, `product-flow`, `settings` and `refinement`. The new browser specs ran in CI (no browser binaries here). The first run failed nine specs: four were genuine defects — the five-tab bar used `Link prefetch={false}`, so leaving Today kept the third-party provider script and a pending microphone prompt behind; `?panel=constructor` found `Object.prototype.constructor`; a retired `?panel=track` URL reported “not found” instead of redirecting to the tab; and the unified To-Do opened on a dated view that hid an undated task. All four are fixed with source-level guards, the “expenses findable in under ten seconds on a 390 px viewport” bar now **passes in CI**, and the remaining five specs were corrected to assert what the app promises (per-test context, real labels, real history behaviour). The third run left one failure — finishing a task removed it from “All open” while `groupTodo` skipped done rows, so the Done view listed nothing; that is fixed with a unit guard. Latest browser state on this branch: **69 of 70 specs pass, including the “expense under ten seconds on a 390 px viewport” acceptance bar** — and the suite is the thing that found all six defects, which no unit test could see. A green run after the final fix is still required before merge. The earlier run of this date recorded **553 frontend unit tests**, including the new expense-recall, fitness-context and brain-provider suites on top of the media-store, media-wiring, entitlements (worker + client) and UI-clarity suites; the Next production build, frontend/Workers TypeScript checks and ESLint are clean. Browser and compatibility counts above are from the last CI run and were **not re-executed** in this sandbox (no browser binaries, no network egress); they must be re-run in CI before release. The compatibility matrix covers Chromium, Firefox and WebKit with desktop/phone/tablet profiles, not physical-device certification. Desktop/mobile Operations and vault screenshots were reviewed with no page errors. Browser flows include explicit pause/resume, shared voice records/reminder drafts, persisted financial edits, approval-to-inbox delivery, reviewed linked import, mobile errors and vault isolation.
- **Next 15.5.25 production build** passes, including the two-screen UI and compatibility redirects into Your space. Frontend, Workers and legacy Express TypeScript checks pass. Express was typechecked, not used as the new shared-platform runtime.
- Full dependency audits, including development tooling: **0 findings** for frontend, Workers and Express on the audit date. This is not an independent application-security audit.
- Settings browser coverage includes 320px navigation, persisted preferences, cached-profile rejection, sign-out failures and all-session confirmation, exports/deletion confirmation, SDK document isolation, optional-key safeguards and cancelled/late microphone enrollment. Server identity tests use local fixtures, not real Google consent.
- Migrations 0001–0008 applied to local D1 only (0008 adds `entitlements`, `entitlement_keys` and `entitlement_usage`). The local API and browser-independent development scheduler run separately from Next. CI now initializes and starts the real local API for browser tests.
- Source documentation for MET Norway/Frankfurter was checked. Actual source smoke requests returned connection resets/502 in this sandbox; no forecast or exchange rate was invented. Successful live lookups remain unverified.
- No live third-party authorization, production deployment, remote migration, payment activation, repository visibility change, compliance certification or hardware verification was performed.

## Setup and limitations

Follow [PLATFORM-SETUP.md](PLATFORM-SETUP.md) for the runnable stack, environment variables, connector action list, quotas, scheduling semantics, security boundaries and deployment gates. Historical deployment addresses do not identify this branch's preview.

Important: new Google accounts require verified ID-token email claims; legacy account linking is deliberately blocked pending review; SSO/SAML, comprehensive legacy-auth auditing, tenant retention/residency/offboarding, complete workflow extraction, billing/entitlements/analytics and several personal-assistant workflows are unfinished software. Provider authorization, actual phone/earbud behavior, production operations and user/compliance studies require separate external verification. Adapters and mock tests do not substitute for these checks.

The vault is at-rest encryption, not an audited password manager. Local canvas data and server records are not end-to-end encrypted. Speech may use a remote browser processor. Explicit local links are not automatic semantic memory. Server receipts do not promise universal exactly-once external execution or a real-time reminder SLA.

## Full requirement ledger

Status: **Implemented** = functional within the stated local scope; **Partial** = some elements exist but the full requirement is unfinished; **Not implemented** = no working implementation; **External verification** = cannot honestly claim completion from repository changes alone.

| # | Requirement | Status / boundary |
|---:|---|---|
| 1 | Voice-first capture, context and approved actions | Partial — local and explicitly reviewed shared voice capture; reminder drafts and server approval/execution; general cross-app voice planning incomplete |
| 2 | Individuals, businesses and shared teams | Partial — real individual/shared workspaces and RBAC; enterprise features incomplete |
| 3 | Phone-and-earbud Pocket Mode | Partial — device testing remains |
| 4 | Direct, concise tone | Implemented — revised provider instructions and deterministic responses |
| 5 | Quiet by default and optional reminders/briefings | Partial — updated to opt-in proactive mode; scheduled briefings absent |
| 6 | Honest saved/queued/completed/failed/unverified status | Implemented for supported local/server operations — durable receipts distinguish acceptance, verification, failure and unknown outcomes |
| 7 | Free integrations within documented allowances | Partial — bounded adapters and no paid overflow; no live authorization or unlimited-provider guarantee |
| 8 | Exportable data and revocable connections | Partial — local/server exports and connector revocation; full tenant offboarding absent |
| 9 | Neural Canvas home | Implemented — explicit context map |
| 10 | Remove primary orb/avatar/chat bubbles | Implemented — home and active routes |
| 11 | True-black background | Implemented |
| 12 | Amber primary styling | Implemented |
| 13 | Silver completed/inactive styling | Implemented |
| 14 | Reserved error/overdue red | Partial — new workspace errors; legacy pages remain |
| 15 | Consistent readable system typography | Implemented — new workspace |
| 16 | Connected typed data nodes | Implemented — explicit relationships |
| 17 | Map updates from saved records | Implemented |
| 18 | Context panel on node selection | Implemented |
| 19 | Map zoom/pan/filter/focus | Partial — scroll, zoom, filters and selection; no custom pinch/pan engine |
| 20 | Stable node placement | Partial — chronological positions; filter/deletion reflows |
| 21 | Optional subtle motion/reduced motion | Implemented — no continuous canvas animation; reduced-motion CSS |
| 22 | Stop hidden/pocket animation | Implemented — no continuous renderer; Pocket Mode hides canvas |
| 23 | Accessible list/search alternative | Implemented |
| 24 | Typed fallback | Implemented |
| 25 | Brief response captions without bubbles | Implemented |
| 26 | Persistent action/response history | Implemented for supported records/actions — local history and durable server receipts/audit |
| 27 | Accessible settings overlay | Partial — visible button, context menu and native modal; touch-long-press not added |
| 28 | Accessible mic/privacy/account controls | Implemented — workspace and linked settings |
| 29 | Screen reader/keyboard/contrast support | Partial — semantic controls and focus; formal audit not complete |
| 30 | Empty/loading/offline/permission/error states | Partial — local errors and voice diagnostics; full offline UX incomplete |
| 31 | Start/pause/resume/stop Pocket Mode | Implemented — explicit pause releases microphone; resume starts capture again; hardware validation outstanding |
| 32 | Minimal listening/speech indicator | Partial — state indicator; no live amplitude display |
| 33 | Accurate detailed voice states | Partial — speech/error/listening; reconnect remains legacy notices |
| 34 | Short spoken confirmations | Implemented |
| 35 | Interrupt/cancel/correct | Partial — stop/cancel and local record corrections; no full barge-in |
| 36 | Call/background/network/earbud recovery | Partial — inherited recovery, not real-device verified |
| 37 | Avoid repeated actions on resume | Partial — transcript dedupe and local serialized ledger; external idempotency absent |
| 38 | Silent Mode | Implemented |
| 39 | Earbud/media controls | Partial — inherited MediaSession support; hardware unverified |
| 40 | Supported active-session wake phrases | Implemented within a running session — optional OneBrain/Hey OneBrain filter; cannot wake a suspended browser |
| 41 | Private-output and disconnect protection | Partial — Silent Mode; no reliable disconnect privacy guarantee |
| 42 | Dark screen without false lock claims | Implemented — within active workspace |
| 43 | Measure voice-stage latency | Partial — existing diagnostic events; full metrics absent |
| 44 | Tested compatibility matrix | External verification — actual phones required |
| 45 | English/Hindi/Hinglish/Marathi and more | Partial — browser language selection; quality unverified |
| 46 | Mixed-language extraction | Partial — existing transliteration; no complete mixed-language parser |
| 47 | Names/dates/amounts/actions/preferences extraction | Partial — explicit prefixes and numeric currency amounts; no inferred entity/date parsing |
| 48 | Pronunciation/name aliases | Partial — editable recognition-name aliases with Unicode boundaries; pronunciation model absent |
| 49 | Language-matched TTS | Improved — replies are real audio through an `<audio>` element (user key → keyless community voice → hardened browser voice), auto-detected output routing and a one-tap replay. See [voice output](VOICE-OUTPUT.md); physical-device coverage still unverified |
| 50 | Optional bilingual responses | Partial — provider instructions still allow translation; explicit toggle absent |
| 51 | Read-back consequential fields | Partial — shared destination read-back and exact Operations approval; general multilingual field extraction incomplete |
| 52 | Local speech and processor disclosures | Partial — disclosures corrected; on-device recognition selection absent |
| 53 | Remember This structured capture | Implemented — preview required |
| 54 | Relational memory | Implemented for explicit links — local records plus scoped SQL relationships/dependency guards; automatic inference absent |
| 55 | Natural-language memory search | Partial — deterministic keyword search and voice query prefix |
| 56 | Person/company/project context pages | Partial — selectable local/server record context, links and fields; richer dedicated context pages incomplete |
| 57 | Source/timestamp/edit history | Partial — timestamps, revisions and mutation/audit history; complete source provenance not implemented |
| 58 | Confirmed/suggested/unresolved distinctions | Partial — only explicit saved records/links supported |
| 59 | Conflicting fact resolution | Not implemented |
| 60 | Edit/merge/unlink/delete memories | Partial — local edit/unlink/delete/undo and server CAS editing/deletion; automatic merge absent |
| 61 | Decision logging with reasons/project links | Implemented — user-entered reason and explicit links |
| 62 | Contact/reference lookup | Partial — saved records; no contact-book integration |
| 63 | Location memory | Implemented — explicitly saved text, not GPS tracking |
| 64 | Separate personal/shared memory | Implemented separation — device-local canvas and authenticated shared spaces; explicit reviewed upload only |
| 65 | Honest missing-information behavior | Partial — deterministic recall is honest; LLM responses remain probabilistic |
| 66 | Task lifecycle by voice/text | Partial — local lifecycle and shared task capture/editing; general server voice edit grammar incomplete |
| 67 | One-time and recurring reminders | Implemented within supported limits — local reminders plus approved leased server jobs with bounded recurrence; no OS alarm guarantee |
| 68 | Projects/budgets/owners/milestones/dependencies | Partial — server projects, budgets, member assignees, milestones and dependency validation; richer project planning UX incomplete |
| 69 | Client relationship memory | Partial — linked people/company/project records; full CRM lifecycle incomplete |
| 70 | Meeting recap extraction | Partial — user notes/explicit Brain Dump only |
| 71 | Preview follow-ups before saving | Implemented — local capture drafts |
| 72 | Deliver contextual follow-ups | Partial — approved local inbox and provider action delivery with receipts; automatic contextual follow-up pipeline incomplete |
| 73 | What Am I Forgetting | Partial — local open/overdue tasks only |
| 74 | Daily/scheduled briefings | Partial — user-triggered local summary; no schedule/calendar integration |
| 75 | Close My Day and rollover | Partial — local summary; batch rescheduling absent |
| 76 | Context-triggered reminders | Partial — server record-done conditions; broader context-trigger inference absent |
| 77 | Location reminders | Not implemented |
| 78 | Timers and stopwatch | Implemented session-only timers and stopwatch; no suspended-page alarm guarantee |
| 79 | Brain Dump organizer | Partial — explicit lines/semicolons, no semantic multi-intent extraction |
| 80 | Preserve text when AI unavailable | Implemented — deterministic capture needs no AI |
| 81 | Quick notes and shopping lists | Implemented — typed records |
| 82 | Shared household lists | Partial — shared shopping/household record kinds and membership; dedicated collaborative list UX incomplete |
| 83 | Calculations/percentages/dates/unit conversion | Implemented within deterministic grammar — arithmetic, percentages, real calendar dates and compatible unit conversion |
| 84 | Timestamped currency conversion | Partial — dated Frankfurter lookup/source/error UI implemented; sandbox source connection reset, successful live lookup unverified |
| 85 | Translation and bilingual explanations | Partial — general AI/browser languages; no dedicated tested workflow |
| 86 | Weather with permitted source | Partial — attributed MET Norway forecast lookup implemented; sandbox source connection reset, successful live lookup unverified |
| 87 | Travel/booking organization and lookups | Partial — notes can store references; no travel connector |
| 88 | Source-linked research/summarization | Partial — inherited Wikipedia lookup; deep research absent |
| 89 | Habit/activity/medication logs | Partial — structured habit/activity records; medication-specific safeguards and summaries incomplete |
| 90 | Explicit mood/energy summaries | Not implemented |
| 91 | Authenticated encrypted local vault | Implemented at-rest local vault — PBKDF2/AES-GCM, lock, encrypted backup; not an audited password manager |
| 92 | Verified-local-only secret voice entry | Not implemented — secret voice entry is intentionally unavailable without verified local-only speech |
| 93 | Structured expenses | Implemented supported local/shared financial records with deterministic amount/currency validation |
| 94 | Payments/advances/outstanding balances | Partial — payments/advances/outstanding record fields and totals; no bank reconciliation or complete accounting engine |
| 95 | Deterministic totals and honest balance scope | Implemented — currency-separated logged totals, not bank balances |
| 96 | Periodic financial summaries and Sheets sync | Partial — deterministic financial totals and reviewed Sheets RAW append adapter; periodic auto-summary/sync pipeline incomplete |
| 97 | Contextual document/proposal/email drafting | Partial — editable document/proposal/email records and drafts; comprehensive sourced generation incomplete |
| 98 | Draft review/edit/save/approved sending | Partial — save/review workflows and separately approved Gmail draft/send adapter; live sending unverified |
| 99 | Inbox triage and source links | Not implemented |
| 100 | Explicit search scope for missing results | Partial — local recall scope stated; inbox not connected |
| 101 | Google Calendar connector | Implemented bounded Calendar create/read-back adapter and OAuth flow; live authorization/verification outstanding |
| 102 | Google Sheets connector | Implemented bounded Sheets RAW append adapter and OAuth flow; live authorization/verification outstanding |
| 103 | Telegram connector | Implemented bounded Telegram send adapter; live bot authorization/verification outstanding |
| 104 | Gmail connector | Implemented Gmail draft/send adapter and OAuth flow; inbox triage and live verification outstanding |
| 105 | Notion/Todoist/HubSpot connectors | Implemented bounded Notion page/Todoist task/HubSpot contact adapters; live verification outstanding |
| 106 | Slack/Teams connectors | Partial — Slack send adapter and generic Teams workflow webhook; native Graph/Teams connector absent |
| 107 | Home Assistant connector | Implemented allowlisted Home Assistant service-call adapter; live user-hosted verification outstanding |
| 108 | Secure connector framework | Partial — encrypted scoped connector framework and real transport; full provider interoperability/security review incomplete |
| 109 | Authenticated automation webhooks | Implemented scoped signed outbound webhooks with allowlists/size/time bounds; destination signature enforcement requires operator verification |
| 110 | User-owned n8n compatibility | Partial — user-owned webhook compatibility; no hosted n8n embedding or license compliance claim |
| 111 | Named voice routines | Partial — named server routines and explicit reminder voice drafts; arbitrary named voice-trigger routines incomplete |
| 112 | Natural-language workflow definitions | Partial — explicit command grammar and action/schedule editor; general natural-language workflow extraction absent |
| 113 | Workflow conditions/review/test/pause/cancel | Partial — record-done conditions, exact review, pause/cancel and due-job execution; isolated provider dry-run environment absent |
| 114 | Cross-app plans and partial results | Not implemented — jobs are individual actions, not a general cross-app plan executor |
| 115 | Trusted MCP integration | Partial — allowlisted authenticated stateless JSON HTTP MCP; SSE/session transports and comprehensive trust isolation absent |
| 116 | Scoped personal API access | Partial — opaque authenticated API sessions with workspace RBAC; dedicated per-token scoped API keys absent |
| 117 | Connector permissions/status/disconnect | Implemented for supported providers — connection status, role checks, encrypted credentials and revocation |
| 118 | Durable action ledger | Implemented for supported jobs — durable SQL receipt ledger and transactionally guarded mutations |
| 119 | Destination IDs/timestamps/evidence | Implemented supported receipt evidence — destination IDs, timestamps, read-back or provider acknowledgment distinctions |
| 120 | Accepted versus verified completion | Implemented — provider acknowledgment alone is not presented as independently verified completion |
| 121 | Durable server-side scheduling | Implemented server scheduler/cron configuration and local runtime; production deployment and delivery SLA unverified |
| 122 | Offline queue/retry/backoff/sync visibility | Partial — durable queued jobs, safe-signal retries/backoff and status; full offline shared-record sync absent |
| 123 | Idempotency and duplicate protection | Partial — leases, atomic local delivery, identified draft/import retries and provider idempotency; no universal exactly-once external claim |
| 124 | Corrections and undo | Partial — local verified undo and server corrections; external undo/reversal absent |
| 125 | Reconfirm material approval changes | Implemented — material job edits reset approved hash and require new owner/admin review |
| 126 | No tool-attempt-equals-completion claim | Implemented for supported jobs — attempts, acceptance, verification and ambiguous outcomes are separate |
| 127 | Failed-job/expired-credential recovery | Partial — terminal unknown receipts, bounded retries, reconnect/review flow; generalized recovery tooling incomplete |
| 128 | Shared workspaces and invitations | Implemented shared spaces and single-use invitation secrets; new account emails require signed Google verified-email claims |
| 129 | Role-based membership | Implemented owner/admin/editor/viewer checks; inviter role changes revoke pending invitations/queued approvals |
| 130 | Shared projects and assignments | Implemented shared project records and member assignments within generic record editor |
| 131 | Permissions across retrieval/notifications/exports | Implemented new-platform membership checks on records, notifications, jobs and exports; full legacy audit outstanding |
| 132 | Team concurrency and schedule conflict handling | Partial — CAS edits, transactional imports/caps and leased jobs; general schedule-conflict resolution absent |
| 133 | Admin connector/retention/usage controls | Partial — admin connections/invites/approvals and fixed usage caps; configurable retention/tenant policy controls absent |
| 134 | Personal activity and admin audit logs | Implemented local activity and scoped server admin audits for supported mutations |
| 135 | SSO/SAML and account linking | Scope updated: Google-only OIDC authentication; separate SAML login excluded by latest owner instruction; legacy identity migration requires review |
| 136 | Workspace export/backup/restore/offboarding | Partial — workspace JSON export and reviewed linked-record import; full backup/restore/offboarding absent |
| 137 | Data residency controls | Not implemented |
| 138 | Support/custom integration/SLA offering | External verification — operational/commercial commitments required |
| 139 | Compliance assessment | External verification — no certification claimed |
| 140 | Self-host/on-premise design | Partial — local full-stack operator setup and user-owned endpoints; complete on-premise packaging absent |
| 141 | Authentication/reset/tenant audit | Partial — Google-only verified OIDC sessions, retired password/reset paths and isolation tests; legacy account reconciliation and independent audit incomplete |
| 142 | Secure tokens and minimal OAuth scopes | Partial — AES-GCM connector secrets, hashed sessions, PKCE and declared OAuth scopes; live scope/refresh-token verification incomplete |
| 143 | Revocable sessions/connections/reauth | Implemented server session/connection revocation and Google identity binding and retirement of old password sessions; production reauth testing outstanding |
| 144 | Approval for consequential actions | Implemented supported action approvals — exact plan hash/revision, role checks and approval audit transaction |
| 145 | Untrusted content boundaries | Partial — AI data boundaries and bounded transport; arbitrary trusted-MCP code is not sandboxed |
| 146 | Webhook/MCP SSRF/replay/payload defenses | Partial — HTTPS allowlist, redirect/payload/time bounds, HMAC and idempotency; DNS rebinding/general MCP transport defenses incomplete |
| 147 | Universal export/delete/security/status | Partial — local/shared export, record deletion and visible state; universal account/tenant deletion absent |
| 148 | Retention/processors/consent/deletion policy | Partial — corrected disclosures and memory toggle; comprehensive provider retention handling absent |
| 149 | Correct privacy claims | Partial — README and settings corrected; historical dossier remains historical |
| 150 | Deterministic parsing/calculations with fallback | Implemented within supported local grammar; general NLP not complete |
| 151 | SQL relationships before specialized storage | Implemented explicit SQL relationships/triggers plus local IndexedDB links; no graph database dependency |
| 152 | Define local encrypted/server processing boundary | Documented and implemented distinct local plaintext, server plaintext and encrypted-vault/credential boundaries; no E2EE claim |
| 153 | Provider quotas and spending restrictions | Partial — atomic external-dispatch caps and no paid overflow; infrastructure/provider account limits still need operator setup |
| 154 | Cost instrumentation | Partial — dispatch counters and receipts; monetary cost/account instrumentation absent |
| 155 | Useful first action before account setup | Implemented — local capture without signup |
| 156 | Just-in-time permissions | Partial — mic on explicit start; notification permission remains in legacy start flow |
| 157 | Complete limited core trial | Partial — server-enforced free allowances (research/scribe per day, email drafts per month, 3 story episodes) and a per-session translator trial; no billing or paid trial conversion |
| 158 | Configurable paid entitlements | Partial — server-authoritative plan rows with per-plan quota limits and operator-minted keys; limits are code-defined (`PLAN_LIMITS`), not operator-configurable at runtime, and nothing is purchasable |
| 159 | Proposed pricing, not validated conclusion | Documented — no checkout or price validation |
| 160 | Localized pricing experiments | Not implemented |
| 161 | Explicit bounded allowances | Implemented — fixed transactional object/dispatch caps, local bounds, and atomic per-plan server quota consumption with `Retry-After` on exhaustion |
| 162 | Billing/cancellation/invoices | Not implemented by policy — no checkout, payment provider, invoice or cancellation flow exists; entitlements are granted by operator-minted keys (see row 163) |
| 163 | No lifetime unlimited offers | Implemented as product policy — no billing offers exist |
| 164 | Conversion/renewal reporting | Not implemented — quota counters and key-redemption audit rows exist, but there is no conversion, renewal or revenue reporting |
| 165 | Real iOS/Android workflow tests | External verification — browser emulation is not hardware validation |
| 166 | Real background/call/earbud/network testing | External verification |
| 167 | Automated logic/reliability tests | Partial — 664 frontend and 88 Workers tests (2026-09-16) plus the existing browser flows; the new Track/To-Do/search/intent suites are unit-level only and their Playwright specs await a first CI run; media-source health, provider and device matrices outstanding |
| 168 | Security/accessibility/performance/migration/restore tests | Partial — concurrency/auth/crypto/import/restore/mobile tests; independent security/accessibility/load audits absent |
| 169 | Canvas versus list retrieval study | External verification — needs actual users |
| 170 | Remove entertainment from core | **Reversed 2026-09-15** — playback revived as an opt-in surface outside the core Today flow (`settings.musicEnabled`, Your space → Music); requires maintainer sign-off, and keyless sources were unreachable from the build sandbox so live playback is unverified |
| 171 | Preserve legacy data during UI migration | Implemented — additive Dexie v4 tables; existing conversation records preserved |
| 172 | Update setup/privacy/testing documentation | Implemented current setup, boundaries, evidence and full ledger; historical deployment docs remain labeled historical |
| 173 | Label feature status honestly | Implemented — explicit supported, partial, unverified and unimplemented statuses; no 175/175 claim |
| 174 | Activation/retention/action metrics | Not implemented — no customer analytics pipeline |
| 175 | Real demos and onboarding without unsupported claims | Partial — working preview; no customer study or launch campaign |
| 176 | Opt-in proactive conversation from relevant history and preferences | Implemented within documented English-template/local-policy scope; simulated browser consent test passes; no manipulative engagement design |
