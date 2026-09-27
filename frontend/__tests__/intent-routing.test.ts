import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_PHRASES,
  KNOWN_MISROUTES,
  KNOWN_NIGHT_MISROUTES,
  KNOWN_REPAIR_MISROUTES,
  NIGHT_AUDIT_PHRASES,
  REPAIR_SCENARIOS,
  runAudit,
  runNightAudit,
  runRepairAudit,
  type AuditReport,
  type AuditRow,
  type RouteKind,
} from '@/lib/intent-audit';

// Intent-router ratchet.
//
// lib/intent-audit.ts runs everyday phrases through the REAL router and
// records where each one lands. This file freezes that record:
//
//   • a row that starts landing somewhere new fails here, so nobody can
//     change routing by accident;
//   • a row on the known-broken list that starts landing correctly also fails
//     here, which forces the list entry to be deleted — the list can only
//     shrink.
//
// Findings in the comments refer to docs/AUDIT-2026-09-27-VOICE-AND-INTENT.md.

// Pin only Date. The router reads the real clock for day ranges and for the
// night gate (lib/nightmind.ts::isNightHour); faking timers or promises too
// would stall the async branches under test.
vi.useFakeTimers({ toFake: ['Date'] });

const DAY = new Date(2026, 8, 27, 10, 30, 0); // Sun 27 Sep 2026, mid-morning
const NIGHT = new Date(2026, 8, 27, 23, 30, 0); // same day, inside the night gate

let day: AuditReport;
let repair: AuditRow[];
let night: AuditRow[];

beforeAll(async () => {
  vi.setSystemTime(DAY);
  day = await runAudit();
  repair = await runRepairAudit();
  vi.setSystemTime(NIGHT);
  night = await runNightAudit();
  vi.setSystemTime(DAY); // leave the clock on the day pin for the assertions below
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
});

function renderTable(rows: AuditRow[]): string {
  return rows
    .map((r) =>
      [
        r.ok ? 'ok' : r.known ? 'known-broken' : 'NEW-BREAK',
        r.key,
        `expect=${r.expect}`,
        `got=${r.got}`,
        r.effects.length ? `writes=${r.effects.join(', ')}` : '',
        r.detail.length > 48 ? `${r.detail.slice(0, 47)}…` : r.detail,
      ]
        .filter(Boolean)
        .join(' | '),
    )
    .join('\n');
}

function checkRatchet(rows: AuditRow[], known: Record<string, RouteKind>, label: string): void {
  const unlisted = rows
    .filter((r) => !r.ok && !r.known)
    .map((r) => `${r.key} -> ${r.got} (expected ${r.expect})`);
  expect(unlisted, `${label}: routing changed and the row is not on the ratchet`).toEqual([]);

  const stale = Object.entries(known)
    .map(([key, got]) => {
      const row = rows.find((r) => r.key === key);
      if (!row) return `${key}: no longer in the table`;
      if (row.ok) return `${key}: now routes correctly — delete this entry`;
      if (row.got !== got) return `${key}: recorded as ${got}, now ${row.got}`;
      return null;
    })
    .filter((x): x is string => x !== null);
  expect(stale, `${label}: ratchet entries went stale`).toEqual([]);
}

