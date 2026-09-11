import { describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { app } from '../src/index';

// Test-only key; not a deployment credential.
const testSecret = 'test-only-signing-key-not-for-production-0123456789';
async function tokenFor(id: string) {
  return new SignJWT({ id, email: `${id}@example.test` }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(testSecret));
}
describe('authentication and ownership', () => {
  it('does not issue tokens or write users without secure auth configuration', async () => {
    const prepare = vi.fn();
    const response = await app.request('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@example.test', password: 'test-only-password' }) }, { DB: { prepare } } as any);
    expect(response.status).toBe(410);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects anonymous conversation-history requests', async () => {
    const prepare = vi.fn();
    const response = await app.request('/api/chat/history/other-conversation', {}, { DB: { prepare }, JWT_SECRET: testSecret } as any);
    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('binds history reads to the authenticated user, not just a guessed conversation id', async () => {
    const all = vi.fn(async () => ({ results: [] }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn((sql:string) => sql.includes('platform_sessions')?({bind:()=>({first:async()=>({id:'owner',email:'owner@example.test'})})}):({bind}));
    const response = await app.request('/api/chat/history/guessed-id', { headers: { Authorization: `Bearer ${'a'.repeat(64)}` } }, { DB: { prepare }, JWT_SECRET: testSecret } as any);
    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('AND user_id = ?'));
    expect(bind).toHaveBeenCalledWith('guessed-id', 'owner');
  });
  it('does not accept the former public default signing secret', async () => {
    const forged = await new SignJWT({ id: 'owner' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode('dev-insecure-secret-change-me'));
    const prepare = vi.fn();
    const response = await app.request('/api/chat/history/id', { headers: { Authorization: `Bearer ${forged}` } }, { DB: { prepare }, JWT_SECRET: testSecret } as any);
    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('does not call cloud speech just because a host key exists', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await app.request('/api/speech/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Test' }) }, { DB: {}, ELEVENLABS_API_KEY: 'test-only-key' } as any);
    expect(await response.json()).toEqual({ fallback: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('free-only chat and speech boundaries', () => {
  it('rejects malformed and oversized chat input before provider calls', async () => {
    for (const body of ['null', '{', JSON.stringify({ message: 42 }), JSON.stringify({ message: 'a'.repeat(65000) }), JSON.stringify({ message: 'hello', history: 'wrong' })]) {
      const response = await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, {} as any);
      expect([400, 413]).toContain(response.status);
    }
  });
  it('never uses a host OpenAI, Gemini or ElevenLabs key', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const env = { ENABLE_HOST_AI: '1', ENABLE_CLOUD_SPEECH: '1', OPENAI_API_KEY: 'test-only-host-key', GEMINI_API_KEY: 'test-only-host-key', ELEVENLABS_API_KEY: 'test-only-host-key' } as any;
      const speech = await app.request('/api/speech/tts', { method: 'POST' }, env);
      expect(await speech.json()).toEqual({ fallback: true });
      const response = await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hello' }) }, env);
      expect((await response.json() as any).provider).toBe('offline');
      expect(fetch.mock.calls).toHaveLength(1);
      expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('https://text.pollinations.ai/');
    } finally { vi.unstubAllGlobals(); }
  });
});
