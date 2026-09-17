# OneBrain: two primary screens

Updated 2026-09-15. This is an implemented UI rework, not a claim that every product requirement is complete or that usability has been validated with new users.

## The everyday flow

1. **Today (`/`)** explains the product: notes, tasks and questions through voice or text. A user can start without an account.
2. Choose **Save a thought** or **Ask OneBrain**, or explicitly press **Start talking**. First-use examples fill the composer; they never silently save sample data. Below the composer, **Try one of these** groups real phrases (Save something / Ask or calculate / Play music / Start a mode) as tappable chips that run the same transcript path as speaking them, with a **More examples** toggle so the list never crowds the screen.
3. Review captures before saving. Feedback distinguishes browser-persisted and session-only data. Questions show their answer alongside the composer instead of at the bottom of the page.
4. Revisit saved items in the default list. Context map, tasks and activity remain alternate views within Today. Records still support editing, explicit links, financial fields, completion and undo.
5. **Your space (`/control`)** contains a searchable directory, grouped into Keep track, Do more and Make it yours. Individual tools load on demand as `?panel=...` sections in that screen.

The two items in the primary navigation are Today and Your space. Detailed workflows use panels and existing review dialogs; “two screens” does not mean all forms must fit inside two unscrollable viewports.

## Feature homes and compatibility

| Feature | Current destination |
| --- | --- |
| Account / Google sign-in | `/control?panel=account` |
| Voice and permission-first conversation | `/control?panel=voice` |
| Retention and privacy | `/control?panel=privacy` |
| Optional AI key / speaker enrollment | `/control?panel=advanced` |
| Export and local deletion | `/control?panel=data-export` |
| Diagnostics | `/control?panel=debug` |
| Shared workspaces / connections / approvals / jobs / team / inbox / audit | `/control?panel=shared` |
| Calculations / conversions / dates / timers / source lookups | `/control?panel=tools` |
| Encrypted vault | `/control?panel=vault` |
| Music and podcast playback | `/control?panel=music` (the sticky player itself is mounted once in the root layout) |
| Plan, usage and entitlement keys | `/control?panel=plan` |
| Local reminders and explicit notification permission | `/control?panel=reminders` |
| Conversation history / individual conversation | `/control?panel=conversations`, `panel=conversation&id=...` |
| Conversation digest / search / timeline | `panel=memory`, `panel=memory-search`, `panel=timeline` |

Old feature URLs redirect into these sections. Old welcome/night entries return to Today; the active-session dark screen remains available from its voice controls. OAuth callbacks, offline fallback and compatibility routes are not additional primary product destinations.

## Clarity fixes (2026-09-15)

Users reported that the new features and navigation were hard to understand. The fixes are wording and structure, not new destinations:

| Before | After | Why |
| --- | --- | --- |
| A single line of quoted phrases (`Try: “20 pushups kar liye” · …`) | Grouped, tappable **Try one of these** chips | A list of quotes reads as decoration and cannot be tried without a microphone |
| “Pocket mode”, “Dark screen” | “Screen-off mode”, “Screen off” | “Pocket” and “dark” described an implementation, not the outcome |
| “Evidence, not just ‘done’” | “What you actually did” | Plain language for the activity view |
| “An optional opening” | “One question — only if you want it” | Says who initiates and that it is optional |
| “OneBrain / Workspace”, “Workspace” | “OneBrain”, “Your space” | Matches the two navigation labels exactly |
| Plan shown as `YOU ARE ON FREE` with a beta-key field | Plan panel states **who decided** (account on the server / this browser only / nothing redeemed), whether it was verified this session, and per-feature usage against the limit that the server actually enforces | A plan without provenance invites the assumption that something was purchased |

Two rules keep this from regressing: strings asserted by the browser suite are pinned in `frontend/__tests__/ui-clarity.test.ts`, and the client's free limits are asserted equal to the worker's `PLAN_LIMITS` in the same file. No copy may imply a purchase — there is no checkout, invoice or renewal anywhere in the product.

