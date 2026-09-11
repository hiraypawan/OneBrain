# Shared platform: setup, security boundaries, and evidence

> **Google-only authentication update (2026-09-11):** Password/local account login and legacy JWT OAuth are retired. Follow [Google setup](GOOGLE-AUTH-SETUP.md) and [PR gates](PR-RELEASE-GATES.md). Sign-in requires operator OAuth configuration; no real secret was supplied or live login verified. Prior password/authentication descriptions below are historical where they conflict with this update.
Updated 2026-09-10. This describes the implementation in this branch, **not a production launch or 175/175 completion**. The legacy deployment addresses in historical documentation were not updated by this work.

## Run the real local stack

Use Node 22 or newer for the frontend and Workers tools. The separate legacy Express backend requires its own documented runtime and is not required for this workflow.

From the repository root:

```sh
npm --prefix frontend ci
npm --prefix workers/api ci
node scripts/setup-platform.mjs
npm --prefix workers/api run migrate:local
```

The setup script creates ignored local development keys with restrictive file permissions and configures the **server-only** frontend proxy. It preserves existing files and keys. Never delete or regenerate an encryption key while expecting old connector credentials to remain decryptable.

Run in separate terminals:

```sh
# Local D1-backed API, port 8787; does not use the remote database
npm --prefix workers/api run dev

# Frontend, port 3000
npm --prefix frontend run build
npm --prefix frontend run start -- --hostname 0.0.0.0

# Optional development-only scheduler; independent of the browser being open
node scripts/local-scheduler.mjs
```

Open `/operations`, use **Continue with Google** after configuring OAuth, and create a workspace. Device-local/legacy login does not automatically grant server membership. A browser calls `/api/platform/...` on its own origin; Next proxies to `PLATFORM_API_URL`. Browser code must not use localhost to reach another service.

The first four migrations create the original schema, the platform/relationship/import tables, password-versioned sessions, and transactional allowance guards. Migration 0005 adds verified Google subject identities and one-time login state, and revokes password sessions/reset tokens. All were applied to **local D1 only**. Use migrations in order; do not rerun individual SQL files over an existing database.

### Try the complete supported paths

1. Create a shared person, project, task, note, expense, payment, or document record. Edit fields and explicit links. A stale revision or invalid dependency is rejected rather than overwriting another editor.
2. Open **Actions & schedules**, draft an in-app notification, and inspect the exact payload and schedule. A draft cannot run. An owner/admin must confirm its current revision and plan hash. Run due jobs or let the local scheduler tick; inspect the receipt and workspace inbox after reloading.
3. In Operations, select **Use for explicit shared voice drafts**. In Pocket Mode or Ask OneBrain, enter `shared task: Call Rahul`, `shared note: Meeting context`, `shared idea: A new proposal`, `shared project: Website refresh`, or `server reminder: Review the proposal`. Review the named workspace and say/click **save shared**. Generic “yes” is not an upload confirmation. No automatic bulk upload occurs. Shared voice saving is disabled when Memory is off.
4. A server-reminder command creates only an action draft, initially five minutes ahead. Review its actual time and approve it in Operations; it is not an OS alarm. Record imports and identified action drafts have request IDs to protect explicit retries from duplicate creation.
5. Import a JSON file through the review dialog. Approve upload before any record is sent. Imports accept 1–100 records, remap source IDs, preserve included links/dependencies, and roll back on invalid/cyclic references. Credentials, memberships and executable jobs are **not restored** by this record importer.
6. Use `/utilities` for local arithmetic, dates, compatible unit conversion, stopwatch and session-only timers. Currency/weather lookup is a separate explicit network action and displays errors rather than invented results.
7. Use `/vault` for password-encrypted local entries and encrypted backups. Do not dictate secrets.

## Configuration and deployment

**2026-09-11 free-tier update:** Follow [FREE-TIER-CAPACITY.md](FREE-TIER-CAPACITY.md) for migration 0006 and deployment order. The Cloudflare frontend now uses a private `PLATFORM_API` service binding; the API disables its public workers.dev/preview URLs. `PLATFORM_API_URL` remains for plain Next.js/local development. Default scheduling is every five minutes, two candidates per tick. Do not disable an existing public API before verifying the replacement binding.


No deployment or remote database operation was performed in this session. Before deploying, an operator must select the correct Cloudflare account/database, back up existing data, review all migrations and legacy account interactions, configure secrets through the provider's secret manager, and test in an isolated staging environment. Do not blindly deploy using the historical database ID already in the repository.

