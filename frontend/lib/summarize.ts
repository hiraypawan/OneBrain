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
