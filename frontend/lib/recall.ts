import type { ChatHistory } from './gemini';

// Keyword recall: find older messages relevant to the current query.
// Recency-weighted word overlap — no embeddings, no server, fully local.
// Honest scope: lexical match, not semantic search (that needs a vector DB).
const STOP = new Set(
  ('what,when,where,which,who,whom,how,why,that,this,with,from,have,has,had,will,' +
    'would,there,their,about,into,over,after,before,between,kaun,kya,kab,kahan,' +
    'kaise,kitna,batao,bolo,suno,mujhe,mera,meri,tera,teri,aap,tum,main,mein').split(',')
);

export function keywords(text: string): string[] {
  const out: string[] = [];
  for (const w of (text || '').toLowerCase().split(/[^\p{L}\p{M}]+/u)) {
    if (w.length > 3 && !STOP.has(w) && !out.includes(w)) out.push(w);
  }
  return out.slice(0, 8);
}

export interface ScoredExcerpt {
  content: string;
  role: string;
  score: number;
}

export function recallRelevant(
  query: string,
  pool: { role: string; content: string; createdAt: number }[],
  limit = 3
): ScoredExcerpt[] {
  const keys = keywords(query);
  if (!keys.length || !pool?.length) return [];
  const now = Date.now();
  const scored: ScoredExcerpt[] = [];
  for (const m of pool) {
    const text = String(m.content || '').toLowerCase();
    let hits = 0;
    for (const k of keys) if (text.includes(k)) hits++;
    if (!hits) continue;
    const ageDays = Math.max(0, (now - m.createdAt) / 86400000);
    const recency = 1 / (1 + ageDays / 7);
    scored.push({ content: m.content.slice(0, 300), role: m.role, score: hits * (0.5 + 0.5 * recency) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function formatRecall(excerpts: ScoredExcerpt[]): string {
  if (!excerpts.length) return '';
  return (
    'Relevant earlier exchanges:\n' +
    excerpts.map((e) => `- ${e.role === 'user' ? 'User' : 'You'} said: "${e.content}"`).join('\n')
  );
}

export type HistoryMsg = ChatHistory & { createdAt?: number };
