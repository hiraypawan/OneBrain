import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody, bodyError, RequestBodyError } from '@/lib/request-body';
import {
  MAX_TEXT,
  MAX_KEY,
  MAX_LANG,
  geminiVoiceFor,
  userKeySpeech,
  communitySpeech,
} from '@/lib/tts-server';

// Real spoken audio for OneBrain replies — see lib/tts-server.ts for why the
// app cannot rely on browser speechSynthesis alone. Host provider keys are
// never read here: only the caller's own key (their plan, their quota) and a
// keyless community audio model. When neither produces audio the client falls
// back to the browser voice, so the response is never silence.
export async function POST(req: NextRequest) {
  let text: string;
  let lang: string;
  let userKey: string | undefined;
  try {
    const input = await readJsonBody(req, 16_000);
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > MAX_TEXT)
      throw new RequestBodyError(`Supply 1–${MAX_TEXT} characters of text.`, 400);
    if (input.lang !== undefined && (typeof input.lang !== 'string' || input.lang.length > MAX_LANG))
      throw new RequestBodyError('Invalid language.', 400);
    if (input.userKey !== undefined && (typeof input.userKey !== 'string' || input.userKey.length > MAX_KEY))
      throw new RequestBodyError('Invalid key.', 400);
    text = input.text.trim();
    lang = typeof input.lang === 'string' ? input.lang : '';
    userKey = typeof input.userKey === 'string' && input.userKey.trim() ? input.userKey.trim() : undefined;
  } catch (error) {
    return bodyError(error);
  }

  const headers = {
    'Cache-Control': 'no-store',
    'X-OneBrain-Tts-Voice': geminiVoiceFor(lang),
  };

  if (userKey) {
    const owned = await userKeySpeech(text, lang, userKey);
    if (owned)
      return new NextResponse(owned.bytes as unknown as BodyInit, {
        status: 200,
        headers: { ...headers, 'Content-Type': owned.mime, 'X-OneBrain-Tts': 'user-key' },
      });
  }

  const community = await communitySpeech(text, lang);
  if (community)
    return new NextResponse(community.bytes as unknown as BodyInit, {
      status: 200,
      headers: { ...headers, 'Content-Type': community.mime, 'X-OneBrain-Tts': 'community' },
    });

  // Nothing produced audio: the client falls back to the browser voice rather
  // than staying silent. `fallback: true` is the long-standing contract.
  return NextResponse.json({ fallback: true }, { status: 200, headers });
}
