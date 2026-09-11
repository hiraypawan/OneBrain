# Free-tier capacity: changes, evidence and operating limits

Updated **2026-09-11**. This is an optimization of the existing draft, **not a production release, a deployment, or certification for 10,000 concurrent cloud users**. No paid services or production load test were enabled.

## What “10,000 users” means

- **Registered accounts:** a storage question; they do not all consume requests continuously.
- **Daily active users (DAU):** needs a daily request/read/write budget, including authentication, navigation, other apps on the account, housekeeping and jobs.
- **10,000 simultaneously open browsers:** local capture and local utilities work on the devices; opening the app and explicit server requests still cost capacity.
- **10,000 simultaneous shared-data writers or Google sign-ins:** **not guaranteed on these free limits**. One D1 database serializes queries and may queue or reject bursts. Google verifies identity; OneBrain still spends requests and database operations creating and checking sessions.

## Verified limits and sources

| Resource | Free limit relevant to this repository |
|---|---:|
| Workers + Pages Functions, shared account request allowance | 100,000/day |
| Workers HTTP and scheduled-event CPU | 10 ms/invocation |
| D1 rows read/scanned | 5,000,000/day |
| D1 rows written, including applicable index changes | 100,000/day |
| **This single D1 database** | **500 MB** |
| All free D1 databases in the account | 5 GB, at most 10 databases |
| D1 queries per Worker invocation / bound parameters per SQL query | 50 / 100 |

