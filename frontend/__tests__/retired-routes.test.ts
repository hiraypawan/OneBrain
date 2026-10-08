import { describe, expect, it } from 'vitest';
import { GET, POST, DELETE } from '../app/api/memory/route';
import { POST as stt } from '../app/api/speech/stt/route';

/**
 * Retired and unavailable routes must say so.
 *
 * The Next memory stub used to answer `{ memories: [] }` / `{ ok: true }`,
 * which told the user their saved memories were empty and that a write
 * succeeded when neither was true. It answers 410 now. The server
 * transcription route answers 501 with no transcript rather than a fake empty
 * success.
 */
describe('the retired Next memory route fails closed', () => {
  it.each([['GET', GET], ['POST', POST], ['DELETE', DELETE]] as const)('%s answers 410 and names the live API', async (_method, handler) => {
    const response = await handler();
    expect(response.status).toBe(410);
    const body: any = await response.json();
    expect(String(body.error)).toMatch(/retired/i);
    expect(String(body.error)).toMatch(/platform memory API/i);
    expect(body.memories).toBeUndefined();
    expect(body.ok).toBeUndefined();
  });

  it('never claims a save or an empty list', () => {
    const body = { error: 'This memory route is retired. Use the platform memory API.' };
    expect(JSON.stringify(body)).not.toMatch(/"ok":true/);
  });
});

describe('server transcription stays off honestly', () => {
  it('answers 501 with no transcript and no "note" success shape', async () => {
    const response = await stt();
    expect(response.status).toBe(501);
    const body: any = await response.json();
    expect(body.transcript).toBe('');
    expect(String(body.error)).toMatch(/not enabled/i);
    expect(body.note).toBeUndefined();
  });
});
