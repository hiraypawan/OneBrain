import { digestMessages } from './digest';

// Rolling summary: fold the oldest half of a long session into ~5 lines so
// context stays bounded. Extractive (free, always works); the caller may
// replace it with an abstractive version when AI quota allows.
export interface Summarizable {
  role: string;
  content: string;
  createdAt: number;
}

export function extractiveSummary(msgs: Summarizable[], prev = ''): string {
  const users = msgs.filter((m) => m.role === 'user').map((m) => m.content.trim()).filter(Boolean);
  const firsts = users.slice(0, 3).map((u) => u.slice(0, 120));
  const topics = digestMessages(msgs.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })));
  const topicLine = topics.topics.slice(0, 5).map((t) => t.topic).join(', ');
  const parts: string[] = [];
  if (prev) parts.push(`Previously: ${prev}`);
  if (firsts.length) parts.push(`User asked about: ${firsts.join(' | ')}`);
  if (topicLine) parts.push(`Recurring topics: ${topicLine}`);
  if (topics.routineNotes[0]) parts.push(topics.routineNotes[0]);
  return parts.join('\n').slice(0, 800);
}

// Split session messages into [toSummarize, toKeep] by estimated tokens.
export function splitForCompaction<T extends { content: string }>(
  msgs: T[],
  est: (t: string) => number,
  keepBudget: number
): { summarize: T[]; keep: T[] } {
  let used = 0;
  const keep: T[] = [];
  // Walk from newest; everything that doesn't fit gets summarized.
  for (let i = msgs.length - 1; i >= 0; i--) {
    const cost = est(msgs[i].content) + 8;
    if (used + cost <= keepBudget) {
      used += cost;
      keep.unshift(msgs[i]);
    } else {
      return { summarize: msgs.slice(0, i + 1), keep };
    }
  }
  return { summarize: [], keep };
}

/**
 * Rolling-summary policy. The old rule was "every 20 user messages", which
 * meant the first 19 turns of a long session carried the whole transcript into
 * every call and the 21st arrived all at once. Instead: refresh on a short
 * turn window or when the un-summarized tail gets heavy, at most once every
 * 30 seconds, so the model always has a current compressed view.
 */
export interface SummaryState {
  /** How many user turns had been seen when the summary was written. */
  mark: number;
  at: number | null;
}

export interface SummaryStep {
  summary: string;
  state: SummaryState;
}

export const SUMMARY_WINDOW_TURNS = 6;
export const SUMMARY_TAIL_CHARS = 2400;
export const SUMMARY_MIN_INTERVAL_MS = 30000;

export function rollingSummaryStep(
  messages: Summarizable[],
  prev: string,
  state: SummaryState,
  now = Date.now(),
): SummaryStep | null {
  const userCount = messages.filter((m) => m.role === 'user').length;
  const sinceMark = messages.slice(state.mark > 0 ? state.mark : 0);
  const turnDelta = userCount - (state.mark || 0);
  const tailChars = sinceMark.reduce((n, m) => n + m.content.length, 0);
  if (turnDelta < SUMMARY_WINDOW_TURNS && tailChars < SUMMARY_TAIL_CHARS) return null;
  if (state.at && now - state.at < SUMMARY_MIN_INTERVAL_MS) return null;
  const fold = messages.slice(0, Math.max(0, messages.length - SUMMARY_WINDOW_TURNS * 2));
  if (!fold.length) return null;
  return { summary: extractiveSummary(fold, prev), state: { mark: messages.length, at: now } };
}
