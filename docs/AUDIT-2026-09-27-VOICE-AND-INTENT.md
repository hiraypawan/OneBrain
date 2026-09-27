# Audit 2026-09-27 — voice capture and intent routing

**Scope:** the two symptoms reported from a real phone ("I have to press Start talking twice — the first
session hears nothing", and "whatever I say is logged as a meal — I asked what the date is and it said
*meal logged*"), then a sweep of every deterministic intent path a spoken or typed turn can take.

**Status of this document:** findings + fix plan. No product code was changed to produce the findings.
**Phase 0 (guardrails) and Phase 1 (microphone session) are now implemented** — see
[What landed](#what-landed-phase-0--phase-1) below. Phases 2–4 are still plan only.

**Method.** Every finding below was reproduced against the *real* modules in this repo (first with a
throwaway mirror harness outside the repo, now with the committed harness described in
[What landed](#what-landed-phase-0--phase-1), which calls the real router — `lib/fitness.ts`, `lib/briefing.ts`,
`lib/nightmind.ts`, `lib/personas.ts`, `lib/story.ts`, `lib/research.ts`, `lib/timetravel.ts`,
`lib/track.ts`, `lib/workout.ts`, `lib/witness.ts`, `lib/email.ts`, `lib/scribe.ts`, `lib/translate.ts`,
`lib/commands.ts`, `lib/reminders.ts`, `lib/numbers.ts`, `lib/workspace/voice.ts`,
`lib/feature-engine.ts::detectFitnessRangeQuery`), executed in the same order
`useAssistant.processTranscript` → `handleFeatureTurn` runs them. Nothing was hand-copied.
The routing numbers in the Headline below are from that first mirror harness. The committed harness
re-measured them against the real `handleFeatureTurn` and the numbers moved a little — both tables are
kept, with the differences called out, in [What landed](#what-landed-phase-0--phase-1).

---

## Headline

| | |
|---|---|
| Everyday phrases tested through the real router | **61** |
| Routed where a user would expect | **18 (30 %)** |
| Misrouted | **43 (70 %)** |
| Misroutes that **write data, change mode, or navigate** | **27 (44 %)** |
| Documented `INTENT_HINTS` chips that do not do what their own label says | **5 of 24** (+1 partial) |

Misrouted into: `FITLOG 9 · AI 6 · LOGQ 3 · BRIEF 5 · PERSONA 4 · REPAIR 4 · STORY 2 · DISTRESS 2 ·
TRACKVIEW 2 · WORKOUT 1 · REMINDER 1 · MEDIA 1 · NIGHT 1 · RECALL 1 · RESEARCH 1`.

Both reported symptoms are real defects with single, nameable root causes — **V1** (a mic re-acquire
orphans the recognizer) and **I1 + I2** (unanchored substring matching, plus English words parsed as
Hindi numbers). They are not device quirks.

---

## What landed (Phase 0 + Phase 1)

Implemented 2026-09-27 on branch `arena/01a0e0fc-onebrain`. The reported two-click bug (**V1**) is
fixed; the misrouting (**I1** …) is measured and fenced, not yet fixed.

### Guardrails — `npm run audit:intents`

| File | What it is |
|---|---|
| `frontend/lib/intent-audit.ts` | The harness. Runs a table of everyday phrases through the **real** router (`processTranscript` gates → `handleFeatureTurn`), classifies the branch that took each one, and reports what it wrote. Dev tooling — no screen imports it. |
| `frontend/scripts/intent-audit.mjs` | `npm run audit:intents`: bundles the harness for plain Node, pins the clock (10:30 day / 23:30 night), prints the table, exits 1 on a new misroute or on a fixed row still listed. `--json`, `--only <text>`. |
| `frontend/__tests__/intent-routing.test.ts` | The **ratchet**. A snapshot of all 88 rows plus two invariants: no phrase may land somewhere new, and a phrase on the known-broken list that starts landing correctly *fails the suite* until its entry is deleted. The list can only shrink. |
| `frontend/__tests__/numbers-collisions.test.ts` | **I2** as a ratchet (`do`=2, `no`=9, `so`=100, `tin`=3, `bara`=12, `tera`=13, `sath`=60) next to the spoken-number parsing that must keep working. |
| `frontend/__tests__/voice-session-wiring.test.ts` | **V1–V6** as source-wiring assertions, in the style of `__tests__/media-wiring.test.ts`. Verified non-vacuous: 15 of its 16 assertions fail against the pre-fix `hooks/useAssistant.ts`. |
| `frontend/e2e/voice-stub.ts` | One honest microphone/engine double for every voice spec: `mediaDevices` is a real `EventTarget` (so `devicechange` reaches the app), a fresh track per `getUserMedia`, every recognizer and track counted on `window`, plus `emitError(code)` and a `deafEngine` mode. |
| `frontend/e2e/voice-session.spec.ts` | The session specs that were impossible before: first tap after a `devicechange`, a device change mid-conversation, **Stop releases the mic**, an earbud track ending, repeated device changes never stacking recognizers, an engine that accepts `start()` and never comes up, `language-not-supported`. |
| `frontend/__tests__/e2e-contract.test.ts` | Updated: `lib/intent-audit.ts` is excluded from the "copy that can render" scan, so an audit fixture phrase cannot retire a browser-suite exception. |

**Re-measured with the committed harness** (clock pinned, offline, real `handleFeatureTurn`):

| | mirror harness (Headline above) | committed harness |
|---|---|---|
| Everyday phrases | 61 | **75** |
| Land where they should | 18 (30 %) | **34 (45 %)** |
| Misrouted | 43 | **41** |
| Misroutes that write data or flip a mode | 27 | **19** |
| Seeded "fix the last log" scenarios | not measured | **10 scenarios, 8 misrouted** |
| Night-hour phrases | 1 | **3 phrases, 2 misrouted** |

The mirror was not wrong, it was incomplete. Four corrections the real router forced:

* **I3 needs history.** `detectLogRepair` is inert on a fresh store, so *"change 5"*, *"wrong, it was
  10"* and *"nahi 20"* reach the AI harmlessly — and rewrite the last log the moment one exists
  (`kharcha 200 chai` → *"change 5"* → ₹5, no confirmation). Those rows moved out of the everyday
  table into a seeded one. The seeded table also found the mirror's blind spot: the obvious English
  corrections — *"not 6, it was 8"*, *"it was 500 not 200"*, *"actually 4 roti"*, *"undo that"* — are
  **not** recognised at all, and *"pichla entry hata do"* answers "Fixed" while changing nothing.
* **I6 lands on the plan gate.** *"placement of the button is wrong"* enters `interview-coach` and is
  then refused by the persona quota, so the visible outcome is a plan card, not a persona switch. Same
  mechanism, different symptom.
* **I8 writes by day, not only by night.** *"what is the suicide rate in india"* and *"news about self
  harm laws"* save a `worry` night note at 10:30 in the morning: `detectNightIntent` matches crisis
  vocabulary with no hour check and no question guard.
* **Two chips are better than documented.** *"how do I track my expenses"* opening Track is a fair
  answer, and *"what did I ask yesterday"* is answered by the recall branch (empty state included), so
  both rows were corrected rather than left red.

Suite state after Phase 0 + Phase 1: **777 unit tests pass** (734 before), `tsc --noEmit` clean,
`eslint` clean, `npm run audit:intents` exits 0 with the ratchet holding.

### Microphone session — `frontend/hooks/useAssistant.ts`

| Finding | What changed |
|---|---|
| **V1** | The recognizer moved out of `startActive` into `startRecognition()` — built from **current** settings, callable from anywhere. `teardownRecognition()` stops the engine and detaches its handlers before dropping the ref. `acquireMic` tears down and then **rebuilds** whenever the session should still be listening; `resumeListening` rebuilds when there is nothing left to resume; `stopActive` tears down, so Stop can no longer leave an orphan holding the mic. |
| **V2** | A watchdog after every `start()`: if the engine never confirms, rebuild once; if it is still deaf, say *"Mic is on but nothing is being heard — tap Stop, then Start talking again."* The one-rebuild budget deliberately survives the rebuild, or an engine that never starts would be rebuilt every 8 s in silence. |
| **V3** | `language-not-supported` falls back to `en-IN` once and says so; three consecutive `no-speech` say *"Nothing is being heard…"*, and hearing anything withdraws it; `aborted` is our own doing and stays quiet. |
| **V4** | Only a real identity change ends a session. `device → an account id` (signing in) keeps the mic alive; a different account, or signing out, still tears it down. |
| **V5** | `speakingRef` is claimed with a token, and only the reply holding that token releases it. |
| **V6** | An effect keyed on `settings.language` and `settings.endOfSpeechMs` rebuilds the recognizer mid-session. |
| **V7** | **Deferred** — one session owner is an architectural refactor (two `useAssistant()` providers) with test fallout of its own, and not a live bug while only one surface mounts at a time. Separate task. |

**Not verifiable in this sandbox:** the browser suite. Playwright's CDN is unreachable here
(`ECONNRESET` from `cdn.playwright.dev`), so `e2e/voice-session.spec.ts` has not been executed; it
runs in CI (`npm run test:e2e`, chromium). The wiring test is the local guard for the same invariants.

---

# A. Voice capture and the session lifecycle

### V1 — CRITICAL — **FIXED** — Any mic re-acquisition left the session permanently deaf (this is the "press twice" bug)

`acquireMic()` starts by tearing down the recognition binding:

```ts
// hooks/useAssistant.ts:1240-1242
recogRef.current = null;
collectorRef.current?.reset();
collectorRef.current = null;
```

but the recognizer is **only ever constructed in `startActive()`** (`hooks/useAssistant.ts:1470`,
started at `:1666`). Every recognition callback is guarded by identity:

```ts
if (!current() || recogRef.current !== recog) return;   // :1482, :1486, :1490, :1499, :1531, :1573, :1604, :1645
```

So once `acquireMic(true)` runs mid-session, the recognizer keeps running while **every result is
thrown away**. Nothing rebuilds it:

* `resumeListening()` → `if (!recog) return;` (`:186`) — no-op.
* `sendNow()` → `collectorRef.current?.sendNow() ?? false` (`:1917`) — the "Send now" button is dead.
* `recover()` (`:1688`) calls `acquireMic(true)` and then `resumeListening()` — also a no-op.
* `startActive()` early-returns because `isActive` is already true (`:1395`).

The UI still reads **listening** the whole time. The only way out is Stop → Start talking — exactly
what the user described.

**Triggers (all reachable on a phone, the first one on the very first click):**

1. **`devicechange` → `handleDevices` (`:1360-1366`) → `acquireMic(true)`.** Chrome fires
   `devicechange` when the device list/labels change — which happens **the first time microphone
   permission is granted** (the code itself documents this at `:1266`: *"Mic permission granted
   => the browser now reveals device labels"*). The listener is attached at `:1422`, before
   `setIsActive(true)` and `recog.start()` complete their macrotask, so the event lands on a live
   session. Second click: permission already granted → no event → it works.
2. Bluetooth/earbud connect or disconnect, or a multipoint handover (`:1360`).
3. `track.onended` — another app or a call takes the mic (`:1282-1294`).
4. Returning from background/screen-off through `recover()` when the track died (`:1688-1730`).

**Second consequence — the mic stays hot after Stop.** `stopActive()` only calls
`recogRef.current?.stop()` (`:1777`). After the ref was nulled, the *live* recognizer is never
stopped, so the browser's own capture can keep running while the UI says "Ready when you are". That
contradicts the on-screen promise *"Nothing is recorded until you press start"*
(`components/voice/VoiceSurface.tsx:161-163`) and burns battery.

**Why CI never saw it:** `e2e/voice-turn.spec.ts:37-38` stubs
`mediaDevices.addEventListener(){}` / `removeEventListener(){}`, so `devicechange` cannot fire in any
browser test, and no unit test exercises `acquireMic` at all. The whole failure class is untestable as
the mocks are written.

**Fix direction (Phase 1):** never null the binding without rebuilding. Extract one
`ensureRecognition()` used by `startActive`, by every `acquireMic` retry and by `recover()`; keep a
separate hard ref to the constructed recognizer so `stopActive()` can always stop it; re-`start()`
after the new stream is live.

---

### V2 — HIGH — **FIXED** — Nothing ever confirmed the recognizer is actually hearing

`recognitionReadyRef` flips true on `onstart` only (`:1481-1484`) and is used solely to gate proactive
invitations (`:1841-1846`). A recognizer that starts but delivers nothing — wrong acoustic model, no
route to the speech service, mic owned by another capture — leaves `currentStatus === "listening"`
forever with an animated orb. There is no watchdog, no "first audio heard" signal, and no honest
state for *"mic open, hearing nothing"*. This is why every silent failure in this file *looks* like
V1 to the user.

---

### V3 — HIGH — **FIXED** — Most recognition error codes were swallowed

`recog.onerror` (`:1572-1601`) messages only `not-allowed`/`service-not-allowed`, `audio-capture` and
`network`. Everything else — **`language-not-supported`**, `no-speech`, `aborted` — falls through to
*"loop resumes via onend"* with no user-visible reason.

This matters because the app's **default** language is `hinglish`, which maps the recognizer to
`hi-IN` (`:1474-1478`), and `marathi` maps to `mr-IN`. `mr-IN`/`hi-IN` recognition is not present on
every iOS Safari or Android build; where it is missing, the engine reports
`language-not-supported` and the loop restarts forever in silence. There is no fallback to `en-IN`
and no message.

---

### V4 — MEDIUM — **FIXED** — A background identity refresh silently killed a live session

```ts
// hooks/useAssistant.ts:143-147
useEffect(() => {
  if (sessionOwnedRef.current || processingRef.current || speakingRef.current)
    controlsRef.current.stopActive();
  else sessionGenerationRef.current += 1;
  ...
}, [historyKey]);            // historyKey = `proactive-history:${store.user?.id || "device"}`
```

`hydrate()` never restores `user` (`store/assistant.ts`), so `historyKey` starts as
`proactive-history:device` and changes to `proactive-history:<id>` when `StoreHydrator`'s `/me`
request resolves and calls `loginBackend` (`components/StoreHydrator.tsx:26-31`,
`store/assistant.ts:317-321`). A signed-in user who taps **Start talking** inside that window has the
session torn down by an unrelated network response, with no message. Same class as V1 from the
user's chair.

---

### V5 — MEDIUM — **FIXED** — `speakingRef` could be orphaned, which also deafened the session

`speak()` bumps `speechRequestRef` at entry (`:277`) and its whole cleanup is gated on
`if (current())` (`:515-528`). When a second `speak()` starts, the first call's `finally` is skipped.
If that second call then returns **before** it sets `speakingRef = false` — the Silent-Mode branch
(`:283-295`) and the empty-text branch (`:298`) both return before `speakingRef.current = true` at
`:303` — the flag stays `true` permanently. `recog.onend` requires `!speakingRef.current` to restart
(`:1628-1633`), so the session never listens again. Recovery is, again, Stop → Start.

---

### V6 — MEDIUM — **FIXED** — Recognition language and end-of-speech wait were frozen at session start

`recog.lang` (`:1474-1478`) and the assembler's `silenceMs` (`:1497`) are read once when the session
starts. Changing Settings → Voice language, or the pause-before-send slider, has no effect on a
running session; nothing re-binds on `settings.language` / `settings.endOfSpeechMs` (no effect in the
file depends on either).

---

### V7 — LOW/MEDIUM — **DEFERRED (separate task)** — Two independent `useAssistant()` owners exist

`components/today/TodayView.tsx:66` and `components/voice/VoiceSurface.tsx:40` each instantiate the
hook, so each owns its own refs, its own 5-second proactive interval (`:1801`) and its own
stop-on-unmount (`:1903`). Only one is mounted today, but any future surface that mounts a second
instance duplicates proactive invitations and lets one component's unmount kill the other's session.

---

### V8 — Design gap — No barge-in, and no visible "I'm talking" affordance

Recognition is deliberately stopped while OneBrain speaks (`:303-306`) so it cannot hear itself. That
is the right call until echo cancellation is proven (ROADMAP item 5), but there is no on-screen
"OneBrain is talking — tap to interrupt", so a long reply reads as a dead microphone.

---

# B. Intent routing — why ordinary sentences become logs

### I1 — CRITICAL — Unanchored substring matching in `parseFitnessLog` (the "meal logged" bug)

```ts
// lib/fitness.ts:194
if (/(ate|khaya|khayi|kha liya|khaa|breakfast|lunch|dinner|nashta|meal|snack|piya)/.test(lower) || ...
// lib/fitness.ts:210-211
if (/(khaya|khayi|kha liya|ate|meal|khana kha)/.test(lower))
  return { status:'ok', log:{ kind:'food', label:'Meal logged', detail: t.slice(0,80) } };
```

`ate` has no word boundary, so it matches inside **date, late, create, update, generate, translate,
private, plate, duplicate, estimate, immediate, candidate, appreciate, validate, separate,
temperature**… Real output:

```
what is the date today        -> FITNESS LOG -> food: "Meal logged"
what's the date today         -> FITNESS LOG -> food: "Meal logged"
what is today's date and time -> FITNESS LOG -> food: "Meal logged"
create a task to call mom     -> FITNESS LOG -> food: "Meal logged"
update my profile name        -> FITNESS LOG -> food: "Meal logged"
I will be late today          -> FITNESS LOG -> food: "Meal logged"
generate a plan for my week   -> FITNESS LOG -> food: "Meal logged"
translate this sentence for me-> FITNESS LOG -> food: "Meal logged"
```

This is the user's exact report, and it also eats **task creation by voice** ("create a task to call
mom" logs a meal instead of drafting a task). It hits typed input identically — Today's one box and
the Voice quick chips go through the same `handleTranscript` path
(`components/today/TodayView.tsx:95,188`).

Sibling defects in the same function: `sleep` (`:99`), `ml|liter|water` (`:117` — `ml` has no
boundary at all, `liter` matches "literally"), `weight` (`:130`), `spent|paid|diya` (`:137`), and the
FOODS table (`:45-77`) where `rice` matches "price", `tea` matches "steam"/"team", `anda` matches
"standard", `dosa` matches "dosage".

### I2 — CRITICAL — **RATCHETED** — `findNumber` reads common English words as Hindi numbers

`lib/numbers.ts:7-38` maps `do:2`, `no:9`, `so:100`, `che:6`, `tin:3`, `tera:13`, `sola:16`, … and
`findNumber` scans *every* token run with no language check (`:92-131`). Real output:

```
how do I sleep better at night  -> 2   (from "do")     ⇒ logs "Slept 2 hrs"
I do not know                   -> 2   (from "do")
no thanks                       -> 9   (from "no")
so what                         -> 100 (from "so")
I spent no time on this         -> 9   (from "no")     ⇒ logs "Spent ₹9"
tin can                         -> 3   (from "tin")
let us do 20 pushups            -> 2   (from "do")     ⇒ logs "2 Pushups" — the DIGIT 20 is ignored
nothing to do today             -> 2   (from "do")
```

`findNumber` prefers an earlier *word* over a later *digit* (`:117-123`), so a natural sentence like
"let us do 20 pushups" logs **2** pushups. Every quantity in the product — food, expense, workout,
water, sleep, reminders, log repair — inherits this.

### I3 — CRITICAL — **RATCHETED** — `detectLogRepair` silently rewrites history

```ts
// lib/fitness.ts:390-395
if (!/(change|correct|galat|wrong|nahi|fix|last (wala|entry|log)|pichla)/.test(t)) return null;
const n = findNumber(t);
return n && n.value > 0 ? n.value : null;
```

Any sentence containing `nahi`/`wrong`/`galat`/`change`/`fix` **plus any number** mutates the last
workout/expense/water/food row, rescaling calories and amount by ratio
(`store/features.ts:327-336`). Real output:

```
yeh galat hai 2 baar bolna pada -> LOG-REPAIR overwrites last log with 2
change 5                        -> LOG-REPAIR overwrites last log with 5
wrong, it was 10                -> LOG-REPAIR overwrites last log with 10
nahi 20                         -> LOG-REPAIR overwrites last log with 20
```

`nahi` alone appears in a huge fraction of Hinglish speech. No confirmation, no undo prompt.

### I4 — HIGH — The router has no interrogative guard at all

Nothing in `processTranscript` or `handleFeatureTurn` asks "is this a question?" before acting. Real
output:

```
how do I sleep better at night      -> FITNESS LOG sleep "Slept 2 hrs"
what should I do to lose weight fast-> LOG-QUERY (answered from the device log)
I spent 2 hours on the report       -> LOG-QUERY ("No expenses logged today yet…")
```

### I5 — HIGH — `detectBriefIntent` money branch reduces to "contains emi|rent|recharge"

```ts
// lib/briefing.ts:60
/(money (due|pending|guard)|paise (dene|bharne)|bills? (due|pending)|kharcha (hisab|kitna)|emi|rent|recharge).*(batao|dikhao|kya|list)?/
```

`.*` matches empty and the trailing group is optional, so the whole test collapses to "contains `emi`,
`rent` or `recharge`" — and none of them are word-bounded: `rent` inside *current*, *different*,
*parents*; `emi` inside *semi*, *premium*. Real output:

```
this is a different problem     -> BRIEF money ("No bills or dues I can see…")
my parents are coming tomorrow  -> BRIEF money
semi final match kab hai        -> BRIEF money
remind me why we did it this way-> BRIEF money
what does this remind you of    -> BRIEF money
```

### I6 — HIGH — Sticky persona modes are entered by accident

`lib/personas.ts:64,76,88` triggers are unanchored (`placement`, `business idea`, `padhai`, `revise`).
Once entered, `handleFeatureTurn` routes **every later turn** through that persona
(`lib/feature-engine.ts:468-470`) until the user says the exact phrase "exit mode"
(`lib/personas.ts:105-108`). Real output:

```
revise my note about the meeting -> PERSONA enter study-buddy
padhai karni hai aaj             -> PERSONA enter study-buddy
placement of the button is wrong -> PERSONA enter interview-coach
business idea soch raha hun      -> PERSONA enter startup-mentor
```

Nothing in the Voice or Today surface shows that a mode is active, so the user experiences this as
"the assistant stopped understanding me".

### I7 — HIGH — "continue"/"aage batao" start a bedtime story; "aur sunao" starts music

```ts
// lib/story.ts:41  (no anchors, no session check before routing)
if (/(aage sunao|continue|phir kya hua|next part|aage batao|aur sunao)/.test(t)) return {action:'continue'};
// lib/feature-engine.ts:481 → storyTurn(...) creates a NEW thread when none exists (:1105-1117)
```

```
aage batao                     -> STORY continue   (starts "Jungle Doston ki Kahani")
continue explaining the last point -> STORY continue
aur sunao                      -> MEDIA play "aur" (commands.ts:125 accepts any "X sunao")
```

`aage batao` / `aur sunao` are ordinary Hinglish follow-ups meaning "tell me more [about what we were
just discussing]". They should continue the *conversation*, not start a children's story or a music
search.

### I8 — HIGH — `distressCheck` hijacks informational questions and writes a note

`lib/nightmind.ts:41` matches bare topic words; `lib/feature-engine.ts:206-214` runs it at priority 0,
replies with the canned crisis text **and saves the transcript as a night note**.

```
what is the suicide rate in india -> DISTRESS canned support + night note saved
news about self harm laws         -> DISTRESS canned support + night note saved
```

### I9 — MEDIUM/HIGH — Reminders are created from any sentence containing "remind" + any digit

`lib/reminders.ts:47` accepts `remind` anywhere; `:85` then takes the **first 1–2 digit number in the
string** as the hour.

```
remind me to buy 2 things -> REMINDER saved "Buy 2 things" @ 02:00 tomorrow
```

A 2 a.m. reminder is created silently. Conversely, a real reminder phrased without the verb
("call mom at 5 pm") is **not** caught and goes to the AI.

### I10 — MEDIUM — The night-hour gate captures normal evening speech

`lib/feature-engine.ts:501`: between 21:00 and 05:00, any sentence longer than 12 characters
containing `soch raha|soch rahi|tension hai|neend nahi|sapna aaya|mann bhari|mann udaas` is stored as
a night note and answered with "Saved. 🌙 So jao" — no answer to the actual question.

```
main soch raha tha ki movie dekhein -> NIGHT NOTE saved (no answer)
```

### I11 — MEDIUM — `detectFitnessRangeQuery` treats "report/total/show" as a question

`lib/feature-engine.ts:791-806`: a fitness word + any of
`what|how much|kitna|…|show|total|report|summary|bache` becomes a log query, and it runs **before**
`parseTrackCommand` (`:380` vs `:385`).

```
I spent 2 hours on the report -> LOG-QUERY
what should I do to lose weight fast -> LOG-QUERY
```

### I12 — MEDIUM — `parseTrackCommand` navigates on the word "track"

`lib/track.ts:850` (`wantsOpen = /^(open|show|…)/ || /\b(track)\b/`) and `:838` (budget-status matches
`my`+`set`).

```
track my order status    -> TRACK open expenses/month
how do I track my expenses -> TRACK open expenses/month
```

### I13 — MEDIUM — `detectRecallIntent` matches unanchored "last … monday" / "i asked"

`lib/timetravel.ts:170` → `the last meeting was on monday` becomes a memory-recall answer about that
day instead of ordinary conversation.

### I14 — MEDIUM — `detectResearchIntent` launches web research from casual questions

`lib/research.ts:32-34`: any 16–200-char sentence containing `under|below|vs|best|review` **and**
`batao|dikhao|suggest|recommend|options|kaunsa|kya` → a multi-search research brief. `kya` is one of
the most common Hinglish words.

```
yeh phone best hai kya -> RESEARCH web brief: "yeh phone best hai kya"
```

### I15 — MEDIUM — `detectWorkoutIntent` gate contains bare `start|timer|rest|sets|seconds`

`lib/workout.ts:94` then `:106` (`/(workout|timer|hiit).*(shuru|start|karo|begin)/`) →

```
timer chalu karo -> WORKOUT seven-minute   (a full HIIT session with spoken cues)
```

### I16 — MEDIUM — `moneyDue` flags unrelated notes as bills

`lib/briefing.ts:174` (`bill|emi|rent|fee|fees|gas|school|premium|sip|renew|…`, unanchored) is applied
to every saved note and reminder title/body:

```
buy coffee for the team   -> money due   (fee in "coffee")
current status of the task-> money due   (rent in "current")
renewed hope              -> money due
school of thought         -> money due
premium quality rice      -> money due
a sip of water            -> money due
```

These pollute the morning brief and the "money guard".

### I17 — MEDIUM — Expense detail is mangled by an unanchored currency strip

`lib/fitness.ts:144` `.replace(/₹|rs\.?|inr|\$|usd/gi,'')` removes `rs` **inside words**:

```
I spent 2 hours on the report -> FITNESS LOG expense "Spent ₹2 — I hou on the report"
```

(The 2026-09-10 audit lists "could match a currency abbreviation inside another word" as repaired; it
is not.)

### I18 — HIGH — `looksFactual` puts a Wikipedia fetch on the critical path of nearly every turn

`lib/knowledge.ts:10-18`: `FACTUAL_START` matches `who|what|when|where|which|list|name|tell me
about|current|latest|kaun|kya|kab|kahan|kitne|aaj|abhi` — i.e. essentially every question. Each such
turn pays a 7 s-timeout Wikipedia search **before** the AI call (`lib/brain.ts:54-58`), and when no
provider answers, the raw wiki extract *is* the reply (`lib/brain.ts:115`). In the harness, 8 of the
13 phrases that reached the AI chain carried `+wikipedia-fetch`.

### I19 — CRITICAL GAP — There is no deterministic clock

The most basic questions a voice assistant gets have **no local answer at all**:

```
what day is it today     -> AI chain (+wikipedia fetch)
what time is it          -> AI chain (+wikipedia fetch)
aaj ka din kaunsa hai    -> AI chain (+wikipedia fetch)
```

They depend on Puter.js loading, or `/api/chat` reaching Gemini/the community model. Offline, the
answer is `localBrain()`'s apology (`lib/brain.ts:120-125`) or a Wikipedia extract. The clock *is*
injected into the system prompt (`lib/gemini.ts:16-32`), so this is purely a routing gap:
`interpretLocal` (`lib/workspace/voice.ts`) already answers "what's my day" and plain arithmetic and
is the natural home for date/day/time.

### I20 — GAP — No voice timers/stopwatch

`lib/utilities.ts` has pure, tested timer functions and the Everyday-tools panel has a UI, but no
spoken intent reaches them: `start the timer for 5 minutes` and `set a timer of 10 minutes` both fall
through to the AI, and `timer chalu karo` starts a workout (I15).

---

# C. Documented behaviour that does not match the docs or the UI

### D1 — 4 Track chips never open Track

`INTENT_HINTS` (`lib/intents.ts`) promises a view; `detectFitnessRangeQuery` runs first
(`lib/feature-engine.ts:380` before `:385`), so the chip returns a text summary plus a
"View in Track →" link (`components/features/FeatureCards.tsx:643-655`) instead of navigating:

```
open my expenses this month | "the Expenses view in Track" | LOG-QUERY
show my health trends       | "the Health view in Track"   | LOG-QUERY
show my workouts            | "the Workouts view in Track" | LOG-QUERY
show my food diary today    | "today's food diary in Track"| LOG-QUERY
```

### D2 — `close my day` and `what am i forgetting` never reach the briefing module

`interpretLocal` runs in `processTranscript` **before** `handleFeatureTurn`
(`hooks/useAssistant.ts:843-861`) and claims `what am i forgetting|what's my day|close my day|start my
workday` (`lib/workspace/voice.ts:19-23`), returning the thin `summarizeDay` line:

```
close my day | "the close-my-day recap" | LOCAL answer: "0 open tasks, 0 overdue. No tasks recorded…"
```

`compileCloseDay` (finished, rollover, tomorrow's top 3) and `forgettingScan` are unreachable by voice.

### D3 — Labs gating is UI-only

`settings.labsEnabled` is consulted **only** in `components/control/ControlCenter.tsx:150-151`. The
voice router has no Labs gate, so Stories and Email drafts — both documented as *"hidden from Your
space until you turn Labs on"* (ROADMAP) — are fully live by voice, and per I7 Stories triggers by
accident.

### D4 — Queued turns are concatenated

ROADMAP: *"Turns that arrive while busy are queued, not dropped."* True, but
`hooks/useAssistant.ts:1083-1086` merges them into one 4 000-char string, so two separate
instructions become one garbled sentence for the parser and the model.

---

# D. Fix plan

Ordered so that the two reported symptoms are fixed first, and so every later change is measured by a
table that already exists.

### Phase 0 — Guardrails (no behaviour change) · ~0.5 day — **DONE**, see [What landed](#what-landed-phase-0--phase-1)

1. Commit the harness as `frontend/scripts/intent-audit.mjs` (Appendix A) and add
   `frontend/__tests__/intent-routing.test.ts`: a golden table of *phrase → expected route* covering
   (a) the 61 everyday phrases above and (b) all 24 `INTENT_HINTS` chips. Land it as a **snapshot of
   today's behaviour** so each later fix flips rows visibly instead of being trusted on review.
2. Make the browser stubs honest: `e2e/voice-turn.spec.ts` must implement
   `mediaDevices.addEventListener/dispatchEvent` so `devicechange`, `track.onended` and
   visibility-resume can be simulated. Add specs: *"a transcript after a device change still gets an
   answer"*, *"Stop actually stops the recognizer"*, *"an unsupported recognition language says so"*.
3. Add `__tests__/numbers.test.ts` cases for the English/Hindi collisions (I2).

### Phase 1 — Make the microphone trustworthy (fixes the reported two-click bug) · ~1 day — **DONE except V7 (deferred)**

1. **V1:** extract `ensureRecognition()`; call it from `startActive`, from every `acquireMic` retry and
   from `recover()`. Stop nulling `recogRef`/`collectorRef` on retry — rebind, don't destroy. Keep a
   separate `builtRecogRef` that `stopActive()` always stops, so the mic can never stay hot.
2. **V2:** add a hearing watchdog — no `onstart` in 3 s, or no `onspeechstart`/first result in ~8 s of
   "listening" → one automatic rebuild, then an explicit state
   *"Mic is on but nothing is being heard — tap to restart"*. The UI must never say `listening` while
   results are being discarded.
3. **V3:** handle every error code; on `language-not-supported` retry once with `en-IN` and say so.
4. **V4:** on `historyKey` change, migrate `historyRef`/`historyReadyRef` — never `stopActive()` during
   a live session.
5. **V5:** make `speakingRef` a request token that always clears in `finally`, independent of
   `current()`.
6. **V6:** rebuild recognition when `settings.language` or `settings.endOfSpeechMs` changes mid-session.
7. **V7:** hoist the hook into a single provider (`components/ProviderScript`-style context) so there
   is one session owner.

### Phase 2 — Stop the router from hijacking ordinary speech · ~1.5–2 days

1. New `lib/intent-guard.ts`: `isQuestion()`, `hasLoggingVerb()`, and a bounded-word matcher
   (`hasWord(text, 'ate')`) that every detector must use. No detector may match inside another word.
2. **I1/I17/I18:** rewrite `parseFitnessLog` gates with boundaries; require *topic word + logging verb
   + a real quantity*; refuse when `isQuestion()`; fix the `rs` strip to `\brs\.?\b`; bound the FOODS
   table (`\brice\b`, `\btea\b`, `\banda\b`, `\bdosa\b`).
3. **I2:** gate Hindi number words behind a Hinglish check (reuse `lib/prompt.ts::HINGLISH`) and drop
   the collision words (`do, no, so, che, tin, tera, sola, bara, nau, das…`) unless a unit/digit
   context confirms them; a digit always beats an ambiguous word.
4. **I3:** `detectLogRepair` requires the explicit repair shape ("change/correct **last log** to N",
   "last wala N kar do"), only within a few minutes of the log, and confirms before writing
   ("Last log was X — change to Y? say save or cancel"). Never mutate on `nahi`/`wrong`.
5. **I5/I16:** anchor `briefing.ts` money regexes and require a due/pending companion word.
6. **I6/I7/I15:** sticky modes (persona, story, translator, scribe, witness) require an anchored
   *enter* phrase; follow-ups (`continue`, `aage batao`, `aur sunao`, `next part`) only act when that
   session is already active, otherwise they continue the conversation with history. Surface the active
   mode + one-tap exit in Voice and Today. Auto-expire a mode after N idle turns.
7. **I8:** keep crisis detection but require first-person/self context (`I/my/main/mujhe` + the crisis
   phrase) or an exact match; informational questions go to the AI with the helpline appended, and
   never write a night note.
8. **I9:** reminders require a *time expression* (`in N minutes`, `N am/pm`, `N baje`, `HH:MM`) — never
   a bare digit. Add the missing "call mom at 5 pm" shape only with an explicit ask-verb.
9. **I10/I11/I12/I13/I14:** anchor and narrow; navigation (`TRACK open`) only from an explicit
   open/show verb; research only from an explicit research/compare verb.
10. **I19:** add a deterministic clock (date, weekday, time, "aaj ka din") in `lib/workspace/voice.ts`
    or a new `lib/clock.ts`, answered in the reply language, checked before every feature.
11. **I20:** add spoken timers/stopwatch on top of `lib/utilities.ts`.
12. **I18:** take Wikipedia off the critical path — fetch in parallel with a ~2.5 s budget and only for
    entity-shaped questions; never return a raw extract as the answer.
13. **D1/D2/D3:** make the chips do what their labels say (route `open …`/`show … in Track` to
    navigation before the log query; let `close my day`/`what am i forgetting` reach the briefing
    module), and gate Labs features in the router on `settings.labsEnabled`.
14. Flip the Phase-0 golden table to the *expected* routes and keep all 24 documented chips green.

### Phase 3 — Honest states · ~0.5–1 day

* "OneBrain is talking — tap to interrupt" while a reply plays (barge-in stays parked per ROADMAP).
* Every accepted turn shows "Heard: …" even when a gate drops it — never drop silently
  (`drop-silent` in `lib/voiceprint.ts:96-100` currently adds the user line with no explanation).
* Undo for every voice-written row (logs, reminders, night notes), matching the expense Undo Track
  already has.
* Merge policy for queued turns (D4): keep them as separate turns.

### Phase 4 — Device validation (human, not sandbox)

Android Chrome and iOS Safari, speaker + wired + Bluetooth earbuds, first-permission flow,
screen-off/pocket mode, and a 9 pm–5 am run for the night gate. Record results in
`docs/DEVICE-VALIDATION.md`. Until this is done, V1/V3 remain *code-proven but not device-confirmed*.

### Risk notes

* Tightening regexes will lose some genuine Hinglish logs. The mitigation is the golden table (both
  everyday phrases *and* the documented ones), plus "did you mean…?" confirmation for near-misses
  instead of silent action — the fuzzy path already exists (`lib/fuzzy.ts`, `lib/intents.ts`).
* No destructive or irreversible action (log repair, night note, reminder, persona entry) should ever
  fire from a single loose keyword again. Confirmation-first is the rule this audit recommends
  adopting in `docs/ROADMAP.md`.

---

## Appendix A — reproducing the evidence

The harness is committed, so the evidence is reproducible from the repo itself:

```bash
cd frontend && npm ci
npm run audit:intents              # table + summary, exit 1 on a new misroute
npm run audit:intents -- --json    # machine-readable rows
npm run audit:intents -- --only date
npx vitest run __tests__/intent-routing.test.ts __tests__/numbers-collisions.test.ts
```

`lib/intent-audit.ts` calls `parseVoiceCommand`, `parseMediaCommand`, `isPauseCommand`,
`parseReminderIntent`, `interpretLocal`, `parseFitnessLog`, `detectLogRepair`, `parseTrackCommand`,
`detectFitnessRangeQuery`, `detectWitnessIntent`, `detectWorkoutIntent`, `detectEmailIntent`,
`detectScribeIntent`, `detectTranslatorIntent`, `detectPersonaIntent`, `detectStoryIntent`,
`detectNightIntent`, `distressCheck`, `isNightHour`, `detectResearchIntent`, `detectRecallIntent`,
`detectBriefIntent`, `detectCommitment` and `sharedIntent` through the same `processTranscript` gates,
and then calls the **real** `handleFeatureTurn` instead of replaying its detectors — so the table
cannot drift from the router it measures. The clock is pinned (10:30 and 23:30 local) because
`isNightHour()` and the day/week/month ranges read the real one.

The original mirror harness (kept here for provenance) bundled the detectors alone, outside the repo:

```bash
mkdir -p /tmp/audit && cd /tmp/audit && npm i esbuild@0.25.12
# stub the two runtime deps the pure modules transitively import:
#   node_modules/zustand/index.js -> export const create = () => ({ getState: () => ({}), subscribe: () => () => {} })
#   node_modules/dexie/index.js   -> chainable Proxy default export
npx esbuild harness.ts --bundle --platform=node --format=esm --outfile=out.mjs \
  --external:zustand --external:dexie
NODE_PATH=/tmp/audit/node_modules node out.mjs
```

It was measured 2026-09-27 at 04:00 UTC (`isNightHour() === true`, which is why the night-gate row
fired). The committed harness supersedes those numbers — see
[What landed](#what-landed-phase-0--phase-1) for the four rows it corrected.

## Appendix B — not verified here

* No real device, no browser binaries and no network egress for provider calls in this sandbox, so
  V1's *first-click* trigger (`devicechange` on permission grant) is argued from the Chromium
  behaviour the code itself documents at `hooks/useAssistant.ts:1272-1276`, not observed on hardware.
  The deaf-session mechanism is deterministic in code regardless of which trigger fires, and
  `e2e/voice-session.spec.ts` now simulates the trigger — but that spec has not been run here
  (Playwright's CDN is unreachable in the sandbox), so the fix is proven by
  `__tests__/voice-session-wiring.test.ts` and by review, not by a green browser run.
* Unit tests **were** run after Phase 0 + Phase 1 (777 pass, up from a 734-test baseline; `tsc` and
  `eslint` clean). The Workers tests, Playwright and compatibility suites were not.
* Puter/community-model answer quality, music sources, FX/weather and Google sign-in remain as
  documented in `README.md` and `docs/IMPLEMENTATION-STATUS.md` — unverified, unchanged by this audit.
