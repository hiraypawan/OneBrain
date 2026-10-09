// /api/web is a proxy, so its guard is the security boundary: it may only ever
// fetch a public web URL, and it must say so rather than quietly reaching
// inside the network it runs on.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/web/route';

const DDG_HTML = `
<div class="result"><div class="links_main links_deep result__body">
  <h2 class="result__title"><a class="result__a" href="https://www.mumbaimetroone.com/timings">Mumbai Metro timings</a></h2>
  <a class="result__snippet" href="https://www.mumbaimetroone.com/timings">First train 05:55, last train 23:41, headway four to eight minutes in the peak.</a>
</div></div>`;

const PAGE_HTML = `
<html><head><title>Timetable</title></head><body>
<article><p>The corridor runs from 05:55 until 23:41 on weekdays and the operator publishes revised timings before every festival.</p></article>
</body></html>`;

function req(body: unknown) {
  return new NextRequest('https://app.example.test/api/web', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function stubFetch(handler: (url: string, init?: any) => { ok?: boolean; status?: number; body?: string }) {
  const calls: { url: string; init?: any }[] = [];
  const fetchMock = vi.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return { ok: r.ok !== false, status: r.status ?? 200, text: async () => r.body ?? '' };
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/web — search', () => {
  it('returns scraped hits and the provider that answered', async () => {
    stubFetch((url) => (url.includes('duckduckgo') ? { body: DDG_HTML } : { ok: false, status: 403 }));
    const res = await POST(req({ action: 'search', q: 'mumbai metro timings' }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.providers).toEqual(['duckduckgo']);
    expect(j.hits[0].url).toBe('https://www.mumbaimetroone.com/timings');
  });
  it('rejects an empty query', async () => {
    stubFetch(() => ({ body: DDG_HTML }));
    expect((await POST(req({ action: 'search', q: '   ' }))).status).toBe(400);
  });
});

describe('POST /api/web — read', () => {
  it('reads a public page', async () => {
    stubFetch(() => ({ body: PAGE_HTML }));
    const res = await POST(req({ action: 'read', url: 'https://www.mumbaimetroone.com/timings' }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.title).toBe('Timetable');
    expect(j.text).toContain('05:55 until 23:41');
    expect(j.raw).toBeUndefined();
  });
  it('returns bounded markup only when asked, for table parsing', async () => {
    stubFetch(() => ({ body: PAGE_HTML }));
    const j = await (await POST(req({ action: 'read', url: 'https://www.mumbaimetroone.com/t', raw: true }))).json();
    expect(typeof j.raw).toBe('string');
    expect(j.raw.length).toBeLessThanOrEqual(200000);
  });
  it('refuses internal targets without making a request', async () => {
    const calls = stubFetch(() => ({ body: PAGE_HTML }));
    for (const url of [
      'http://127.0.0.1/admin',
      'http://localhost:3000/api',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://api.svc.cluster.local/x',
      'ftp://example.com/x',
      'http://user:pass@example.com/',
    ]) {
      const res = await POST(req({ action: 'read', url }));
      expect(res.status, url).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
  it('reports an unreadable page as 502, not as an empty success', async () => {
    stubFetch(() => ({ ok: false, status: 503 }));
    const res = await POST(req({ action: 'read', url: 'https://example.com/x' }));
    expect(res.status).toBe(502);
  });
});

describe('POST /api/web — bundle', () => {
  it('searches and reads in one call, labelling each source', async () => {
    stubFetch((url) => {
      if (url.includes('duckduckgo')) return { body: DDG_HTML };
      return { body: PAGE_HTML };
    });
    const res = await POST(req({ action: 'bundle', q: 'mumbai metro timings', readPages: 1 }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.sources.length).toBeGreaterThanOrEqual(1);
    expect(j.sources[0].domain).toBe('mumbaimetroone.com');
    expect(j.sources[0].snippet).toContain('05:55 until 23:41');
    expect(j.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('rejects unknown actions', async () => {
    stubFetch(() => ({ body: DDG_HTML }));
    expect((await POST(req({ action: 'launch', q: 'x' }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
  });
});