describe('intent routing — everyday phrases', () => {
  it('the whole table (snapshot: any routing change shows up as a diff)', () => {
    expect(renderTable(day.rows)).toMatchInlineSnapshot(`
      "ok | what is the date today | expect=clock | got=clock | Today is Sunday, 27 September 2026.
      ok | what's the date today | expect=clock | got=clock | Today is Sunday, 27 September 2026.
      ok | what is today’s date and time | expect=clock | got=clock | Today is Sunday, 27 September 2026.
      ok | what day is it today | expect=clock | got=clock | Today is Sunday, 27 September 2026.
      ok | what time is it | expect=clock | got=clock | It is 10:30 am.
      ok | aaj ka din kaunsa hai | expect=clock | got=clock | Today is Sunday, 27 September 2026.
      ok | aaj ki date kya hai | expect=clock | got=clock | Today is Sunday, 27 September 2026.
      ok | create a task to call mom | expect=capture-draft | got=capture-draft | call mom
      ok | task: call mom | expect=capture-draft | got=capture-draft | call mom
      ok | note: buy milk | expect=capture-draft | got=capture-draft | buy milk
      ok | update my profile name | expect=ai | got=ai | fell through to the AI chain
      ok | I will be late today | expect=ai | got=ai | fell through to the AI chain
      ok | generate a plan for my week | expect=ai | got=ai | fell through to the AI chain
      ok | translate this sentence for me | expect=ai | got=ai | fell through to the AI chain
      ok | what is the price of rice today | expect=ai | got=ai | fell through to the AI chain
      ok | great job on the report | expect=ai | got=ai | fell through to the AI chain
      ok | how do I sleep better at night | expect=ai | got=ai | fell through to the AI chain
      ok | let us do 20 pushups | expect=ai | got=ai | fell through to the AI chain
      ok | I spent no time on this | expect=ai | got=ai | fell through to the AI chain
      ok | what should I do to lose weight fast | expect=ai | got=ai | fell through to the AI chain
      ok | I spent 2 hours on the report | expect=ai | got=ai | fell through to the AI chain
      ok | this is a different problem | expect=ai | got=ai | fell through to the AI chain
      ok | my parents are coming tomorrow | expect=ai | got=ai | fell through to the AI chain
      ok | semi final match kab hai | expect=ai | got=ai | fell through to the AI chain
      ok | remind me why we did it this way | expect=ai | got=ai | fell through to the AI chain
      ok | what does this remind you of | expect=ai | got=ai | fell through to the AI chain
      ok | aage batao | expect=ai | got=ai | fell through to the AI chain
      ok | continue explaining the last point | expect=ai | got=ai | fell through to the AI chain
      ok | aur sunao | expect=ai | got=ai | fell through to the AI chain
      ok | revise my note about the meeting | expect=ai | got=ai | fell through to the AI chain
      ok | padhai karni hai aaj | expect=ai | got=ai | fell through to the AI chain
      ok | placement of the button is wrong | expect=ai | got=ai | fell through to the AI chain
      ok | business idea soch raha hun | expect=ai | got=ai | fell through to the AI chain
      ok | what is the suicide rate in india | expect=ai | got=ai | fell through to the AI chain
      ok | news about self harm laws | expect=ai | got=ai | fell through to the AI chain
      ok | track my order status | expect=ai | got=ai | fell through to the AI chain
      ok | the last meeting was on monday | expect=ai | got=ai | fell through to the AI chain
      ok | yeh phone best hai kya | expect=ai | got=ai | fell through to the AI chain
      ok | what is under the sea | expect=ai | got=ai | fell through to the AI chain
      ok | main soch raha tha ki movie dekhein | expect=ai | got=ai | fell through to the AI chain
      ok | start the timer for 5 minutes | expect=timer | got=timer | writes=workout -> timer-300 | Timer set for 5 min. I will speak up when it is…
      ok | set a timer of 10 minutes | expect=timer | got=timer | writes=workout -> timer-600 | Timer set for 10 min. I will speak up when it i…
      ok | timer chalu karo | expect=timer | got=timer | Kitne minute ka timer? Bolo “5 minute ka timer”…
      ok | remind me to buy 2 things | expect=ai | got=ai | fell through to the AI chain
      ok | call mom at 5 pm | expect=reminder | got=reminder | "Call mom" @ 17:00 2026-09-27
      ok | remind me to pay rent at 9am tomorrow | expect=reminder | got=reminder | "Pay rent" @ 09:00 2026-09-28
      ok | kharcha 200 chai | expect=fitness-log | got=fitness-log | writes=wrote log expense "Spent ₹200 — chai" ₹200 | expense "Spent ₹200 — chai"
      ok | 2 roti khayi | expect=fitness-log | got=fitness-log | writes=wrote log food "2 Roti" | food "2 Roti"
      ok | 20 pushups kar liye | expect=fitness-log | got=fitness-log | writes=wrote log workout "20 Pushups" | workout "20 Pushups"
      ok | 6 ghante soya | expect=fitness-log | got=fitness-log | writes=wrote log sleep "Slept 6 hrs" | sleep "Slept 6 hrs"
      ok | 8 glass paani piya | expect=fitness-log | got=fitness-log | writes=wrote log water "Water 8 glass" | water "Water 8 glass"
      ok | energy low | expect=fitness-log | got=fitness-log | writes=wrote log energy "Energy low" | energy "Energy low"
      ok | what expenses did I do today | expect=log-query | got=log-query | No expenses logged for today, Sunday, 27 Septem…
      ok | kal kitna kharcha hua | expect=log-query | got=log-query | No expenses logged for Saturday, 26 September y…
      ok | how much did I spend this week | expect=log-query | got=log-query | No expenses logged for this week yet. Say “khar…
      ok | how much time did I spend yesterday | expect=log-query | got=log-query | No expenses logged for Saturday, 26 September y…
      ok | how do I track my expenses | expect=track | got=track | Track · expenses · expenses/month
      ok | open my expenses this month | expect=track | got=track | Track · expenses · expenses/month
      ok | fitness summary | expect=fitness-summary | got=fitness-summary | Today: 0 workouts (none yet) · 0 kcal ≈ from 0 …
      ok | show my open tasks | expect=todo | got=todo | Your To-Do list is empty. Say “task: renew the …
      ok | what is the current status of my task | expect=todo | got=todo | Your To-Do list is empty. Say “task: renew the …
      ok | set my monthly budget to 20000 | expect=track | got=track | writes=budget -> 20000 | Budget set · expenses/month
      ok | what is my budget this month | expect=track | got=track | Budget · expenses/month
      ok | open track | expect=track | got=track | Track · expenses · expenses/month
      ok | morning brief | expect=brief | got=brief | Morning brief
      ok | close my day | expect=brief | got=brief | Close my day
      ok | follow ups | expect=brief | got=brief | follow-up radar
      ok | money due | expect=brief | got=brief | money guard (0 dues)
      ok | what did I ask yesterday | expect=recall | got=recall | You have not asked anything yet in this convers…
      ok | i asked about the loan last monday | expect=recall | got=recall | Monday, 21 September
      ok | compare iphone and pixel | expect=research | got=research | "iphone and pixel"
      ok | stop | expect=session | got=session | stop
      ok | continue | expect=session | got=session | continue
      ok | play kesariya | expect=media | got=media | play "kesariya"
      ok | 15 + 7 | expect=local-answer | got=local-answer | 22"
    `);
  });

  it('misroutes only shrink: every misroute is recorded, every record still misroutes', () => {
    checkRatchet(day.rows, KNOWN_MISROUTES, 'AUDIT_PHRASES');
    expect(day.misrouted).toBe(Object.keys(KNOWN_MISROUTES).length);
  });

  it('the phrase table has no duplicate rows', () => {
    const seen = new Set<string>();
    const dupes = AUDIT_PHRASES.filter((p) => (seen.has(p.text) ? true : (seen.add(p.text), false))).map(
      (p) => p.text,
    );
    expect(dupes).toEqual([]);
  });

  it('keeps answering the documented phrases — a router fix must not break these', () => {
    const documented = [
      'kharcha 200 chai',
      '2 roti khayi',
      '20 pushups kar liye',
      '6 ghante soya',
      '8 glass paani piya',
      'energy low',
      'what expenses did I do today',
      'kal kitna kharcha hua',
      'fitness summary',
      'show my open tasks',
      'set my monthly budget to 20000',
      'what is my budget this month',
      'open track',
      'morning brief',
      'follow ups',
      'money due',
      'compare iphone and pixel',
      'stop',
      'continue',
      'play kesariya',
      '15 + 7',
      'task: call mom',
      'note: buy milk',
      'remind me to pay rent at 9am tomorrow',
    ];
    const broken = documented.filter((text) => {
      const row = day.rows.find((r) => r.text === text);
      return !row || !row.ok;
    });
    expect(broken, 'documented phrases stopped working').toEqual([]);
  });

  it('the day clock is what the table was written against', () => {
    // Guards the harness itself: if the pin drifts into night hours the whole
    // table changes meaning and every row would look like a regression.
    expect(new Date().getHours()).toBe(10);
  });
});

