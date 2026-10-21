import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/speech/tts/route';
import {
  base64ToBytes,
  pcmToWav,
  geminiVoiceFor,
  keylessSpeech,
  readAloudTarget,
  readAloudUrl,
  readAloudRpcBody,
  readAloudRpcAudio,
  READ_ALOUD_GET_MAX,
} from '../lib/server/tts-server';

function req(body: unknown, raw = false) {
  return new NextRequest('https://app.example.test/api/speech/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const silentPcm = () => Buffer.alloc(4800, 0).toString('base64');

function geminiAudio(b64 = silentPcm()) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: b64 } }] } }],
    }),
  };
}

/** An MP3-ish body for the read-aloud voice; `fill` marks which piece it was. */
const mp3 = (fill = 7, size = 2048) =>
  new Response(new Uint8Array(size).fill(fill), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
const html = () => new Response('<html>unusual traffic</html>', { status: 200, headers: { 'content-type': 'text/html' } });

/** A batchexecute answer carrying base64 audio, shaped like Google's. */
function rpcAnswer(bytes = new Uint8Array(1024).fill(9)) {
  const b64 = Buffer.from(bytes).toString('base64');
  return new Response(`)]}'\n\n120\n[["wrb.fr","jQ1olc","[\\"${b64}\\"]",null,null,null,"generic"]]\n25\n[["e",4,null,null,155]]\n`, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const isReadAloudGet = (u: unknown) => String(u).includes('/translate_tts?');
const isReadAloudRpc = (u: unknown) => String(u).includes('/batchexecute');

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('synthesis helpers', () => {
  it('wraps raw PCM in a playable WAV container', () => {
    const wav = pcmToWav(new Uint8Array([1, 2, 3, 4]));
    const head = String.fromCharCode(...wav.slice(0, 4));
    expect(head).toBe('RIFF');
    expect(wav.byteLength).toBe(48);
  });

  it('decodes plain and data-URL base64', () => {
    expect(Array.from(base64ToBytes('AQID'))).toEqual([1, 2, 3]);
    expect(Array.from(base64ToBytes('data:audio/L16;base64,AQID'))).toEqual([1, 2, 3]);
    expect(base64ToBytes('').byteLength).toBe(0);
  });

  it('picks the same Gemini voice for related Indian languages', () => {
    expect(geminiVoiceFor('hi-IN')).toBe(geminiVoiceFor('mr-IN'));
  });
});

describe('read-aloud voice helpers', () => {
  it('speaks Indian English with the Indian accent and Indian languages natively', () => {
    expect(readAloudTarget('en-IN')).toEqual({ tl: 'en', host: 'translate.google.co.in' });
    expect(readAloudTarget('')).toEqual({ tl: 'en', host: 'translate.google.us' });
    expect(readAloudTarget('en-US')).toEqual({ tl: 'en', host: 'translate.google.us' });
    // Each English accent comes from its own Google domain (gTTS "Localized accents").
    expect(readAloudTarget('en-GB')?.host).toBe('translate.google.co.uk');
    expect(readAloudTarget('en-AU')?.host).toBe('translate.google.com.au');
    expect(readAloudTarget('en-CA')?.host).toBe('translate.google.ca');
    expect(readAloudTarget('en-ZA')?.host).toBe('translate.google.co.za');
    expect(readAloudTarget('fr-CA')).toEqual({ tl: 'fr', host: 'translate.google.ca' });
    expect(readAloudTarget('es-MX')).toEqual({ tl: 'es', host: 'translate.google.com.mx' });
    expect(readAloudTarget('pt-BR')).toEqual({ tl: 'pt', host: 'translate.google.com.br' });
    expect(readAloudTarget('de-DE')).toEqual({ tl: 'de', host: 'translate.google.com' });
    // Unknown or hostile regions fall back to the language's default domain.
    expect(readAloudTarget('en-__proto__')?.host).toBe('translate.google.us');
    expect(readAloudTarget('hi-IN')?.tl).toBe('hi');
    expect(readAloudTarget('mr-IN')?.tl).toBe('mr');
    expect(readAloudTarget('ta_IN')?.tl).toBe('ta');
    expect(readAloudTarget('zh-CN')?.tl).toBe('zh-CN');
    expect(readAloudTarget('he-IL')?.tl).toBe('iw');
  });

  it('declines languages the voice cannot speak so the browser voice handles them', () => {
    expect(readAloudTarget('or-IN')).toBeNull();
    expect(readAloudTarget('xx-YY')).toBeNull();
  });

  it('builds the keyless GET request Google expects', () => {
    const url = new URL(readAloudUrl('translate.google.co.in', 'en', 'Hello there', 1, 3));
    expect(url.origin).toBe('https://translate.google.co.in');
    expect(url.pathname).toBe('/translate_tts');
    expect(url.searchParams.get('client')).toBe('tw-ob');
    expect(url.searchParams.get('tl')).toBe('en');
    expect(url.searchParams.get('q')).toBe('Hello there');
    expect(url.searchParams.get('idx')).toBe('1');
    expect(url.searchParams.get('total')).toBe('3');
    expect(url.searchParams.get('textlen')).toBe('11');
  });

  it('packs and unpacks the batchexecute RPC like gTTS', () => {
    const body = readAloudRpcBody('Namaste', 'hi');
    expect(body.startsWith('f.req=')).toBe(true);
    const rpc = JSON.parse(decodeURIComponent(body.slice('f.req='.length, -1)));
    expect(rpc[0][0][0]).toBe('jQ1olc');
    expect(JSON.parse(rpc[0][0][1])).toEqual(['Namaste', 'hi', null, 'null']);
    const audio = new Uint8Array(600).fill(3);
    const answer = `)]}'\n[["wrb.fr","jQ1olc","[\\"${Buffer.from(audio).toString('base64')}\\"]",null]]`;
    expect(Array.from(readAloudRpcAudio(answer) || [])).toEqual(Array.from(audio));
    expect(readAloudRpcAudio('[["wrb.fr","jQ1olc","[]"]]')).toBeNull();
  });

  it('unescapes JSON-escaped base64 characters in the RPC answer', () => {
    const audio = new Uint8Array(601).fill(251); // base64 with '+', '/' and '=' padding
    const b64 = Buffer.from(audio).toString('base64');
    expect(b64).toMatch(/[+/=]/);
    const escaped = b64.replace(/\//g, '\\/').replace(/=/g, '\\u003d');
    const answer = `[["wrb.fr","jQ1olc","[\\"${escaped}\\"]"]]`;
    expect(Array.from(readAloudRpcAudio(answer) || [])).toEqual(Array.from(audio));
  });

  it('returns within its time budget when the network hangs (the client must never be left waiting)', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const started = Date.now();
    await expect(keylessSpeech('Hello there. '.repeat(30), 'en-IN', Date.now() + 1000)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(2500);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('gives up without a request once the time budget is spent', async () => {
    const fetchMock = vi.fn(async () => mp3());
    vi.stubGlobal('fetch', fetchMock);
    await expect(keylessSpeech('Hello there.', 'en-IN', Date.now() - 1)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/speech/tts validation', () => {
  it('rejects empty, oversized and malformed requests', async () => {
    expect((await POST(req({ text: '   ' }))).status).toBe(400);
    expect((await POST(req({ text: 'x'.repeat(1600) }))).status).toBe(400);
    expect((await POST(req({ text: 'hi', lang: 'x'.repeat(40) }))).status).toBe(400);
    expect((await POST(req({ text: 'hi', userKey: 'k'.repeat(300) }))).status).toBe(400);
    expect((await POST(req({ text: 'hi', tier: 'everything' }))).status).toBe(400);
    expect((await POST(req('{not json', true))).status).toBe(400);
  });
});

describe('POST /api/speech/tts providers', () => {
  it('speaks with the CALLER key and returns playable WAV', async () => {
    const fetchMock = vi.fn(async () => geminiAudio());
    vi.stubGlobal('fetch', fetchMock);
    const r = await POST(req({ text: 'Namaste, main OneBrain hoon.', lang: 'hi-IN', userKey: 'USER-KEY' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('audio/wav');
    expect(r.headers.get('x-onebrain-tts')).toBe('user-key');
    const body = new Uint8Array(await r.arrayBuffer());
    expect(String.fromCharCode(...body.slice(0, 4))).toBe('RIFF');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, any];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(init.headers['x-goog-api-key']).toBe('USER-KEY');
    expect(String(init.body)).toContain('responseModalities');
  });

  it('falls through from a failing user key to the keyless read-aloud voice', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('generativelanguage') ? { ok: false, status: 403, json: async () => ({}) } : mp3(),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await POST(req({ text: 'Hello there.', lang: 'en-IN', userKey: 'BAD-KEY' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('audio/mpeg');
    expect(r.headers.get('x-onebrain-tts')).toBe('community');
    const get = fetchMock.mock.calls.map(([u]) => String(u)).find(isReadAloudGet);
    expect(get).toBeTruthy();
    expect(new URL(get!).host).toBe('translate.google.co.in');
    expect(new URL(get!).searchParams.get('tl')).toBe('en');
  });

  it('answers the keyless tier without touching the caller key', async () => {
    const fetchMock = vi.fn(async () => mp3());
    vi.stubGlobal('fetch', fetchMock);
    const r = await POST(req({ text: 'Hello there.', lang: 'en-IN', userKey: 'USER-KEY', tier: 'keyless' }));
    expect(r.headers.get('x-onebrain-tts')).toBe('community');
    const dumped = JSON.stringify(fetchMock.mock.calls);
    expect(dumped).not.toContain('USER-KEY');
    expect(dumped).not.toContain('generativelanguage');
  });

  it('answers the user tier without falling back to the keyless voice', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: false, status: 429, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await POST(req({ text: 'Hello there.', lang: 'en-IN', userKey: 'USER-KEY', tier: 'user' }));
    expect(await r.json()).toEqual({ fallback: true });
    expect(fetchMock.mock.calls.every(([u]) => String(u).includes('generativelanguage'))).toBe(true);
  });

  it('never reads host provider keys', async () => {
    process.env.GEMINI_API_KEY = 'HOST-GEMINI-SECRET';
    process.env.OPENAI_API_KEY = 'HOST-OPENAI-SECRET';
    process.env.ELEVENLABS_API_KEY = 'HOST-ELEVEN-SECRET';
    const fetchMock = vi.fn(async () => mp3());
    vi.stubGlobal('fetch', fetchMock);
    const r = await POST(req({ text: 'No user key here.' }));
    expect(r.headers.get('x-onebrain-tts')).toBe('community');
    const dumped = JSON.stringify(fetchMock.mock.calls);
    expect(dumped).not.toContain('HOST-GEMINI-SECRET');
    expect(dumped).not.toContain('HOST-OPENAI-SECRET');
    expect(dumped).not.toContain('HOST-ELEVEN-SECRET');
    expect(dumped).not.toContain('generativelanguage');
  });

  it('reports fallback (never silence) when no provider produces audio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = await POST(req({ text: 'Anyone home?', lang: 'en-IN' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ fallback: true });
  });

  it('ignores a captcha page and an RPC answer without audio', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      isReadAloudRpc(url) ? new Response(')]}\'\n[["wrb.fr","jQ1olc","[]"]]') : html(),
    ));
    const r = await POST(req({ text: 'Blocked by a captcha page.' }));
    expect(await r.json()).toEqual({ fallback: true });
  });

  it('uses the batchexecute RPC when the plain GET is blocked', async () => {
    const fetchMock = vi.fn(async (url: string) => (isReadAloudRpc(url) ? rpcAnswer() : html()));
    vi.stubGlobal('fetch', fetchMock);
    const r = await POST(req({ text: 'Hello there.', lang: 'en-IN' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('audio/mpeg');
    expect((await r.arrayBuffer()).byteLength).toBe(1024);
    const rpc = fetchMock.mock.calls.find(([u]) => isReadAloudRpc(u)) as unknown as [string, RequestInit];
    expect(rpc[1].method).toBe('POST');
    expect(String(rpc[1].body)).toContain('jQ1olc');
  });

  it('speaks a long answer in short pieces, joined in order', async () => {
    const text = Array.from({ length: 14 }, (_, i) => `Sentence number ${i + 1} of a long spoken answer.`).join(' ');
    const pieces: Array<{ idx: number; total: number; q: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      const q = params.get('q')!;
      expect(q.length).toBeLessThanOrEqual(READ_ALOUD_GET_MAX);
      const idx = Number(params.get('idx'));
      pieces.push({ idx, total: Number(params.get('total')), q });
      // Answer out of order on purpose: later pieces come back first.
      await new Promise((r) => setTimeout(r, (10 - idx) * 2));
      return mp3(idx + 1, 600);
    }));
    const r = await POST(req({ text, lang: 'en-IN' }));
    const bytes = new Uint8Array(await r.arrayBuffer());
    const n = pieces.length;
    expect(n).toBeGreaterThan(2);
    expect(pieces.every((p) => p.total === n)).toBe(true);
    expect(pieces.map((p) => p.idx).sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
    // Pieces cover the whole text, and the audio is joined in text order.
    const byIdx = [...pieces].sort((a, b) => a.idx - b.idx).map((p) => p.q).join(' ');
    expect(byIdx).toBe(text);
    expect(bytes.byteLength).toBe(600 * n);
    for (let i = 0; i < n; i++) expect(bytes[i * 600]).toBe(i + 1);
  });

  it('falls back instead of playing an answer with a hole in it', async () => {
    // Piece 1 fails on every host and on the RPC; the others succeed.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (isReadAloudRpc(url)) return new Response('nope', { status: 500 });
      return new URL(url).searchParams.get('idx') === '1' ? new Response('busy', { status: 429 }) : mp3();
    }));
    const text = 'One full sentence of a spoken reply goes here. '.repeat(8).trim();
    const r = await POST(req({ text, lang: 'en-IN' }));
    expect(await r.json()).toEqual({ fallback: true });
  });

  it('leaves unsupported languages to the browser voice without calling out', async () => {
    const fetchMock = vi.fn(async () => mp3());
    vi.stubGlobal('fetch', fetchMock);
    const r = await POST(req({ text: 'ନମସ୍କାର', lang: 'or-IN' }));
    expect(await r.json()).toEqual({ fallback: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