| Setting | Location and purpose |
| --- | --- |
| `JWT_SECRET` | Worker secret; independently random, at least 32 characters. Legacy JWT login is retired; retain independent keys for any historical services while migrating. New Google sessions are opaque and server-revocable. |
| `TOKEN_ENCRYPTION_KEY` | Worker secret; base64 encoding of exactly 32 random bytes. AES-GCM connector encryption; never a `NEXT_PUBLIC_*` value. |
| `PLATFORM_API_URL` | Frontend **server-only** environment; production HTTPS API origin, not the sandbox/local URL. |
| `FRONTEND_URL` | Worker configuration; allowed frontend origins for legacy CORS. |
| `OUTBOUND_HOSTS` | Operator-managed, comma-separated exact public hostnames for webhook, Home Assistant and MCP endpoints. Default empty. Do not allow attacker-controlled DNS. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Operator-owned Google OAuth application, required for Google account sign-in; optional Google connectors request separate permissions. No credentials were supplied or authorized here. |
| `GOOGLE_CONNECT_REDIRECT` | Exact registered HTTPS callback, normally the frontend's `/api/platform/oauth/google/callback` route. Keep the callback same-origin so its scoped session cookie is available. |
| Host AI/speech enable flags | Leave off for the free-only configuration. A key's presence is not permission to spend. |

The verified production frontend runtime is `next build` + `next start`. The repository retains the OpenNext Cloudflare adapter/configuration, with `nodejs_compat` enabled; **that adapter's deployment and production cron were not verified in this session**. The obsolete Next-on-Pages adapter was removed during the patched Next 15 upgrade. Do not use historical Next-on-Pages instructions for this branch.

A deployed API Worker has a minute cron declaration. The development scheduler is not a production daemon. Cloudflare infrastructure has account quotas; hosting is not promised to be free or unlimited. Configure infrastructure spending restrictions separately—an application cap cannot disable a provider account's billing.

## Connector implementation versus live authorization

Implemented HTTP adapters: Google Calendar event creation/read-back, Sheets RAW append, Gmail draft/send, Telegram send, Slack send, Todoist task creation, Notion page creation, HubSpot contact creation, Home Assistant service calls, signed outbound webhooks, and trusted stateless JSON-HTTP MCP tool calls.

- None was live-authorized against a user's account in this session. Mocked transport tests are not live integration evidence.
- Teams and user-owned n8n are generic webhook destinations, **not native Microsoft Graph or embedded n8n integrations**. Review n8n licensing before offering customer-credential hosting.
- MCP supports the implemented stateless JSON HTTP request/response subset, not general SSE streams or session negotiation. Tool execution is not independently verified merely because an MCP response is successful.
- Google scopes are visible in `workers/api/src/platform/connectors.ts`. An operator must verify actual granted scopes, consent, refresh-token availability and provider-specific account limits in staging.
- Connections are workspace-scoped and encrypted with authenticated workspace/connection context. Only admins manage connections and approve jobs; editors may draft. Revoking a connection cancels pending work, but cannot recall a request already dispatched.
- Public HTTPS, exact hostname allowlists, redirect rejection, bounded response size, 15-second transport timeouts, header-injection checks, HMAC signing and idempotency identifiers reduce risk. They are **not a complete DNS-rebinding defense or a sandbox for malicious MCP servers**.

## Delivery semantics and limits

- `draft`: saved, not approved. `queued`: approved, not executed. `running`: leased. `accepted`: provider acknowledged; not independent end-to-end proof. `verified`: matching evidence (including atomic in-app delivery or supported Calendar read-back). `unknown`: effects may have happened; inspect the destination, do not blindly retry. `failed`: reported failure; inspect its evidence before preparing another action.
- Approvals bind action, destination connection, normalized payload and bounded schedule. Material edits reset approval. Approval/edit/control audits are committed with mutations.
- Leases, receipts, audit events and in-app delivery are transactionally guarded. Expired dispatched leases receive an unknown receipt instead of automatic replay. This does **not** promise universal exactly-once third-party delivery.
- Only explicit safe retry signals are retried, with backoff and a bounded attempt count. Ambiguous network outcomes do not trigger blind retries.
- Unmet conditions and invalid approvers are filtered before selecting ready jobs. Deleting an approved condition causes a reported failure when evaluated, not invented completion.
- Recurrence is bounded to 30 occurrences, at least 15 minutes apart, within a 90-day approval window. It schedules from completion to avoid blasting missed occurrences; remaining occurrences beyond expiry are omitted with evidence. It is not a hard real-time SLA.
- Default caps: 20 owned workspaces, 2,000 records/workspace, 20 connections/workspace, 500 jobs/workspace, 100 external dispatch attempts/workspace/UTC day, 20 ready jobs per scheduler invocation. Database guards enforce object caps under concurrent writes; an atomic counter reserves external-dispatch allowance before a call. Failed/unknown attempts still consume that allowance. These limits do not override provider limits.
- Import/request bodies are bounded to 750 KB. There is no automatic paid overflow, credit purchase or payment collection.

