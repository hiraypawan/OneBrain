import { describe, it, expect, vi, afterEach } from 'vitest';
import { speechCacheKey, synthesizeSpeech } from '../lib/tts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function audioResponse(bytes = 4096, source = 'user-key') {
  return {
    ok: true,
    headers: new Headers({ 'Content-Type': 'audio/mpeg', 'X-OneBrain-Tts': source }),
    blob: async () => new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }),
  };
}

describe('speechCacheKey', () => {
  it('is stable for the same reply and language', () => {
    expect(speechCacheKey('Namaste!', 'hi-IN')).toBe(speechCacheKey('Namaste!', 'hi-IN'));
  });

  it('separates languages and different replies', () => {
    expect(speechCacheKey('Namaste!', 'hi-IN')).not.toBe(speechCacheKey('Namaste!', 'en-IN'));
    expect(speechCacheKey('Namaste!', 'hi-IN')).not.toBe(speechCacheKey('Namaste.', 'hi-IN'));
  });
});

describe('synthesizeSpeech', () => {
  it('returns playable audio when the service answers with bytes', async () => {
    const fetchMock = vi.fn(async () => audioResponse());
    vi.stubGlobal('fetch', fetchMock);
    const out = await synthesizeSpeech({ text: 'Namaste', lang: 'hi-IN', apiKey: 'USER-KEY' });
    expect(out?.source).toBe('user-key');
    expect(out?.blob.size).toBeGreaterThan(1000);
    const init = (fetchMock.mock.calls[0] as unknown as [string, any])[1];
    expect(JSON.parse(init.body)).toEqual({ text: 'Namaste', lang: 'hi-IN', userKey: 'USER-KEY' });
  });

  it('returns null (so the browser voice can take over) on the fallback contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      blob: async () => new Blob([JSON.stringify({ fallback: true })], { type: 'application/json' }),
    })));
    await expect(synthesizeSpeech({ text: 'Namaste' })).resolves.toBeNull();
  });

  it('never throws — a dead network, an HTTP error and a tiny body all resolve null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(synthesizeSpeech({ text: 'Namaste' })).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(synthesizeSpeech({ text: 'Namaste' })).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => audioResponse(10)));
    await expect(synthesizeSpeech({ text: 'Namaste' })).resolves.toBeNull();
  });

  it('does nothing for empty text', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(synthesizeSpeech({ text: '   ' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
