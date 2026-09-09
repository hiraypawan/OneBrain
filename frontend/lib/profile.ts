import type { Digest } from './digest';

// Build the compact "who is this user" block prepended to every AI request.
// ~150 tokens: topics, routine notes, rolling summary. Pure + tested.
export function buildProfileBlock(input: {
  digest?: Digest | null;
  summary?: string | null;
  name?: string | null;
}): string {
  const lines: string[] = [];
  if (input.name) lines.push(`User's name: ${input.name}.`);
  const topics = (input.digest?.topics || []).slice(0, 6).map((t) => t.topic);
  if (topics.length) lines.push(`Frequent topics: ${topics.join(', ')}.`);
  for (const n of (input.digest?.routineNotes || []).slice(0, 3)) lines.push(`Routine: ${n}`);
  if (input.summary) lines.push(`Earlier conversation summary: ${input.summary}`);
  if (!lines.length) return '';
  return `What you remember about this user:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}
