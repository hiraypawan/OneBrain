import { NextRequest, NextResponse } from 'next/server';
import { buildSystem, askGemini, askPollinations, fallback, verbosityBudget } from '@/lib/gemini';
import { readJsonBody, bodyError, RequestBodyError } from '@/lib/request-body';
import type { ChatHistory } from '@/lib/gemini';
import { looksFactual, fetchWikipedia } from '@/lib/knowledge';

export async function POST(req: NextRequest) {
  let input: Record<string, unknown>;
  try {
    input = await readJsonBody(req);
    if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 8000)
      throw new RequestBodyError('Message must contain 1–8000 characters.', 400);
    for (const [field, limit] of [['userKey', 256], ['profile', 12000], ['recall', 12000]] as const) {
      if (input[field] !== undefined && (typeof input[field] !== 'string' || (input[field] as string).length > limit))
        throw new RequestBodyError(`Invalid ${field}.`, 400);
    }
    if (input.verbosity !== undefined && !['short', 'medium', 'long'].includes(input.verbosity as string))
      throw new RequestBodyError('Invalid verbosity.', 400);
    if (input.history !== undefined && (!Array.isArray(input.history) || input.history.length > 100 || input.history.some(m =>
      !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 8000)))
      throw new RequestBodyError('Invalid conversation history.', 400);
  } catch (error) { return bodyError(error); }
  const message = input.message as string, history = (input.history || []) as ChatHistory[];
  const userKey = input.userKey as string | undefined, verbosity = input.verbosity as string | undefined;
  const profile = input.profile as string | undefined, recall = input.recall as string | undefined;

  // Explicit user key, keyless community API, then offline fallback.
  // Never spend host keys or silently overflow into a paid provider.
  // Memory-aware system: clock + verbosity + who they are + relevant past chats.
  const sysParts = [buildSystem()];
  sysParts.push(verbosity === 'long' ? 'Give fuller explanations when asked.' : 'Be concise: short spoken answers.');
  if (profile) sysParts.push(profile);
  if (recall) sysParts.push(recall);
  const system = sysParts.join('\n\n');
  const maxTokens = verbosityBudget(verbosity);
  const geminiKey = userKey;
  let keyBlame: string | null = null;
  if (geminiKey) {
    const res = await askGemini(geminiKey, message, history || [], { system, maxTokens });
    if (res.text) return NextResponse.json({ answer: res.text, provider: 'gemini' });
    // Do not write provider errors or user credentials into server logs.
    if (userKey && /api key|not valid|permission|quota|exceed/i.test(res.error || '')) {
      keyBlame = String(res.error).slice(0, 220);
    }
  }

  // Keyless community API: works with zero setup. Tried after keyed
  // providers so a user's own key (better quality) always wins when present.
  // Live facts first for factual questions (fresh > training cutoff).
  try {
    if (looksFactual(message)) {
      const wiki = await fetchWikipedia(message);
      if (wiki?.text) return NextResponse.json({ answer: wiki.text, provider: 'wikipedia' });
    }
  } catch (e) {
    console.error('Wikipedia failed:', e);
  }
  const free = await askPollinations(message, history || [], system);
  if (free.text) return NextResponse.json({ answer: free.text, provider: 'pollinations' });
  console.error('Pollinations failed:', free.error);

  // Everything failed: if the user's own key was rejected, say so plainly.
  if (userKey && keyBlame) {
    return NextResponse.json({
      answer: `Tumhari Gemini key kaam nahi kar rahi (${keyBlame}). Settings me key dobara check karo, aistudio.google.com se nayi key lekar paste karo.`,
      provider: 'key-error',
    });
  }
  return NextResponse.json({ answer: fallback(message), provider: 'offline' });
}