## Design method and references

Read and applied the public [Appllama App Design Skill](https://github.com/Appllama/appllama-skills/blob/main/skills/appllama-app-design-skill/SKILL.md), [MCP Usage Skill](https://github.com/Appllama/appllama-skills/blob/main/skills/appllama-usage/SKILL.md), and the [Appllama library](https://appllama.io/).

The MCP initialize request to `https://mcp.appllama.io/mcp` failed with a TLS connection error in this environment. No authenticated MCP catalog/screens or credits were accessed, and no paid service or dependency was added. This is application of the public design guidance, not a claim of MCP-library research or native simulator certification.

Adapted principles to the existing Next/React app rather than replacing it with Expo:

- Warm neutral surfaces, one amber action accent, coherent outline icons; semantic error colors remain distinct.
- Literal action labels and an explicit first-use flow instead of a separate setup funnel.
- Less card nesting; grouped rows for tools, a focused composer, readable saved items.
- Consistent navigation, meaningful back paths, explicit review dialogs, no fake progress or sample records.
- Short press/panel feedback and an active-session voice indicator, not ambient decorative motion. The bars indicate session activity, not measured audio amplitude. Reduced motion disables animation.
- Sensitive tools do not mount until opened. Entering Your space uses fresh-document navigation, and that document never loads the third-party AI SDK.

## Safety preserved and defects fixed

Google-only/server-confirmed account states, explicit connector approval, no implicit upload or mic activation, local/server separation and physical-device caveats remain.

Local canvas deletion now preserves the `encrypted-vault:v1` entry in the shared IndexedDB `kv` table. Canvas export also excludes that entry; encrypted vault export/deletion are managed in its own panel. This fixes the earlier mismatch between the deletion UI's claim and the actual shared-table behavior. Multi-table canvas deletion stays transactional and failures propagate.

## Verification boundary

Production build and frontend typecheck; 194 frontend unit tests and 52 Chromium browser tests passed in local verification at the time of that review (current counts are in the 2026-09-16 section below). Tests include 320/390/768/1440px navigation, first-use capture and persistence, tool search/back paths, notification permission, Google fixture session states, real local D1 workflows, vault lifecycle, export/deletion and voice cancellation.

Screenshots were inspected at desktop and mobile sizes, including saved-item and account states; the inspected route pass reported no JavaScript page errors. These checks do not establish human comprehension, native iOS/Android parity, physical microphone reliability, measured low-end-device 60fps, live Google consent or full 175-requirement completion. New-user testing and independent review remain required.

## 2026-09-16 — five tabs, Track, one To-Do, one search box

- **Navigation label.** Five tabs must fit 320 px, so the tab reads **Space** while the page it opens keeps the heading **Your space**. `ui-clarity` now protects the new pairing instead of the old string, and `product-flow`, `settings` and `refinement` were updated in the same change as the rename — a protected string that is renamed silently is a lost guard.
- **Tabs stay plain `<a>`s.** The first version of the five-tab shell used `Link prefetch={false}`, and the existing “leaving Today starts a fresh document” tests failed in CI: soft navigation kept Today’s third-party provider script alive on Your space and left a pending microphone prompt hanging. The tab list is plain anchors again — the same copy, the same `aria-current`, and the document swap the privacy note depends on.
- **Retiring a panel without dead links.** `?panel=track|notes|canvas|to-do|shared-space` redirect (with a visible “taking you there” state and a manual link), and the catalog keeps every searchable word a user might type. `__tests__/shell-ux.test.ts` asserts that each catalog entry has a panel, a redirect or an outbound route that exists, and that every literal href in space search resolves.
- **No fourth store.** The unified To-Do is computed from the canvas items, reminders and (on an explicit click) shared server records; ticking a row writes back to its origin, and priority is stored as a machine line on the canvas item itself. A shared record is deliberately read-only here because a compare-and-swap edit belongs in Connected work.
- **Asking beats guessing.** Misheard commands get “did you mean …?” and only run the canonical phrase after an explicit yes that expires in two minutes. Sentences owned by another path — session commands, media grammar, reminder phrasing — are never intercepted, and a unit test replays every transcript the browser specs type to keep it that way.
- **Theme.** The `theme` preference existed with nothing reading it and nothing setting it. Both ends are now real: a **Dark / Light (beta)** radiogroup in Your space → Advanced drives `html[data-ob-theme]`. The swap is scoped per subtree, not at the root: declaring `--ob-text/--ob-muted/--ob-accent` on `html[data-ob-theme='light']` inherits into surfaces that product.css paints with hard-coded dark values, which put light-mode text on dark panels and failed axe color-contrast on WebKit in the compatibility matrix (Chromium and Firefox resolved it differently — “the app uses tokens” is only true of the parts that actually do). Tokens now live on the roots whose background flips with them: the tab bar, Track, Voice, You, the space result cards and the controls listed with them; everything else keeps its dark ground, and the switch says which parts move. Shipping a half-checked light mode as if it were designed would be the worse answer, so it is marked as a preview.
- **Accessibility is measured after the app settles.** The next WebKit report was `#eabb76 at half opacity on #090908` — axe sampling `.control-panel` inside its 180ms `panel-enter` opacity ramp, a false positive from a browser that happened to scan a few milliseconds earlier, not a design fault. The compat suite now asks for reduced motion and finishes running animations before scanning, so it measures the palette as shipped while still failing on genuine violations — and it prints axe’s measured numbers, because violation ids alone sent reviewers to a trace file they could not open.
- **Finishing a task must not make it disappear.** `groupTodo` bucketed only by due date and skipped done rows, so completing something took it out of “All open” and the Done view still listed nothing — the row was nowhere. It now collects finished rows under a “Finished” group. This was invisible to every unit test and visible in one browser run: the To-Do panel is the only place the two views meet.
- **Track tests own their data.** The first draft of `e2e/track.spec.ts` saved one task in a test and asserted it in a later one; Playwright contexts are per test, so the unified To-Do and search assertions were looking at an empty workspace. Each test now performs the save it depends on, and the capture type is selected explicitly instead of relying on a `task:` prefix in note mode.
- **Today is now the brief; the maze moved rather than vanished.** What a person reads at 8am is a greeting, today’s date, only the numbers that are actually true (open things, money today, ≈kcal, sleep, streak — `lib/today-brief.ts` contributes a fact only when there is one), one box that captures or asks, the microphone, and the last few saved records. What came out of it — search, the type filter, the canvas map, the receipt log with undo, the conversation record — is Your space → Notes & activity (`?panel=notes`), reachable from Today and from the catalog, and both surfaces open the same `ItemSheet`, so nothing was copied and nothing was dropped. `/active`, the route the app used to speak for “full-screen listening”, now lands on the Voice surface instead of the entire workspace. `__tests__/ui-clarity.test.ts` guards the shape (no `role="tablist"` on Today, Today’s page file under 520 lines) so the tool cabinet cannot quietly grow back.
- **Two authored stylesheets, not four.** `app/globals.css` is base layer + tokens + Tailwind; `app/product.css` is every surface (`app/shell.css` was folded into it, so import order no longer decides a cascade); `scripts/css-consolidate.mjs` is the reviewable pass that re-scoped `.brain-workspace`-era rules onto `.today-screen`/`.notes-panel` and deleted rules whose classes appear in no shipped source (673 lines). Line-count parity with the pre-redesign baseline is not the goal — ~1,250 lines of it are four new surfaces plus the light palette — but the dead weight is gone and a style now lives in one place.
- **Not taken in this pass.** Measured claims from the acceptance bar — captions under 300 ms and 60 fps on a mid-range Android phone — remain unverified because no physical device was available; the “expenses in under ten seconds” flow is written as a Playwright test and awaits its first CI run. Embedding-backed recall is deferred pending a vector-store decision.
