# OneBrain documentation

Start with the root files, then come here for setup and status details.

## Start here

| Document | Read it when |
|---|---|
| [../AGENTS.md](../AGENTS.md) | You are about to change code (map, commands, conventions, invariants). |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | You need the system design: runtime, voice turn, locale, data boundaries, deploy. |
| [../frontend/lib/README.md](../frontend/lib/README.md) | You are looking for the right module in the frontend logic. |
| [../README.md](../README.md) | You want the product overview and the verification log. |

## Setting up and shipping

| Document | What it covers |
|---|---|
| [PLATFORM-SETUP.md](PLATFORM-SETUP.md) | Running the full stack locally (Next app + Workers API + local D1), security boundaries, connector setup. |
| [GOOGLE-AUTH-SETUP.md](GOOGLE-AUTH-SETUP.md) | Creating the Google OAuth client and secrets for sign-in. |
| [PR-RELEASE-GATES.md](PR-RELEASE-GATES.md) | What must be true before merging and releasing. |
| [FREE-TIER-CAPACITY.md](FREE-TIER-CAPACITY.md) | Cloudflare free-tier budget, request contracts and limits. |

## How it behaves

| Document | What it covers |
|---|---|
| [VOICE-OUTPUT.md](VOICE-OUTPUT.md) | How spoken replies work on every platform (audio tiers, iPhone rules, fallbacks). |
| [AGENT-UNDERSTANDING.md](AGENT-UNDERSTANDING.md) | What the assistant knows and does not know, and how it should answer. |
| [UI-DESIGN.md](UI-DESIGN.md) | The primary screens and their design decisions. |
| [DEVICE-VALIDATION.md](DEVICE-VALIDATION.md) | What counts as a working conversation on a real device. |
| [PHONE-TEST.md](PHONE-TEST.md) | Checklist for testing on real phones and earbuds. |

## Status and direction

| Document | What it covers |
|---|---|
| [ROADMAP.md](ROADMAP.md) | What works now, what is next, what is parked. |
| [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) | The numbered requirement ledger with evidence. |

## Archive

[archive/](archive/) keeps earlier plans, audits and release notes
(`BUILD-DOSSIER.md`, `FULL-PLAN.md`, `OPTIMIZATION-PLAN.md`,
`ARCHIVED-README.md`, `AUDIT-2026-09-11.md`, `UI-AND-BUG-AUDIT.md`). They are
history, not descriptions of the current product.
