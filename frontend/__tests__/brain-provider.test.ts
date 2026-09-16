import { describe, it, expect, vi, afterEach } from 'vitest';
import { askBrain, askBrainDetailed } from '../lib/brain';

afterEach(() => {
  vi.unstubAllGlobals();
});

function serverOk(answer: string, provider?: string) {
  return { ok: true, json: async () => ({ answer, provider }) };
}

describe('askBrainDetailed provider attribution', () => {
  it('reports the server provider (gemini) when the API answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serverOk('Namaste!', 'gemini')));
    const res = await askBrainDetailed('hello there', []);
    expect(res.text).toBe('Namaste!');
    expect(res.provider).toBe('gemini');
  });

  it('reports pollinations for the keyless community path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serverOk('community answer', 'pollinations')));
    const res = await askBrainDetailed('tell me a joke', []);
    expect(res.provider).toBe('pollinations');
  });

  it('falls back to server when the route omits the provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serverOk('hi', undefined)));
    const res = await askBrainDetailed('hello there', []);
    expect(res.provider).toBe('server');
  });

  it('reports offline when every provider fails', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no network')));
    const res = await askBrainDetailed('random xyz question', []);
    expect(res.provider).toBe('offline');
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('askBrain still returns just the text (backwards compatible)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serverOk('plain text', 'gemini')));
    const text = await askBrain('hello there', []);
    expect(text).toBe('plain text');
  });
});