Sources reviewed: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing and service bindings](https://developers.cloudflare.com/workers/platform/pricing/#service-bindings), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits and serial query processing](https://developers.cloudflare.com/d1/platform/limits/), [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/), and [native rate-limit consistency](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Daily quotas reset at midnight UTC. Exceeding D1 daily limits causes failures, not unlimited free overflow. Indexes consume storage and add write costs. At 10,000 registered users, 500 MB averages only about **50 KB/person for everything**, before allowing headroom; this is not a personal allocation.

**Static files are different from cached Worker responses.** Static assets served without a Function invocation are free/unlimited requests. The frontend is still Next/OpenNext on Workers, not a proven fully static Pages export. A Next build calling a page “static” does not demonstrate zero Worker invocations. Budget document/RSC navigation conservatively. Changing `PAGES_EXPORT=1` is not a working replacement for the Google callback and server proxy.

## Implemented changes

1. **Private frontend → API service binding.** `PLATFORM_API` calls `onebrain-api` directly; the bundled API disables `workers.dev` and preview URLs. Cloudflare documents one billed request for the initial Worker call, rather than an additional request for the bound Worker. CPU across the chain still counts. Node development retains server-only `PLATFORM_API_URL`; a failed binding is never retried over public HTTP. Edge client IP is forwarded only over the private hop, avoiding a single proxy-wide Google-auth bucket. Do not expose another public route to this API without reviewing the boundary.
2. **Native abuse counters instead of D1 writes on every authenticated read.** API sessions have independent buckets even behind a common proxy/NAT. Namespaces 1001/1002 must be unused by other account applications. Native counters are per-location and eventually consistent, **not an exact daily/global quota ledger**. Exact D1 execution allowances, approval hashes, leases, membership checks and revocation remain. Older deployments without bindings retain the D1 fallback; `/capabilities.requestLimiter` makes that visible. Logout bypasses the general abuse limiter, but still requires a verified session.
3. **No guest hydration identity request.** A readable presence-only cookie allows session restoration without polling anonymous visitors. It is never authorization. Account and Connected work independently verify legacy sessions without the hint; stale-response/logout protection remains. Guests cannot make the proxy forward protected API calls just by forging this hint.
4. **Two-call Connected work startup:** `/bootstrap` returns verified identity and memberships; a separate request returns the first record page. Jobs, inbox, team, connections and audit load only when opened. There is no server-data polling. Public capabilities alone have a short in-document cache; private responses remain `no-store` and are not reused as authentication.
5. **Stable 100-record keyset pages**, ordered by timestamp plus ID. “Load more” exposes older records; search/finance summaries explicitly identify loaded-only data. Editors fetch the complete existing 2,000-record bounded catalog on explicit use, separately from the visible page. Relationship search renders 50 matches plus selections, preserving older selected links. Live writes still validate dependencies, permissions and revisions.
6. **Targeted indexes** in migration 0006: inverse membership, owner allowance checks, tenant/time receipts and inbox, expired leases, record cursor order and bounded expiry cleanup. Existing migrations were not rewritten. Local D1 over 10,000 inbox rows reported **100 `rows_read` with the index versus 20,000 with the unindexed equivalent**, identical results: 99.5% fewer scanned rows in that specific test, not a universal performance multiplier.
7. **Bounded transactional imports.** A 100-record import uses at most four transactional write statements through `json_each`, instead of 202; member validation is fetched once. It stays below the per-invocation query and SQL parameter limits. Mapping, atomic rollback, idempotency, assignee validation and cycle checks remain; invalid completed dependencies and oversized relationship arrays are rejected. Plain unlinked records also avoid a redundant UPDATE. Actual row writes and trigger reads still count, and large imports require deployed CPU profiling.
8. **Small scheduler batches:** bundled cron every five minutes, two candidate executions per tick by default; manual run requests use the same configured batch size. That is at most **576 candidate executions/day from cron**, not 10,000 scheduled actions/day or guaranteed successful deliveries. Busy/blocked queues, retries and expired-lease recovery delay work. Jobs remain durable; UI discloses the cadence. This is not an exact-time alarm. Increasing the batch may breach free CPU/query/row budgets; it must be re-budgeted.
9. **Hourly, indexed expiry cleanup**, at most 50 rows per table across five ephemeral tables, or 6,000 base rows/day plus index changes. It deletes expired sessions, login/OAuth state, rate buckets and invites, **not records, receipts, audit history or notifications**. Large expiry backlogs drain gradually. The capacity model reserves 30,000 written rows for cleanup; inspect actual metadata rather than treating that estimate as a guarantee.
10. **Explicit degradation:** `PLATFORM_MODE=normal|read-only|local-only`. The API rejects paused operations before database access with 503/Retry-After; logout remains exempt. Scheduled work and housekeeping stop while paused. The client backs off on quota signals, never silently retries a mutation, and never claims an unsaved change succeeded. These switches save database work, **not already-arriving frontend Worker invocations**; they are operator controls, not automatic global quota enforcement.
11. **Real Workers-runtime compatibility:** native testing caught unsupported `redirect:'error'`. Service transport, Google/provider requests and utility lookups now use manual redirects and reject unexpected redirection rather than forwarding credentials. Redirected external writes remain uncertain outcomes, not falsely confirmed delivery.
12. Added unit, local-D1, browser, budget-model and native Cloudflare-runtime regression checks. The native test configuration deliberately breaks the HTTP fallback to prove that private binding requests work.

## Reproducible daily budget — assumptions, not a benchmark

```sh
node scripts/capacity-budget.mjs
node --test scripts/capacity-budget.test.mjs
# Override assumptions in a JSON file; exit code 2 means the budget does not fit.
node scripts/capacity-budget.mjs path/to/usage-assumptions.json
```

Bundled example: **10,000 DAU, 80% guest/local without session checks, 2,000 shared-data users**; two document invocations/person; each shared user averages four API reads and one mutation; 500 logins/day; 200 scheduled jobs/day; small teams/catalogs; private service binding; 20% headroom. It includes modeled index costs, maintenance and 20 MB of other stored data. No other account traffic is assumed. Adjust `identityReadsPerLocalUser` for signed-in local users; chat, provider/utility requests, extra tabs, invitations, exports and other traffic must be added.

| Resource | Example estimate | Operating budget after 20% headroom |
|---|---:|---:|
| Worker requests/day | 31,288 | 80,000 |
| D1 rows read/day | 2,222,880 | 4,000,000 |
| D1 rows written/day | 66,400 | 80,000 |
| Single-database stored bytes | 200,000,000 | 400,000,000 |

The estimator **fails** the equivalent all-cloud-active 10,000-user scenario on D1 budgets/storage. Use `invocationsPerApi:2` and `invocationsPerLogin:4` as conservative HTTP-proxy assumptions when not using the binding. Storage is a modeled snapshot, not indefinite retention. Business evidence grows and is deliberately not silently deleted.

## Deployment/admission checklist — not executed remotely

1. Review the draft and back up the chosen database. Apply migration 0006 off-peak; creating indexes itself consumes quota. No remote migration was performed here.
2. Configure both native rate bindings and the frontend service binding on the same account. Use the actual reviewed API Worker name. On an existing public deployment, establish and verify the frontend binding **before** disabling the old API URL; otherwise there is an outage window. The submitted API configuration is private by default. Remove any previously configured public custom routes too. Plain Node hosting cannot reach a private production API using its old HTTP URL.
3. Keep Google’s callback on the **public frontend**, `/api/auth/google/callback`, not the private API. Optional connector callbacks must likewise enter through the authenticated frontend proxy. Configure/rotate secrets privately; live Google consent remains an external verification gate.
4. Watch **account totals**, D1 `meta.rows_read`/`rows_written`, storage, 429/503 errors, queue depth and CPU. Verify cold and warm OpenNext + API CPU on Free. This work does not read account-wide quotas automatically. Reserve capacity for logout and recovery before exhausting D1.
5. At budget pressure, pause writes/server work and reduce admissions at the public edge using available domain protections. Do not rely on a Worker response cache, service binding or per-location limiter to prevent all abusive traffic from spending the initial request quota.
6. Staging capacity tests require explicit approval and a hard traffic ceiling. Measure representative catalogs/team sizes, sustained throughput, simultaneous bursts, p50/p95/p99 latency, failures, revocation and restoration. The local 10,000-session-key simulation and 10,000-row query test are **not** 10,000 concurrent network/browser users.
7. Remaining constraints: no automatic account-global admission controller, no database sharding or business-history archival, no full static Pages migration, no certified free 10 ms budget, no load SLA. Exports/relationship validation/blocked job eligibility can still inspect large catalogs; a small LIMIT alone is not proof of a small scan. Do not sell unrestricted free usage.

## Verification

Local verification on 2026-09-11: **236 frontend unit tests, 63 Worker/API tests, five budget-model tests, 56 product browser checks, and 12 native Workers browser checks passed**. Lint and both typechecks passed. Next/OpenNext built successfully and API Wrangler dry-run produced a 51.18 KiB gzip bundle without deploying. Native browser tests used the private service binding with an intentionally invalid HTTP fallback. Local Chromium was used; the existing six-profile cross-browser suite is also retained in CI. These are functional/regression results, not free-tier CPU or concurrency certification.

The ordinary Playwright and native suites use separate artifact directories so concurrent runs cannot erase each other's traces. Final CI status is recorded in the PR update. Re-run:

```sh
npm --prefix frontend test
npm --prefix workers/api test
node --test scripts/capacity-budget.test.mjs
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix workers/api run typecheck
npm --prefix frontend run build:cloudflare
# With the local API, Next and native Worker previews running:
npm --prefix frontend run test:e2e
npm --prefix frontend run test:edge
```

Independent security review, live OAuth/secret rotation, physical device/background behavior and the broader incomplete feature ledger remain release gates. This optimization does not change their completion status.

## Follow-up optimization before merge (2026-09-11)

- Disabled speculative Next.js link prefetching; browser checks verify unopened control pages do not issue RSC requests. Navigation remains functional. This is not a fully static Pages conversion.
- Relationship validation now looks up referenced IDs/status only and traverses the reachable dependency graph. A local 2,000-record fixture measured **2 rows read versus 2,001 previously** for attaching one link. Malformed relationships are rejected before catalog/member lookups; tenant checks, completion rules and transactional cycle guards remain.
- Actions load **25 jobs with their latest receipts**, with explicit older-action and per-job receipt-history pagination. Existing explicit unpaged clients retain their bounded legacy response. Migration **0007** replaces the job-list index for stable keyset ordering; apply migrations in order. Only the local database was migrated here.
- Actual D1 capacity errors open an advisory **60-second per-isolate/database cooldown**. Subsequent shared requests avoid additional D1 attempts while cooling down; scheduled work pauses too. Logout can still attempt real revocation. This is not a global quota reservation or a guarantee against bursts/cold isolates.
- Temporary session-check failures now offer a shared-connection retry rather than prompting a fresh Google login.
- `node scripts/capacity-budget.mjs --burst` models simultaneous demand separately from DAU. Its default hypothetical 10,000-user, two-call opening burst at 2.5 SQL queries/call and 1 ms/query implies **50 seconds of serial database service time**, not a five-second completion promise. The duration is an assumption, not a measured cloud benchmark; a non-fitting scenario exits with code 2.

Follow-up local results: **236 frontend tests, 70 Worker tests, eight budget tests, 59 product browser checks and 15 native Workers browser checks passed**. Next/OpenNext build passed. These replace the earlier functional counts above; they do not certify deployed free-tier CPU, concurrent throughput or live OAuth. The broader incomplete feature ledger remains unchanged.
