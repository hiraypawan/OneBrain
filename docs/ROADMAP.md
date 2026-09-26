# OneBrain roadmap

**Updated 2026-09-26.** One page. It says what OneBrain is for, what works today, what's next, and what's parked. `IMPLEMENTATION-STATUS.md` remains the detailed 176-row ledger; this is the direction.

## What OneBrain is

A voice-first assistant for your day: **say it, and OneBrain remembers, answers and reminds you — in the language you speak.** Notes, tasks, expenses and logs are saved on your device. You don't need an account.

Everything else serves that one loop: **speak → understood → saved or answered → found again later.**

## Works now (core)

| Area | State |
|---|---|
| Voice turns | Listens through pauses and sends the whole sentence after you stop (adjustable wait, "Send now"). Android repeats are merged. Turns that arrive while busy are queued, not dropped. |
| Understanding | One prompt builder for every AI provider: 20 recent turns plus a rolling summary, profile, relevant memories, today's tasks/reminders. Reply language is detected per turn (English / Hinglish / Hindi / Marathi / Spanish). Voice-transcript and follow-up rules. Live facts are used as reference, not as the reply. |
| Commands | Stop, pause, repeat, new chat and "not you" work with natural fillers ("okay stop please", "bhai bas karo"). |
| Today · Voice · Track · Space · You | The five tabs. Capture, expenses, fitness, to-do, reminders, notes and search. |
| Sign-in | One page (`/auth/login`), one Google button, clear errors, returns you where you were. **Needs operator setup** (see `GOOGLE-AUTH-SETUP.md`). |

## Next (in order)

1. **Turn on Google sign-in in production.** Create the OAuth client, deploy the Workers API, and verify one real consent on a phone.
2. **Physical-device voice check.** Android Chrome and iOS Safari, with earbuds: pauses, Hinglish, and background resume.
3. **Better answers without a key.** Measure Puter vs. community-model quality on 30 real Hinglish questions, and choose the default order from data.
4. **Scheduled morning brief** (opt-in), built on the existing Today brief.
5. **Interrupt by voice** (barge-in) once echo cancellation is proven on devices.

## Labs (hidden by default: Advanced → Labs)

Working code that isn't finished or verified. It's reachable by direct link, but hidden from Your space until you turn Labs on.

- **Stories:** bedtime stories with remembered characters.
- **Email drafts:** voice-drafted mails (no sending).
- **Music & podcasts:** keyless sources whose live playback is unproven.

A feature leaves Labs when it has a real-device check and at least one browser test.

## Parked (not being worked on)

Team RBAC beyond shared spaces, billing/payments, SSO/SAML, connector execution beyond the current adapters, server-side transcription, and compliance certification. They stay in the ledger. Nobody should build them before the "Next" list is done.

## Rules for new work

- Improve the core loop before adding surfaces. A new tab or panel needs a reason written here.
- Unfinished work ships behind Labs, never as a visible half-feature.
- Every user-facing fix gets a unit test; every flow change gets a browser spec.
