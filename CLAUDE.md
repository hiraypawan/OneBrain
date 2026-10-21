# CLAUDE.md

Everything an AI coding agent needs is in **[AGENTS.md](AGENTS.md)** — the
repository map, commands, where to change things, conventions and the
invariants that must not break. System design is in
[ARCHITECTURE.md](ARCHITECTURE.md); the frontend logic map is in
[frontend/lib/README.md](frontend/lib/README.md).

Minimum before finishing any change (from `frontend/`): `npm run typecheck`,
`npm run lint`, `npm test`; plus `npm run build` when routes, config or
imports change. For `workers/api/`: `npm run typecheck && npm test`.
