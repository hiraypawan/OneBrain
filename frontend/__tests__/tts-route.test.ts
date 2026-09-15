import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/speech/tts/route';
import { base64ToBytes, pcmToWav, geminiVoiceFor, communityVoiceFor } from '../lib/tts-server';

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

  it('picks different voices for Indian and Latin languages', () => {
    expect(geminiVoiceFor('hi-IN')).toBe(geminiVoiceFor('mr-IN'));
    expect(communityVoiceFor('hi-IN')).toBe('alloy');
    expect(communityVoiceFor('en-US')).toBe('nova');
  });
});

describe('POST /api/speech/tts validation', () => {
  it('rejects empty, oversized and malformed requests', async () => {
    expect((await POST(req({ text: '   ' }))).status).toBe(400);
    expect((await POST(req({ text: 'x'.repeat(1600) }))).status).toBe(400);
    expect((await POST(req({ text: 'hi', lang: 'x'.repeat(40) }))).status).toBe(400);
    expect((await POST(req({ text: 'hi', userKey: 'k'.repeat(300) }))).status).toBe(400);
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

  it('falls through from a failing user key to the keyless community voice', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('generativelanguage')
        ? { ok: false, status: 403, json: async () => ({}) }
        : {
            ok: true,
            headers: new Map([['content-type', 'audio/mpeg']]) as unknown as Headers,
            arrayBuffer: async () => new Uint8Array(4096).buffer,
          },
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await POST(req({ text: 'Hello there.', lang: 'en-IN', userKey: 'BAD-KEY' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('audio/mpeg');
    expect(r.headers.get('x-onebrain-tts')).toBe('community');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('text.pollinations.ai'))).toBe(true);
  });

  it('never reads host provider keys', async () => {
    process.env.GEMINI_API_KEY = 'HOST-GEMINI-SECRET';
    process.env.OPENAI_API_KEY = 'HOST-OPENAI-SECRET';
    process.env.ELEVENLABS_API_KEY = 'HOST-ELEVEN-SECRET';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Map([['content-type', 'audio/mpeg']]) as unknown as Headers,
      arrayBuffer: async () => new Uint8Array(4096).buffer,
    }));
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

  it('ignores a provider that answers with a non-audio body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Map([['content-type', 'text/html']]) as unknown as Headers,
      arrayBuffer: async () => new Uint8Array(4096).buffer,
    })));
    const r = await POST(req({ text: 'Blocked by a captcha page.' }));
    expect(await r.json()).toEqual({ fallback: true });
  });
});

describe('keyless community tier robustness', () => {
  it('uses the OpenAI-shaped JSON response when the plain GET is not audio', async () => {
    const mp3 = Buffer.alloc(4096, 7).toString('base64');
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/openai'))
        return { ok: true, json: async () => ({ choices: [{ message: { audio: { data: mp3 } } }] }) };
      return {
        ok: true,
        headers: new Map([['content-type', 'text/html']]) as unknown as Headers,
        arrayBuffer: async () => new Uint8Array(2048).buffer,
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await POST(req({ text: 'Hello there.', lang: 'en-IN' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('audio/mpeg');
    expect(r.headers.get('x-onebrain-tts')).toBe('community');
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('falls back when the JSON shape has no audio payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'text only' } }] }) })));
    const r = await POST(req({ text: 'Hello there.' }));
    expect(await r.json()).toEqual({ fallback: true });
  });
});
