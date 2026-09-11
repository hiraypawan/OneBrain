import { describe, it, expect, vi, afterEach } from 'vitest';
import { looksFactual, cleanWikiText, fetchWikipedia } from '../lib/knowledge';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('looksFactual', () => {
  it('catches who/what/list/current questions', () => {
    expect(looksFactual('Who won Bigg Boss 18?')).toBe(true);
    expect(looksFactual('current people India')).toBe(true);
    expect(looksFactual('Bigg Boss 20 contestants')).toBe(true);
    expect(looksFactual('India ki capital kya hai')).toBe(true);
  });

  it('ignores chitchat and long messages', () => {
    expect(looksFactual('hello kaise ho')).toBe(false);
    expect(looksFactual('remind me at 6pm')).toBe(false);
    expect(looksFactual('x'.repeat(300))).toBe(false);
  });
});

describe('cleanWikiText', () => {
  it('strips refs and cuts at sentence bounds', () => {
    expect(cleanWikiText('Bigg Boss is a show.[1][2] It airs yearly.')).toBe('Bigg Boss is a show. It airs yearly.');
    const long = `Sentence one. ${'Word '.repeat(200)}end.`;
    const out = cleanWikiText(long, 500);
    expect(out.length).toBeLessThanOrEqual(501);
    expect(out.endsWith('.') || out.endsWith('…')).toBe(true);
  });
});

describe('fetchWikipedia', () => {
  it('returns title + trimmed extract', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('list=search')
        ? { ok: true, json: async () => ({ query: { search: [{ title: 'Bigg Boss' }] } }) }
        : {
            ok: true,
            json: async () => ({
              query: { pages: { 1: { extract: 'Bigg Boss is an Indian reality show. It is very popular.' } } },
            }),
          }
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWikipedia('Bigg Boss contestants');
    expect(res?.title).toBe('Bigg Boss');
    expect(res?.text).toMatch(/reality show/);
    expect(res?.url).toMatch(/wikipedia\.org/);
  });

  it('returns null when nothing found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ query: { search: [] } }) })));
    expect(await fetchWikipedia('zzzqqq')).toBeNull();
  });
});
