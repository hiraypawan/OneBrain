// Shared AI brain chain: Wikipedia facts -> Puter (keyless) -> backend /
// Next route (user key -> community -> offline) -> local fallback.
// Moved here from useAssistant so feature modes (personas, translator,
// research, scribe polish) can call the same chain with their own system
// prompts. Behavior for normal chat is unchanged.

import { askPuter } from './puter';
import { fallback as offlineFallback } from './gemini';
import { buildTurnPrompt, normalizeHistory } from './prompt';
import { looksFactual, fetchWikipedia } from './knowledge';
import { looksLive, liveFacts } from './websearch';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface ChatExtra {
  profile?: string;
  recall?: string;
  verbosity?: string;
  /** The user's language setting; the reply language is detected per turn. */
  language?: string;
  /** Replaces the default system prompt (personas, translator, research). */
  systemOverride?: string;
  /** Pro lane: longer provider timeout + skip the offline apology delay. */
  priority?: boolean;
  /** Optional OpenAI-compatible lane (user's own key/endpoint/model). */
  provider?: 'gemini' | 'openai';
  baseUrl?: string;
  model?: string;
}

export interface BrainAnswer {
  text: string;
  /** Which provider produced the answer: wikipedia, puter, gemini, openai, pollinations, key-error, server, offline. */
  provider: string;
}

export async function askBrain(
  message: string,
  history: { role: string; content: string }[],
  userKey?: string,
  extra?: ChatExtra,
): Promise<string> {
  return (await askBrainDetailed(message, history, userKey, extra)).text;
}

/** Same chain as askBrain, but also reports WHICH provider answered so the
 *  UI can show it honestly (and suggest a free Gemini key when offline). */
export async function askBrainDetailed(
  message: string,
  history: { role: string; content: string }[],
  userKey?: string,
  extra?: ChatExtra,
): Promise<BrainAnswer> {
  // One prompt builder for every provider (see lib/prompt.ts). Feature modes
  // with their own system prompt (translator, research…) keep it verbatim.
  let facts = '';
  if (!extra?.systemOverride) {
    // Factual questions fetch live facts, but the AI answers WITH them in the
    // user's language and context — Wikipedia is no longer the reply itself.
    try {
      if (looksFactual(message)) facts = (await fetchWikipedia(message))?.text || '';
    } catch { /* no facts */ }
    // Anything that changes (news, prices, results, schedules) is looked up on
    // the live web, keyless. Labelled per source so the model can say where a
    // number came from — and so it can say "not found" instead of inventing.
    try {
      if (looksLive(message)) {
        const web = await liveFacts(message);
        if (web) facts = facts ? `${facts}\n\nLive web sources:\n${web}` : `Live web sources:\n${web}`;
      }
    } catch { /* no facts */ }
  }
  const prompt = extra?.systemOverride
    ? { system: extra.systemOverride, history: normalizeHistory(history, message) }
    : buildTurnPrompt({
        message,
        history,
        profile: extra?.profile,
        recall: extra?.recall,
        verbosity: extra?.verbosity,
        language: extra?.language,
        facts,
      });
  // 1. Keyless browser AI (Puter). It always receives the current message
  //    (feature modes used to call it with an empty history = no question).
  try {
    const puterAnswer = await askPuter(
      [...prompt.history, { role: 'user', content: message }],
      prompt.system,
      extra?.priority ? 30000 : 20000,
    );
    if (puterAnswer) return { text: puterAnswer, provider: 'puter' };
  } catch { /* fall through */ }
  // 2. Server route: the user's Gemini key, then the community model.
  const urls = Array.from(
    new Set(
      [API_URL ? `${API_URL}/api/chat` : null, '/api/chat'].filter(Boolean) as string[],
    ),
  );
  for (const url of urls) {
    try {
      if (url.startsWith('http') && API_URL === '') continue;
      const r = await fetch(url, {
        signal: AbortSignal.timeout(extra?.priority ? 60000 : 35000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: prompt.history,
          userKey: userKey || undefined,
          provider: extra?.provider || undefined,
          baseUrl: extra?.baseUrl || undefined,
          model: extra?.model || undefined,
          profile: extra?.profile || undefined,
          recall: extra?.recall || undefined,
          verbosity: extra?.verbosity || undefined,
          language: extra?.language || undefined,
          facts: facts || undefined,
          systemOverride: extra?.systemOverride || undefined,
        }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.answer) {
          const provider = typeof j.provider === 'string' && j.provider ? j.provider : 'server';
          return { text: j.answer as string, provider };
        }
      }
    } catch { /* next provider */ }
  }
  // 3. No AI reachable: raw facts beat an apology for a factual question.
  if (facts) return { text: facts, provider: 'wikipedia' };
  return { text: localBrain(message), provider: 'offline' };
}

/** Last resort when no provider answered. Always a real spoken sentence. */
export function localBrain(message: string): string {
  const m = (message || '').toLowerCase();
  if (/\b(hello|hi|hey|namaste|namaskar|hola)\b|हेलो|नमस्ते/.test(m))
    return offlineFallback(message);
  return 'I heard you, but the AI service is unavailable right now, so I could not answer that. I have not looked up live information or performed any external action. You can still use “note:”, “task:”, “search memory”, or a simple calculation.';
}

/** True when the answer came from a real model (not the offline fallback). */
export function isLiveAnswer(answer: string): boolean {
  return !/AI service is unavailable right now|could not answer that/.test(answer || '');
}
