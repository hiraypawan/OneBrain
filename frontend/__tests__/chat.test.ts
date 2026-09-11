import { describe, it, expect, vi, afterEach } from 'vitest';
import { fallback, askGemini, askPollinations, buildSystem, foldPrompt } from '../lib/gemini';
import { askPuter } from '../lib/puter';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fallback (offline brain)', () => {
  it('greets in Hinglish', () => {
    expect(fallback('hello kaun ho')).toMatch(/Namaste/);
    expect(fallback('हेलो कौन हो आप')).toMatch(/Namaste/);
  });

  it('echoes anything else with a key hint', () => {
    expect(fallback('random xyz')).toMatch(/Samajh gaya/);
    expect(fallback('random xyz')).toMatch(/AI key/);
  });
});

function geminiOk(text: string) {
  return {
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  };
}

describe('askGemini', () => {
  it('returns text on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk('Namaste! Main OneBrain hoon.')));
    const res = await askGemini('KEY', 'hello', []);
    expect(res.text).toMatch(/OneBrain/);
  });

  it('stops after invalid-key error without retrying other models', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await askGemini('BAD', 'hello', []);
    expect(res.error).toMatch(/not valid/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through every model until one answers', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('models/gemini-2.5-flash-lite:')
        ? geminiOk('fallback model reply')
        : { ok: false, status: 404, json: async () => ({}) }
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await askGemini('KEY', 'hello', []);
    expect(res.text).toMatch(/fallback model reply/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('moves past a retired model name to the next one', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('models/gemini-3.6-flash:')
        ? {
            ok: false,
            status: 404,
            json: async () => ({ error: { message: 'This model is no longer available.' } }),
          }
        : geminiOk('new model reply')
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await askGemini('KEY', 'hello', []);
    expect(res.text).toMatch(/new model reply/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends a live clock and disables thinking so replies are complete', async () => {
    let sentBody: any = null;
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      return geminiOk('full reply');
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await askGemini('KEY', 'India me time kya hai', [], { system: buildSystem() });
    expect(res.text).toMatch(/full reply/);
    expect(sentBody.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
    expect(sentBody.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(600);
    expect(sentBody.systemInstruction.parts[0].text).toMatch(/Current time/);
  });

  it('retries a model without thinkingConfig when it rejects the field', async () => {
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      bodies.push(body.generationConfig);
      if (body.generationConfig.thinkingConfig) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'Request contains an invalid argument.' } }),
        };
      }
      return geminiOk('bare retry reply');
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await askGemini('KEY', 'hello', []);
    expect(res.text).toMatch(/bare retry reply/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[0].thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(bodies[1].thinkingConfig).toBeUndefined();
  });

  it('reports every model failure instead of a generic message', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Quota exceeded' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await askGemini('KEY', 'hello', []);
    expect(res.error).toMatch(/gemini-3\.6-flash/);
    expect(res.error).toMatch(/gemini-2\.5-flash-lite/);
    expect(res.error).toMatch(/Quota exceeded/);
  });
});

describe('askPollinations (keyless fallback)', () => {
  it('returns text on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => '  Keyless hello!  ' }))
    );
    const res = await askPollinations('hello', [], 'sys');
    expect(res.text).toBe('Keyless hello!');
  });

  it('returns an error when the service fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    const res = await askPollinations('hello', [], 'sys');
    expect(res.error).toMatch(/503/);
  });

  it('folds system + history into one bare user message', () => {
    const prompt = foldPrompt('hi', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], 'SYS');
    expect(prompt).toMatch(/^SYS/);
    expect(prompt).toMatch(/User: a/);
    expect(prompt).toMatch(/Assistant: b/);
    expect(prompt).toMatch(/User: hi\nAssistant:$/);
  });

  it('sends only model + messages (no extra fields)', async () => {
    let sentBody: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: any) => {
        sentBody = JSON.parse(init.body);
        return { ok: true, text: async () => 'ok' };
      })
    );
    await askPollinations('hi', [], 'sys');
    expect(Object.keys(sentBody).sort()).toEqual(['messages', 'model']);
    expect(sentBody.messages).toHaveLength(1);
    expect(sentBody.messages[0].role).toBe('user');
  });
});

describe('askPuter (keyless browser AI)', () => {
  it('returns null when the SDK is absent (offline/blocked/SSR)', async () => {
    const res = await askPuter([], 'sys');
    expect(res).toBeNull();
  });

  it('reads string content', async () => {
    vi.stubGlobal('window', {
      puter: { ai: { chat: async () => ({ message: { content: '  hello  ' } }) } },
    });
    expect(await askPuter([], 'sys')).toBe('hello');
  });

  it('joins array content blocks', async () => {
    vi.stubGlobal('window', {
      puter: { ai: { chat: async () => ({ message: { content: [{ text: 'a' }, { text: 'b' }] } }) } },
    });
    expect(await askPuter([], 'sys')).toBe('ab');
  });

  it('returns null when the SDK throws', async () => {
    vi.stubGlobal('window', {
      puter: { ai: { chat: async () => { throw new Error('rate limited'); } } },
    });
    expect(await askPuter([], 'sys')).toBeNull();
  });
});