## Storage, privacy and authentication boundaries

1. Neural Canvas records are device-local IndexedDB data, scoped to the local profile. They are not automatically synchronized with server records and are not encrypted merely because they have a scope ID.
2. Operations records are stored in server D1 and readable by authorized workspace members. They are not end-to-end encrypted. Server exports omit connector secrets. The record importer is not a full disaster-recovery or account-offboarding system.
3. Connector credentials are encrypted server-side; the running server needs the key and can decrypt them. Tokens are never exported to the browser. Opaque session tokens are hashed in D1 and placed in a scoped HttpOnly, SameSite cookie by the frontend. Password changes through another account path invalidate platform sessions.
4. Account authentication is Google-only: PKCE, browser-bound one-time state, nonce, signed ID-token issuer/audience/expiry checks and stable Google subjects. Password signup/login/reset and legacy JWT auth are retired. New identities are never automatically linked to legacy accounts by email. Invitations still require their single-use secret and the account email verified by Google. Existing-account reconciliation and a full legacy-data migration remain operator-reviewed release gates.
5. The local vault uses PBKDF2-SHA256 (600,000 iterations), a random salt, AES-GCM with fresh nonces, and an in-memory non-extractable key. Titles and values are encrypted. It locks on hide or 60 seconds of inactivity; encrypted backups require the correct password before restore. There is no recovery. It is not an audited password manager or protection against a compromised device, extension, XSS, or an unlocked same-origin page. A dedicated document CSP excludes third-party AI scripts; vault navigation uses full-document links. Secrets do not enter voice or AI processing through this vault.
6. Browser speech recognition may be remote. Wake phrase filtering applies only inside a running recognition session and does not make ambient transcription local. The supported English wake forms do not wake a closed/suspended browser. Name aliases are recognition substitutions, not a comprehensive pronunciation model.
7. Stopping a voice session releases capture resources and clears pending previews. It cannot undo a committed server write or recall dispatched provider requests. Hardware/browser background behavior still varies; the user's observed iOS and Android background success is valid but not a universal guarantee.

## Utilities and sources

Frankfurter v1: <https://frankfurter.dev/v1/> — dated institutional reference rates, not an executable bank quote. MET Norway: <https://api.met.no/doc/License> — credit MET Norway; data is supplied under the documented open-data licenses, including CC BY 4.0. Coordinates are rounded before an explicit lookup. No API key or paid fallback is configured.

**Verification boundary:** source documentation was checked. Direct source smoke requests in this sandbox ended in connection resets, and the app correctly returned 502 without invented values. Successful live FX/weather retrieval remains unverified here. Cached lookups and an in-process concurrency cap are not a durable multi-tenant rate limiter. Timers/stopwatch are session-only and are not guaranteed background OS alarms.

## Tests and remaining release gates

```sh
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix workers/api test
npm --prefix workers/api run typecheck
# With both servers running and a Playwright Chromium installed:
npm --prefix frontend run test:e2e
```

CI initializes a fresh local D1 database and starts both servers for browser tests. It never applies remote migrations.

Latest completed evidence: **183 frontend unit tests; 45 Workers tests; 29 production-browser tests; Next 15.5.25 production build; frontend/Workers/legacy Express TypeScript checks.** The browser tests cover the two shared-voice command paths through the common transcript handler; they do not certify real spoken recognition or physical phones.

Production dependency audits report **zero vulnerabilities** for frontend, Workers API and legacy Express. Critical Next/Vitest advisories and vulnerable PostCSS/Express transitive dependencies were addressed. Frontend and Workers development toolchains still each report **5 findings (2 moderate, 3 high)**; do not expose test/debug servers as production services. Dependency audits are not penetration tests or proof of application security.

Remaining software includes fuller language/workflow extraction, automatic relationship/conflict resolution, stable manually arranged canvas positions, native connectors beyond the bounded adapters, inbox/briefing pipelines, SSO, tenant residency/retention/offboarding, entitlements/billing/analytics and production operations. Remaining external checks include live authorized provider tests, real devices/earbuds/calls, deployment/load/security/accessibility audits, legal/compliance review and user studies. See the full numbered [requirement ledger](IMPLEMENTATION-STATUS.md); incomplete items remain in scope.
