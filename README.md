# OneBrain — Context, capture, and reviewed action

> **Google-only authentication:** Account sign-up/sign-in now uses Google. See [secure setup steps](docs/GOOGLE-AUTH-SETUP.md) and [PR/release gates](docs/PR-RELEASE-GATES.md). Password login is retired; live Google configuration is still required.
> **Build status:** Neural Canvas, pocket voice, opt-in proactive conversation, local encrypted vault, utilities, and a real local D1-backed shared platform are implemented within the documented limits. **The full 175-item product scope is not complete.** See the [numbered requirement ledger](docs/IMPLEMENTATION-STATUS.md).
>
> Start the full stack with the [platform setup guide](docs/PLATFORM-SETUP.md). Push to `main` auto-deploys the OpenNext app Worker and API Worker through GitHub Actions (`CLOUDFLARE_API_TOKEN`). Remote D1 migrations, Google OAuth secrets, paid API activation, and live connector authorization remain operator steps.

## Working surfaces

- **Today (`/`):** notes, tasks and answers with accessible saved-list/map/activity views, local structured capture, explicit links, calculations, financial review, undo and export. Voice start/pause/resume/stop, Silent Mode, optional active-session wake phrase and recognition aliases.
- **Proactive conversation:** separately consented history topics and preference questions, at least 90 seconds of quiet, cooldown/session/day caps, quiet hours and snooze. No response is never consent.
- **Your space (`/control`), Connected work panel:** server accounts, shared workspaces and roles, linked records/projects/financial logs, reviewed imports, connector administration, exact approval hashes, leased scheduling, durable receipts, inbox and audits.
- **Shared voice capture:** explicitly select a workspace in Operations, then use `shared task: ...` or `server reminder: ...` in voice/Ask OneBrain. Review the destination and say **save shared**. Reminders remain drafts until separately approved; local records are never silently uploaded.
- **Your space, Everyday tools panel:** local calculations, units and dates, session-only timers/stopwatch, explicit source-linked FX/weather lookup. Live source requests failed with connection resets in this sandbox; successful live lookups remain unverified, and failures never produce invented values.
- **Your space, Private vault panel:** password-derived AES-GCM local storage, lock on hide/inactivity, encrypted backup/restore. Not an audited password manager; no voice/AI secret entry.

Device-local records, server workspace records and encrypted vault entries are separate storage boundaries. General browser speech and optional AI may use external processors. Hosted APIs have quotas; **free unlimited service is not promised**. No automatic paid overflow or payment collection exists.

HTTP adapters exist for Calendar, Sheets, Gmail, Telegram, Slack, Todoist, Notion, HubSpot, Home Assistant, signed webhooks and a limited JSON-HTTP MCP transport. **Written adapters are not evidence of live authorization or successful delivery.** See the setup guide for exact supported actions and limits.

## Verification

- [Audit CI passed](https://github.com/hiraypawan/OneBrain/actions/runs/34567432168): 227 frontend unit tests, 47 Workers tests, one Express integration test, 53 product browser tests and 144 compatibility checks across six Chromium/Firefox/WebKit desktop/mobile/tablet profiles. See the [full audit report](docs/AUDIT-2026-09-11.md) for limits and remaining work.
- Next 15.5.25 production build and frontend/Workers/legacy Express TypeScript checks pass.
- Full dependency audits, including development tools: zero reported vulnerabilities across all three packages on 2026-09-11. This is not an independent application-security audit.
- Real phones/earbuds, live providers, production deployment, enterprise compliance, billing and the other unfinished requirements remain explicitly tracked.

```sh
npm --prefix frontend test
npm --prefix workers/api test
npm --prefix backend test
npm --prefix frontend run lint
# Both local servers must be running for browser tests:
npm --prefix frontend run test:e2e
```

Older release notes are retained in [the historical archive](docs/ARCHIVED-README.md), not as current capability claims.

## Deploy (Cloudflare)

GitHub Actions **Deploy to Cloudflare** runs on push to `main` and publishes:

- App: https://onebrain.pawanhiray88.workers.dev (OpenNext Worker, Google callback + platform proxy)
- Pages Direct Upload: https://onebrains.pages.dev (and `onebrain.pages.dev` when that project exists)
- API: Worker `onebrain-api` (private `PLATFORM_API` service binding; not a public workers.dev URL)

Repo secret **`CLOUDFLARE_API_TOKEN`** is required (Cloudflare token template **Edit Cloudflare Workers**, plus **Account → Cloudflare Pages → Edit**). Optional secret/variable: `CLOUDFLARE_ACCOUNT_ID`.

Cloudflare Dashboard **Create Pages project → Connect Git** does not build this monorepo by itself (Next.js lives in `frontend/`, the API is a separate Worker). Use the GitHub Action; do not re-enable `PAGES_EXPORT=1` static export — it cannot serve `/api/auth/google/*` or the platform proxy.

## Free-tier capacity

See [the capacity report and calculator](docs/FREE-TIER-CAPACITY.md) for the private service binding, native rate counters, paginated/lazy server data, indexed queries, five-minute bounded scheduler and quota-pause controls. These are real optimizations, **not a guarantee of 10,000 concurrent cloud-active users or unlimited free usage**. The single free D1 database is capped at 500 MB. No deployment was performed.
