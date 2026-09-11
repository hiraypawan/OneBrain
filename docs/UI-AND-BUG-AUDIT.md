# Responsive UI and bug-fix audit

**Date:** 2026-09-10 · **Scope:** current local workspace and voice lifecycle, not certification of the full 175-item product.

## UI refinements

1. Kept the black/amber Neural Workspace identity; tightened the heading, session card, spacing, and local workspace summary.
2. Moved capture above the map and added note/task/idea/dump/ask shortcuts. Ctrl/Cmd+Enter opens review (or submits an explicit question), without swallowing IME composition.
3. Replaced the minimum-720px map with one-, two-, and three-column layouts based on actual container width. Lines and cards share a coordinate system.
4. Implemented genuine card-and-line scaling, bounded zoom, reset, keyboard-scrollable exploration, and 18-record map pages. List and activity render 50 entries initially with explicit load-more controls.
5. Added loading and filtered-empty states; removing filters does not remove records. Search appears only in views where it operates.
6. Added labelled dialogs, arrow/Home/End tab navigation, focus restoration, larger controls, mobile input sizes, reduced-motion behavior, and safer dialog scrolling. This is targeted accessibility work, not a WCAG certification.
7. Financial capture review now exposes editable amounts and currency before saving.

## Bugs repaired and covered

- A cancelled or unmounted microphone start could finish later and activate a session. Late streams now stop, and cancelled startup responses cannot clear a newer startup UI.
- Unsupported recognition could acquire a mic anyway, and synchronous recognition-start failures could leave it live. Startup now checks support first and tears down on failure.
- Multiple resume events could unnecessarily reacquire a live microphone or complete after Stop. Recovery is guarded, avoids replacement of a live stream, and checks session ownership after async work.
- Old speech callbacks/timeouts could affect a new session, and cancellation could leave a turn busy until timeout. Speech completion has per-request ownership and cancellable timers/resolvers.
- A pending proactive invitation could outlive revoked topic consent. Acceptance rechecks the relevant consent; stale acceptances are handled locally rather than sent as an unrelated AI question.
- Corrupt/string-valued persisted proactive consent and numeric limits are now normalized conservatively, with bounded history.
- Voice-style reminder commands no longer save or schedule reminders while Memory is off. They explain that a session-only task or enabled storage is needed. The separate legacy reminder-management UI remains outside this audit.
- Brain dumps over 30 lines and source captures over 6,000 characters previously silently truncated content. They now fail visibly without discarding the composer's text.
- Amount parsing could truncate extra decimal places, accept malformed grouping, or match a currency abbreviation inside another word. Ambiguous values now require explicit review.
- Capture validation now covers type, title, body, due date, currency, finite/ranged amounts and decimal precision, not just later edits. Runtime patches cannot replace identity, scope or source.
- Malformed currencies could access inherited object properties during financial aggregation. Aggregation now uses a null-prototype dictionary and supported currencies.
- Percentage overflow is reported rather than displaying `Infinity`.
- Undoing a capture could leave later backlinks pointing at a missing item. It now refuses until dependent links are removed/undone.
- Stale edits/deletes/undo from another tab could overwrite newer records or break relationships. Expected snapshots and resulting relationships are checked inside the IndexedDB transaction. Conflicts require an explicit reload/review; there is **no automatic cross-tab merge or sync**.
- Turning Memory back on does not silently persist temporary edits over an older saved record. Conflicting temporary edits require export/review and reload; export session-only work before reloading if it matters.
- Dialogs were remounted on every item edit; clicks in padding could dismiss them; focus was not reliably restored. Dialog identity is stable, only actual backdrop clicks dismiss, and closing restores the trigger when it still exists.
- A sticky dialog action row obscured editable fields at short viewport heights. It now stays in normal document flow.
- Obsolete periodic background-sync registration was removed. It cannot keep a mic alive. Recovery no longer mistakes `wasDiscarded` (the previous document) for the current page being frozen.
- Service-worker cache-first handling could serve stale development chunks/RSC payloads. Only public assets and hashed static chunks are cache-first now; API/backend responses never use cache fallback. Failed navigation/assets are not cached, and activation deletes only OneBrain-owned caches.

## Verification actually run

| Check | Result |
|---|---|
| Frontend unit tests | **168 passed**, 14 files (31 additional regressions in this audit) |
| Browser tests against production build | **20 passed**, headless Chromium (15 additional regressions) |
| Workers security tests | **5 passed** |
| Frontend / Express / Workers TypeScript | All passed |
| Next.js production build | Passed; 27 generated pages; workspace first-load JS reported at 164 kB |
| Responsive geometry | No page/map horizontal overflow at default zoom at 320, 390, 768 and 1440px; zoom and pagination tested |
| Visual review | Desktop and 320/390px mobile captures reviewed; a dialog obstruction was found and corrected |

Preview runs the local production build on port 3000. This is **not** a production deployment. Browser tests use mocked microphones, speech and clocks; they do not prove real iOS/Android/Bluetooth behavior. Service-worker policy tests run in a simulated worker environment; full installed-PWA/offline upgrade behavior still needs device testing.

## Remaining boundaries

Full OAuth/connectors/MCP execution, durable scheduling, team tenancy/RBAC, billing, vault/local-only transcription, broad auth/legacy-data auditing, multilingual physical-device validation, load testing and compliance remain incomplete. Workspace data is device-local, not cloud-synced. This audit does not establish that every bug has been found or that the product is 175/175 complete. See `IMPLEMENTATION-STATUS.md` for the unchanged full scope ledger.
