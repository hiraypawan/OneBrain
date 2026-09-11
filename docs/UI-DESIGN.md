# OneBrain: two primary screens

Updated 2026-09-11. This is an implemented UI rework, not a claim that every product requirement is complete or that usability has been validated with new users.

## The everyday flow

1. **Today (`/`)** explains the product: notes, tasks and questions through voice or text. A user can start without an account.
2. Choose **Save a thought** or **Ask OneBrain**, or explicitly press **Start talking**. First-use examples fill the composer; they never silently save sample data.
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
| Local reminders and explicit notification permission | `/control?panel=reminders` |
| Conversation history / individual conversation | `/control?panel=conversations`, `panel=conversation&id=...` |
| Conversation digest / search / timeline | `panel=memory`, `panel=memory-search`, `panel=timeline` |

Old feature URLs redirect into these sections. Old welcome/night entries return to Today; the active-session dark screen remains available from its voice controls. OAuth callbacks, offline fallback and compatibility routes are not additional primary product destinations.

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

Production build and frontend typecheck; 194 frontend unit tests and 52 Chromium browser tests pass in local verification. Tests include 320/390/768/1440px navigation, first-use capture and persistence, tool search/back paths, notification permission, Google fixture session states, real local D1 workflows, vault lifecycle, export/deletion and voice cancellation.

Screenshots were inspected at desktop and mobile sizes, including saved-item and account states; the inspected route pass reported no JavaScript page errors. These checks do not establish human comprehension, native iOS/Android parity, physical microphone reliability, measured low-end-device 60fps, live Google consent or full 175-requirement completion. New-user testing and independent review remain required.
