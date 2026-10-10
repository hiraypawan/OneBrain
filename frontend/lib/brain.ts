// Shared AI brain chain: Wikipedia facts -> Puter (keyless) -> backend /
// Next route (user key -> community -> offline) -> local fallback.
// Moved here from useAssistant so feature modes (personas, translator,
// research, scribe polish) can call the same chain with their own system
// prompts. Behavior for normal chat is unchanged.

import { askPuter } from './puter';
import { fallback as offlineFallback, verbosityBudget } from './gemini';
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
  /** Explicit per-browser opt-in to use the signed-in Puter account. */
  puterEnabled?: boolean;
  /** Explicit separate opt-in to continue with the configured key/community route if Puter fails. */
  puterFallbackEnabled?: boolean;
  /** Current model ID discovered from Puter's runtime catalog. */
  puterModel?: string;
  /** Provider ID from the same runtime catalog, to pin the selected model route. */
  puterProvider?: string;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  onChunk?: (text: string) => void;
  shouldContinue?: () => boolean;
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
  // Puter is used only after a user explicitly connects it in settings. The
  // selected model is an exact runtime-catalog ID; an empty value deliberately
  // means “Puter default”. Streaming is used when the chat surface can display
  // partial text, and the iterator is closed when that turn is cancelled.
  if (extra?.puterEnabled) {
    try {
      const puterAnswer = await askPuter(
        [...prompt.history, { role: 'user', content: message }],
        prompt.system,
        {
          enabled: true,
          model: extra.puterModel,
          provider: extra.puterProvider,
          maxTokens: verbosityBudget(extra.verbosity),
          timeoutMs: extra.priority ? 30000 : 20000,
          reasoningEffort: extra.reasoningEffort,
          onChunk: extra.onChunk,
          shouldContinue: extra.shouldContinue,
        },
      );
      if (puterAnswer) {
        const route = extra.puterModel
          ? `${extra.puterProvider || 'unknown-provider'}/${extra.puterModel}`
          : `${extra.puterProvider || 'auto-provider'}/default-model`;
        return { text: puterAnswer, provider: `puter:${route}` };
      }
    } catch { /* follow the user's visible fallback preference */ }
    extra.onChunk?.('');
    if (extra?.shouldContinue && !extra.shouldContinue()) return { text: '', provider: 'cancelled' };
    if (!extra?.puterFallbackEnabled) {
      return { text: offlineFallback(message), provider: 'puter-unavailable' };
    }
  }
  if (extra?.shouldContinue && !extra.shouldContinue()) return { text: '', provider: 'cancelled' };
  // The configured user-key lane is honored when Puter is not selected (or
  // when it is unavailable); the backend then uses its community fallback.
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
