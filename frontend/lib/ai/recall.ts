import type { ChatHistory } from './gemini';

// Keyword recall: find older messages relevant to the current query.
// Recency-weighted word overlap — no embeddings, no server, fully local.
// Honest scope: lexical match, not semantic search (that needs a vector DB).
const STOP = new Set(
  ('what,when,where,which,who,whom,how,why,that,this,with,from,have,has,had,will,' +
    'would,there,their,about,into,over,after,before,between,kaun,kya,kab,kahan,' +
    'kaise,kitna,batao,bolo,suno,mujhe,mera,meri,tera,teri,aap,tum,main,mein').split(',')
);

const SYNONYM_GROUPS = [
  ['preference', 'prefer', 'prefers', 'preferred', 'like', 'likes', 'liked', 'love', 'loves', 'favourite', 'favorite', 'pasand'],
  ['name', 'naam'],
  ['work', 'job', 'career', 'profession', 'kaam', 'naukri'],
  ['food', 'meal', 'eat', 'eats', 'eating', 'khana'],
] as const;
const CANONICAL = new Map<string, string>();
for (const group of SYNONYM_GROUPS) for (const word of group) CANONICAL.set(word, group[0]);

function canonicalWord(word: string): string {
  return CANONICAL.get(word) || word.replace(/(?:ing|ed|es|s)$/u, '');
}

function canonicalTerms(text: string): string[] {
  const out: string[] = [];
  const raw = String(text || '').normalize('NFKC').match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  for (const token of raw) {
    const w = token.toLocaleLowerCase();
    const acronym = token.length >= 2 && token.length <= 5 && /^[A-Z0-9]+$/.test(token) && /[A-Z]/.test(token);
    if ((w.length > 3 || acronym) && !STOP.has(w)) {
      const canonical = canonicalWord(w);
      if (canonical && !out.includes(canonical)) out.push(canonical);
    }
  }
  return out;
}

export function keywords(text: string): string[] {
  return canonicalTerms(text).slice(0, 8);
}

export interface ScoredExcerpt {
  content: string;
  role: string;
  score: number;
  createdAt: number;
  conversationTitle?: string;
}

export function recallRelevant(
  query: string,
  pool: { role: string; content: string; createdAt: number; conversationTitle?: string }[],
  limit = 3
): ScoredExcerpt[] {
  const keys = keywords(query);
  if (!keys.length || !pool?.length) return [];
  const now = Date.now();
  const scored: ScoredExcerpt[] = [];
  for (const m of pool) {
    const terms = new Set(canonicalTerms(m.content));
    const hits = keys.reduce((count, key) => count + (terms.has(key) ? 1 : 0), 0);
    if (!hits) continue;
    const ageDays = Math.max(0, (now - m.createdAt) / 86400000);
    const recency = 1 / (1 + ageDays / 14);
    scored.push({
      content: m.content.slice(0, 300),
      role: m.role,
      score: hits * (0.5 + 0.5 * recency),
      createdAt: m.createdAt,
      conversationTitle: m.conversationTitle,
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function formatRecall(excerpts: ScoredExcerpt[]): string {
  if (!excerpts.length) return '';
  return (
    'Relevant earlier exchanges (saved-chat excerpts; dates and titles identify their source):\n' +
    excerpts.map((e) => {
      const timestamp = new Date(e.createdAt);
      const date = Number.isFinite(e.createdAt) && !Number.isNaN(timestamp.getTime())
        ? timestamp.toISOString().slice(0, 10)
        : '';
      const source = [e.conversationTitle ? `“${e.conversationTitle.slice(0, 60)}”` : '', date].filter(Boolean).join(', ');
      return `- ${e.role === 'user' ? 'User' : 'You'} said: "${e.content}"${source ? ` (source: ${source})` : ''}`;
    }).join('\n')
  );
}

export type HistoryMsg = ChatHistory & { createdAt?: number };
