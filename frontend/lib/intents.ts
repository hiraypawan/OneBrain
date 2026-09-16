// Canonical phrases the deterministic engine actually handles. Used by the
// "did you mean…?" path (lib/fuzzy) to recover from a single misheard word, and
// by the hint chips so the two never drift apart. `say` is re-run through the
// SAME transcript path a spoken line takes — nothing here is special-cased.
//
// Only phrases handleFeatureTurn() itself resolves may appear here: session
// words (stop, new chat, repeat), media (play/pause) and reminder phrasing are
// owned by other paths, are already excluded from the fuzzy gate, and would
// otherwise offer a confirmation that runs nothing.

export interface IntentHint {
  /** The exact phrase the engine handles. */
  say: string;
  /** What we call it to the user when asking for confirmation. */
  label: string;
}

export const INTENT_HINTS: IntentHint[] = [
  // Money + logging
  { say: 'kharcha 200 chai', label: 'log an expense — “kharcha 200 chai”' },
  { say: 'what expenses did I do today', label: 'today’s expenses' },
  { say: 'kal kitna kharcha hua', label: 'yesterday’s spending' },
  { say: 'how much did I spend this week', label: 'this week’s spending' },
  { say: 'open my expenses this month', label: 'the Expenses view in Track' },
  { say: '2 roti khayi', label: 'log food — “2 roti khayi”' },
  { say: 'yesterday khana kya khaya', label: 'yesterday’s food diary' },
  { say: '20 pushups kar liye', label: 'log a workout — “20 pushups kar liye”' },
  { say: '6 ghante soya', label: 'log sleep — “6 ghante soya”' },
  { say: '8 glass paani piya', label: 'log water — “8 glass paani piya”' },
  { say: 'energy low', label: 'note today’s energy' },
  { say: 'fitness summary', label: 'today’s fitness summary' },
  { say: 'show my health trends', label: 'the Health view in Track' },
  { say: 'show my workouts', label: 'the Workouts view in Track' },
  // Thinking + memory
  { say: 'morning brief', label: 'your morning brief' },
  { say: 'close my day', label: 'the close-my-day recap' },
  { say: 'what did I ask yesterday', label: 'what you asked yesterday' },
  { say: 'follow ups', label: 'your follow-up radar' },
  { say: 'money due', label: 'bills and dues you mentioned' },
  { say: 'show my open tasks', label: 'your open tasks' },
  // Body + time
  { say: 'set my monthly budget to 20000', label: 'set the Track monthly spend limit' },
  { say: 'what is my budget this month', label: 'your budget and how the month is going' },
  { say: 'show my food diary today', label: 'today’s food diary in Track' },
  { say: 'open track', label: 'the Track tab' },
];
