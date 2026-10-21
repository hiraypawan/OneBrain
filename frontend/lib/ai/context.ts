import { estimateTokens } from './profile';

// Per-request context budgeter. Everything must fit or small models truncate.
// Default envelope (~2150 tokens): profile 150 + summary 200 + recall 300 +
// recent messages fill the remaining ~1500.
export interface ContextEnvelope {
  profile: string;
  summary: string;
  recall: string;
  history: { role: string; content: string }[];
}

export const BUDGETS = { profile: 150, summary: 200, recall: 300, history: 1500, total: 2150 };

export function fitHistory(
  history: { role: string; content: string }[],
  budget = BUDGETS.history
): { role: string; content: string }[] {
  let used = 0;
  const out: { role: string; content: string }[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i].content) + 8;
    if (used + cost > budget) break;
    used += cost;
    out.unshift(history[i]);
  }
  // Always keep at least the latest exchange.
  if (!out.length && history.length) return history.slice(-2);
  return out;
}

export function assemblePrompt(envelope: ContextEnvelope): string {
  const parts: string[] = [];
  if (envelope.profile) parts.push(envelope.profile);
  if (envelope.summary) parts.push(`Conversation summary so far:\n${envelope.summary}`);
  if (envelope.recall) parts.push(envelope.recall);
  return parts.join('\n\n').slice(0, (BUDGETS.profile + BUDGETS.summary + BUDGETS.recall) * 4);
}
