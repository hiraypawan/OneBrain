import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody, bodyError, RequestBodyError } from '@/lib/server/request-body';
import {
  MAX_TEXT,
  MAX_KEY,
  MAX_LANG,
  geminiVoiceFor,
  userKeySpeech,
  keylessSpeech,
  type SpeechBytes,
} from '@/lib/server/tts-server';

// Time budgets. The client gives the keyless tier ~9 s and the user-key tier
// ~14 s, so each tier must answer comfortably inside that — a response that
// arrives after the client gave up is wasted work and a silent reply.
const USER_KEY_BUDGET_MS = 12_000;
const KEYLESS_BUDGET_MS = 7_000;

type Tier = 'user' | 'keyless';

// Real spoken audio for OneBrain replies — see lib/server/tts-server.ts for why the
// app cannot rely on browser speechSynthesis alone. Host provider keys are
// never read here: only the caller's own key (their plan, their quota) and a
// keyless read-aloud voice. When neither produces audio the client falls back
// to the browser voice, so the response is never silence.
//
// `tier` lets the client ask for exactly one tier (it tries them in order and
// must not pay for the slow user-key attempt twice); without it both run.
export async function POST(req: NextRequest) {
  let text: string;
  let lang: string;
  let userKey: string | undefined;
  let tier: Tier | undefined;
  try {
    const input = await readJsonBody(req, 16_000);
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > MAX_TEXT)
      throw new RequestBodyError(`Supply 1–${MAX_TEXT} characters of text.`, 400);
    if (input.lang !== undefined && (typeof input.lang !== 'string' || input.lang.length > MAX_LANG))
      throw new RequestBodyError('Invalid language.', 400);
    if (input.userKey !== undefined && (typeof input.userKey !== 'string' || input.userKey.length > MAX_KEY))
      throw new RequestBodyError('Invalid key.', 400);
    if (input.tier !== undefined && input.tier !== 'user' && input.tier !== 'keyless')
      throw new RequestBodyError('Invalid tier.', 400);
    text = input.text.trim();
    lang = typeof input.lang === 'string' ? input.lang : '';
    userKey = typeof input.userKey === 'string' && input.userKey.trim() ? input.userKey.trim() : undefined;
    tier = input.tier as Tier | undefined;
  } catch (error) {
    return bodyError(error);
  }

  const headers = {
    'Cache-Control': 'no-store',
    'X-OneBrain-Tts-Voice': geminiVoiceFor(lang),
  };
  const audio = (out: SpeechBytes, source: 'user-key' | 'community') =>
    new NextResponse(out.bytes as unknown as BodyInit, {
      status: 200,
      headers: { ...headers, 'Content-Type': out.mime, 'X-OneBrain-Tts': source },
    });

  const started = Date.now();
  if (userKey && tier !== 'keyless') {
    // Asked for both tiers: leave the keyless voice enough time to answer.
    const budget = tier === 'user' ? USER_KEY_BUDGET_MS : USER_KEY_BUDGET_MS / 2;
    const owned = await userKeySpeech(text, lang, userKey, started + budget);
    if (owned) return audio(owned, 'user-key');
  }

  if (tier !== 'user') {
    const keyless = await keylessSpeech(text, lang, Date.now() + KEYLESS_BUDGET_MS);
    if (keyless) return audio(keyless, 'community');
  }

  // Nothing produced audio: the client falls back to the browser voice rather
  // than staying silent. `fallback: true` is the long-standing contract.
  return NextResponse.json({ fallback: true }, { status: 200, headers });
}
