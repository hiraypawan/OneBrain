import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  askOpenAICompatible,
  sanitizeBaseUrl,
  sanitizeModel,
} from '../lib/openai-compatible';
import { POST as chat } from '../app/api/chat/route';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('openai-compatible endpoint guard', () => {
  it('accepts public https endpoints, trims slashes', () => {
    expect(sanitizeBaseUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1');
    expect(sanitizeBaseUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com');
  });
  it('refuses non-https, creds, ports, short hosts and long input', () => {
    expect(sanitizeBaseUrl('http://openrouter.ai/api/v1')).toBeNull();
    expect(sanitizeBaseUrl('https://user:pass@openrouter.ai/v1')).toBeNull();
    expect(sanitizeBaseUrl('https://openrouter.ai:8443/v1')).toBeNull();
    expect(sanitizeBaseUrl('not a url')).toBeNull();
    expect(sanitizeBaseUrl('x'.repeat(121))).toBeNull();
    expect(sanitizeBaseUrl(42)).toBeNull();
  });
  it('refuses loopback, private ranges and metadata (server fetches this URL)', () => {
    expect(sanitizeBaseUrl('https://localhost/v1')).toBeNull();
    expect(sanitizeBaseUrl('https://127.0.0.1/v1')).toBeNull();
    expect(sanitizeBaseUrl('https://10.0.0.5/v1')).toBeNull();
    expect(sanitizeBaseUrl('https://192.168.1.2/v1')).toBeNull();
    expect(sanitizeBaseUrl('https://172.16.0.9/v1')).toBeNull();
    expect(sanitizeBaseUrl('https://169.254.169.254/latest')).toBeNull();
    expect(sanitizeBaseUrl('https://1.2.3.4/v1')).toBeNull();
  });
  it('validates model names', () => {
    expect(sanitizeModel('deepseek-chat')).toBe('deepseek-chat');
    expect(sanitizeModel('deepseek/deepseek-chat-v3.1:free')).toBe('deepseek/deepseek-chat-v3.1:free');
    expect(sanitizeModel('has space')).toBeNull();
    expect(sanitizeModel('')).toBeNull();
    expect(sanitizeModel('x'.repeat(121))).toBeNull();
  });
});

describe('askOpenAICompatible', () => {
  const ok = (text: string) =>
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: text } }] }),
    }));
  it('returns text on a well-formed completion', async () => {
    vi.stubGlobal('fetch', ok('Hello from test endpoint'));
    const r = await askOpenAICompatible({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'test-only-key',
      model: 'test-model',
      message: 'hi',
    });
    expect(r.text).toBe('Hello from test endpoint');
  });
  it('never fetches an unsafe endpoint', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const r = await askOpenAICompatible({
      baseUrl: 'https://169.254.169.254/latest',
      apiKey: 'test-only-key',
      model: 'test-model',
      message: 'hi',
    });
    expect(r.error).toMatch(/invalid endpoint/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports provider errors honestly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API key' } }),
      })),
    );
    const r = await askOpenAICompatible({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'bad-key',
      model: 'deepseek-chat',
      message: 'hi',
    });
    expect(r.error).toContain('401');
    expect(r.error).toContain('Invalid API key');
  });
});

describe('POST /api/chat openai lane', () => {
  const req = (value: unknown) =>
    new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  it('answers through the user endpoint and labels the provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url).includes('openai-compat-test')
          ? {
              ok: true,
              status: 200,
              json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
            }
          : Promise.reject(new Error('offline')),
      ),
    );
    const r = await chat(
      req({
        message: 'Reply with only the word OK',
        userKey: 'test-only-key',
        provider: 'openai',
        baseUrl: 'https://openai-compat-test.example/v1',
        model: 'test-model',
      }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ answer: 'OK', provider: 'openai' });
  });
  it('rejects a non-string baseUrl before any provider call', async () => {
    const fetch = vi.fn(async () => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetch);
    const r = await chat(req({ message: 'hi', userKey: 'k', provider: 'openai', baseUrl: {} }));
    expect(r.status).toBe(400);
  });
  it('falls through to offline instead of throwing on a dead endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const r = await chat(
      req({
        message: 'hello there test',
        userKey: 'test-only-key',
        provider: 'openai',
        baseUrl: 'https://openai-compat-test.example/v1',
        model: 'test-model',
      }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ provider: 'offline' });
  });
});
