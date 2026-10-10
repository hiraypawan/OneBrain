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

  it('ignores a signed-in Puter SDK until chat is explicitly enabled', async () => {
    const chat = vi.fn(async () => ({ message: { content: 'Must not run' } }));
    const fetchMock = vi.fn(async () => serverOk('Gemini reply', 'gemini'));
    vi.stubGlobal('window', { puter: { ai: { chat }, auth: { isSignedIn: () => true } } });
    vi.stubGlobal('fetch', fetchMock);
    const result = await askBrainDetailed('hello there', [], 'GEMINI-KEY', { puterEnabled: false });
    expect(result.provider).toBe('gemini');
    expect(chat).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not switch from a failed Puter provider unless the user opted into fallback', async () => {
    const chat = vi.fn(async () => { throw new Error('quota exceeded'); });
    const fetchMock = vi.fn(async () => serverOk('Must not be sent', 'gemini'));
    vi.stubGlobal('window', { puter: { ai: { chat }, auth: { isSignedIn: () => true } } });
    vi.stubGlobal('fetch', fetchMock);
    const result = await askBrainDetailed('Debug this small function', [], 'GEMINI-KEY', {
      puterEnabled: true,
      provider: 'gemini',
    });
    expect(result.provider).toBe('puter-unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports exact Puter selection and does not call another provider on success', async () => {
    const chat = vi.fn(async () => ({ message: { content: 'The index is off by one.' } }));
    const fetchMock = vi.fn(async () => serverOk('Should not run', 'gemini'));
    vi.stubGlobal('window', { puter: { ai: { chat }, auth: { isSignedIn: () => true } } });
    vi.stubGlobal('fetch', fetchMock);
    const chunks: string[] = [];
    const result = await askBrainDetailed('Why does this loop miss the last value?', [], undefined, {
      puterEnabled: true,
      puterModel: 'catalog/model-exact',
      puterProvider: 'catalog-vendor',
      onChunk: (text) => chunks.push(text),
    });
    expect(result).toEqual({ text: 'The index is off by one.', provider: 'puter:catalog-vendor/catalog/model-exact' });
    expect(chunks).toEqual(['The index is off by one.']);
    expect(fetchMock).not.toHaveBeenCalled();
    const [, options] = chat.mock.calls[0] as unknown as [any[], any];
    expect(options.model).toBe('catalog/model-exact');
    expect(options.provider).toBe('catalog-vendor');
  });

  it('uses the configured key route only when explicit cross-provider fallback is enabled', async () => {
    const chat = vi.fn(async () => { throw new Error('quota exceeded'); });
    const fetchMock = vi.fn(async (_url: unknown, init: any) => {
      expect(JSON.parse(init.body).userKey).toBe('GEMINI-KEY');
      return serverOk('Answered by Gemini', 'gemini');
    });
    vi.stubGlobal('window', { puter: { ai: { chat }, auth: { isSignedIn: () => true } } });
    vi.stubGlobal('fetch', fetchMock);
    const result = await askBrainDetailed('continue', [], 'GEMINI-KEY', {
      puterEnabled: true,
      puterFallbackEnabled: true,
      provider: 'gemini',
    });
    expect(result).toEqual({ text: 'Answered by Gemini', provider: 'gemini' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('askBrain still returns just the text (backwards compatible)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serverOk('plain text', 'gemini')));
    const text = await askBrain('hello there', []);
    expect(text).toBe('plain text');
  });
});
