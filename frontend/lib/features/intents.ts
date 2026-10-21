// Canonical phrases the deterministic engine actually handles. Used by the
// "did you mean…?" path (lib/features/fuzzy) to recover from a single misheard word, and
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
  /**
   * Who sees it in the hint list (every hint is always used for matching):
   * 'hinglish' = Hinglish phrasing, 'english' = the English twin of one,
   * 'india' = an India-only feature (Indian rail, metro and flights).
   */
  audience?: 'hinglish' | 'english' | 'india';
}

export const INTENT_HINTS: IntentHint[] = [
  // Money + logging
  { say: 'kharcha 200 chai', label: 'log an expense — “kharcha 200 chai”', audience: 'hinglish' },
  { say: 'spent 12 on lunch', label: 'log an expense — “spent 12 on lunch”', audience: 'english' },
  { say: 'what expenses did I do today', label: 'today’s expenses' },
  { say: 'kal kitna kharcha hua', label: 'yesterday’s spending', audience: 'hinglish' },
  { say: 'how much did I spend yesterday', label: 'yesterday’s spending', audience: 'english' },
  { say: 'how much did I spend this week', label: 'this week’s spending' },
  { say: 'open my expenses this month', label: 'the Expenses view in Track' },
  { say: '2 roti khayi', label: 'log food — “2 roti khayi”', audience: 'hinglish' },
  { say: 'ate 2 eggs', label: 'log food — “ate 2 eggs”', audience: 'english' },
  { say: 'yesterday khana kya khaya', label: 'yesterday’s food diary', audience: 'hinglish' },
  { say: 'what did I eat yesterday', label: 'yesterday’s food diary', audience: 'english' },
  { say: '20 pushups kar liye', label: 'log a workout — “20 pushups kar liye”', audience: 'hinglish' },
  { say: 'did 20 pushups', label: 'log a workout — “did 20 pushups”', audience: 'english' },
  { say: '6 ghante soya', label: 'log sleep — “6 ghante soya”', audience: 'hinglish' },
  { say: 'slept 6 hours', label: 'log sleep — “slept 6 hours”', audience: 'english' },
  { say: '8 glass paani piya', label: 'log water — “8 glass paani piya”', audience: 'hinglish' },
  { say: 'drank 8 glasses of water', label: 'log water — “drank 8 glasses of water”', audience: 'english' },
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
  // Live transit and travel
  { say: 'mumbai local status', label: 'Mumbai local line status', audience: 'india' },
  { say: '12951 train status', label: 'a train’s live running status', audience: 'india' },
  { say: 'pune metro timings', label: 'metro timings for a city', audience: 'india' },
  { say: 'AI101 flight status mumbai', label: 'live flight position near a city', audience: 'india' },
  { say: 'trains from pune to mumbai', label: 'trains between two stations', audience: 'india' },
];

/** The hints worth showing this user: their phrasing, and India-only features only in India. */
export function visibleHints(locale: { hinglish: boolean; indian: boolean }): IntentHint[] {
  return INTENT_HINTS.filter((h) =>
    h.audience === 'hinglish' ? locale.hinglish
    : h.audience === 'english' ? !locale.hinglish
    : h.audience === 'india' ? locale.indian
    : true);
}

/** Quick-tap chips on the voice screen, in the user's phrasing. */
export function quickPhrases(locale: { hinglish: boolean }): string[] {
  return locale.hinglish
    ? ['what expenses did I do today', 'kharcha 200 chai', '20 pushups kar liye', 'morning brief', 'show my open tasks', 'stop listening']
    : ['what did I spend today', 'spent 12 on lunch', 'did 20 pushups', 'morning brief', 'show my open tasks', 'stop listening'];
}