describe('intent routing — after a log exists (the “fix the last entry” branch)', () => {
  it('the whole table (snapshot)', () => {
    expect(renderTable(repair)).toMatchInlineSnapshot(`
      "ok | kharcha 200 chai → wrong, it was 10 | expect=log-repair | got=log-repair | writes=overwrote last log -> expense "Spent ₹10 — chai" ₹10 | Fixed — last log is now Spent ₹10 — chai. Say u…
      ok | 2 roti khayi → nahi maine 3 roti khayi | expect=log-repair | got=log-repair | writes=overwrote last log -> food "3 Roti" | Fixed — last log is now 3 Roti. Say undo if tha…
      ok | kharcha 200 chai → change 5 | expect=ai | got=ai | fell through to the AI chain
      ok | kharcha 200 chai → yeh galat hai 2 baar bolna pada | expect=ai | got=ai | fell through to the AI chain
      ok | 2 roti khayi → pichla entry hata do | expect=log-delete | got=log-delete | Deleted — "2 Roti" is gone. Say undo to put it …
      ok | 6 ghante soya → not 6, it was 8 | expect=log-repair | got=log-repair | writes=overwrote last log -> sleep "Slept 8 hrs" | Fixed — last log is now Slept 8 hrs. Say undo i…
      ok | kharcha 200 chai → it was 500 not 200 | expect=log-repair | got=log-repair | writes=overwrote last log -> expense "Spent ₹500 — chai" ₹500 | Fixed — last log is now Spent ₹500 — chai. Say …
      ok | 2 roti khayi → actually 4 roti | expect=log-repair | got=log-repair | writes=overwrote last log -> food "4 Roti" | Fixed — last log is now 4 Roti. Say undo if tha…
      ok | kharcha 200 chai → aaj ka kharcha 500 tha | expect=log-repair | got=log-repair | writes=overwrote last log -> expense "Spent ₹500 — chai" ₹500 | Fixed — last log is now Spent ₹500 — chai. Say …
      ok | kharcha 200 chai → undo that | expect=log-undo | got=log-undo | Undone — I dropped "Spent ₹200 — chai". Nothing…"
    `);
  });

  it('misroutes only shrink', () => {
    checkRatchet(repair, KNOWN_REPAIR_MISROUTES, 'REPAIR_SCENARIOS');
    expect(repair.filter((r) => !r.ok).length).toBe(Object.keys(KNOWN_REPAIR_MISROUTES).length);
  });

  it('every scenario has a distinct seed → phrase key', () => {
    const keys = REPAIR_SCENARIOS.map((s) => `${s.seed} → ${s.text}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('intent routing — hour-dependent (night gate)', () => {
  it('the whole table (snapshot)', () => {
    expect(renderTable(night)).toMatchInlineSnapshot(`
      "ok | main soch raha tha ki movie dekhein | expect=ai | got=ai | fell through to the AI chain
      ok | neend nahi aa rahi | expect=night-note | got=night-note | writes=saved night note | saved (worry)
      ok | kal exam hai tension ho rahi hai | expect=night-note | got=night-note | writes=saved night note | saved (worry)"
    `);
  });

  it('misroutes only shrink', () => {
    checkRatchet(night, KNOWN_NIGHT_MISROUTES, 'NIGHT_AUDIT_PHRASES');
    expect(night.filter((r) => !r.ok).length).toBe(Object.keys(KNOWN_NIGHT_MISROUTES).length);
  });

  it('the night pin is inside the gate (21:00–05:00)', () => {
    expect(NIGHT_AUDIT_PHRASES.length).toBeGreaterThan(0);
    const h = new Date(NIGHT).getHours();
    expect(h >= 21 || h < 5).toBe(true);
  });
});

describe('audit summary', () => {
  it('counts (snapshot: these numbers only move when routing does)', () => {
    expect({
      phrases: day.total,
      correct: day.correct,
      misrouted: day.misrouted,
      destructive: day.destructive,
      seeded: repair.length,
      seededBroken: repair.filter((r) => !r.ok).length,
      night: night.length,
      nightBroken: night.filter((r) => !r.ok).length,
    }).toMatchInlineSnapshot(`
      {
        "correct": 75,
        "destructive": 0,
        "misrouted": 0,
        "night": 3,
        "nightBroken": 0,
        "phrases": 75,
        "seeded": 10,
        "seededBroken": 0,
      }
    `);
  });
});
