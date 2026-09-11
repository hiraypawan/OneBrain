import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import app from '../src/app';

test('legacy API validates input and cannot spend configured host provider keys', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const originalFetch = globalThis.fetch;
  const names = ['ENABLE_HOST_AI', 'ENABLE_CLOUD_SPEECH', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY'];
  const previous = names.map(name => process.env[name]);
  const outbound: string[] = [];
  for (const name of names) process.env[name] = name.startsWith('ENABLE_') ? '1' : 'test-only-host-key';
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(base)) return originalFetch(input, init);
    outbound.push(String(input)); return new Response('', { status: 503 });
  };
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const body of [null, {}, { message: 42 }, { message: 'hello', history: 'bad' }, { message: 'hello', userKey: {} }]) {
      assert.equal((await post('/api/chat', body)).status, 400);
    }
    assert.equal((await post('/api/chat', { message: 'a'.repeat(70000) })).status, 413);
    assert.deepEqual(outbound, []);
    assert.equal((await post('/api/speech/stt', {})).status, 501);
    assert.deepEqual(await (await post('/api/speech/tts', { text: 'hello' })).json(), { fallback: true });
    const chat = await post('/api/chat', { message: 'hello' });
    assert.equal(chat.status, 200);
    assert.equal((await chat.json() as { provider: string }).provider, 'offline');
    assert.deepEqual(outbound, ['https://text.pollinations.ai/']);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
