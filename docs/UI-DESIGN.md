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
- **Retiring a panel without dead links.** `?panel=track|notes|canvas|to-do|shared-space` redirect (with a visible “taking you there” state and a manual link), and the catalog keeps every searchable word a user might type. `__tests__/shell-ux.test.ts` asserts that each catalog entry has a panel, a redirect or an outbound route that exists, and that every literal href in space search resolves.
- **No fourth store.** The unified To-Do is computed from the canvas items, reminders and (on an explicit click) shared server records; ticking a row writes back to its origin, and priority is stored as a machine line on the canvas item itself. A shared record is deliberately read-only here because a compare-and-swap edit belongs in Connected work.
- **Asking beats guessing.** Misheard commands get “did you mean …?” and only run the canonical phrase after an explicit yes that expires in two minutes. Sentences owned by another path — session commands, media grammar, reminder phrasing — are never intercepted, and a unit test replays every transcript the browser specs type to keep it that way.
- **Theme.** The `theme` preference existed with nothing reading it. It is now wired as a labelled-beta token swap over the shared surfaces; dark remains the only fully reviewed palette, and the Today canvas keeps its hand-tuned colors. Shipping a half-checked light mode as if it were designed would be the worse answer, so it is marked as a preview.
- **Not taken in this pass.** The promised rebuild of Today into a calm brief (replacing the 1,541-line `NeuralWorkspace`) was not done; only its navigation and stylesheet ownership changed. Measured claims from the acceptance bar — captions under 300 ms and 60 fps on a mid-range Android phone — remain unverified because no physical device was available; the “expenses in under ten seconds” flow is written as a Playwright test and awaits its first CI run. Embedding-backed recall is deferred pending a vector-store decision.
