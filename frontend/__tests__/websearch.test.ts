// Live web layer: keyless search, page reading, source gathering and the SSRF
// guard on /api/web. Every network call is injected, so these run offline —
// the point is that a provider failing never invents a result.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseDuckDuckGoHtml,
  parseBingHtml,
  parseMojeekHtml,
  unwrapRedirectHref,
  stripTags,
  extractReadable,
  absoluteUrl,
  dedupeHits,
  domainOf,
  isSafePublicUrl,
  searchDirect,
  readDirect,
  gatherSources,
  webSearch,
  looksLive,
  liveFacts,
  type FetchLike,
} from '../lib/websearch';

const DDG_HTML = `
<html><body><div class="results">
  <div class="result"><div class="links_main links_deep result__body">
    <h2 class="result__title"><a rel="noopener" class="result__a"
      href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.mumbaimetroone.com%2Ftimings&rut=abc1">Mumbai Metro timings</a></h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.mumbaimetroone.com%2Ftimings">
      First train from Versova at 05:55, last train at 23:41. &amp; frequency 4-8 minutes.
    </a>
  </div></div>
  <div class="result"><div class="links_main links_deep result__body">
    <h2 class="result__title"><a class="result__a" href="https://example.org/local">Mumbai local FAQ</a></h2>
    <a class="result__snippet" href="https://example.org/local">Central line peak frequency is 3 minutes.</a>
  </div></div>
</div></body></html>`;

const BING_HTML = `
<ol id="b_results">
  <li class="b_algo"><h2><a href="https://en.wikipedia.org/wiki/Mumbai_Suburban_Railway">Mumbai Suburban Railway</a></h2>
    <p>The network carries more than 7 million passengers every day.</p></li>
  <li class="b_algo"><h2><a href="https://example.net/second">Second result</a></h2><p>Second snippet.</p></li>
</ol>`;

const PAGE_HTML = `
<html><head><title>Mumbai Metro Line 1 — Timetable</title>
<script>var tracking = 1;</script></head>
<body>
<nav><a href="/">Home</a><a href="/about">About</a></nav>
<article>
  <p>The Versova-Andheri-Ghatkopar corridor runs from 05:55 until 23:41 on weekdays, with headways of four to eight minutes during peak hours.</p>
  <p>Fares start at ten rupees for the shortest hop and the operator publishes revised timings before every festival schedule.</p>
</article>
<footer>Copyright</footer>
</body></html>`;

function mockFetch(handler: (url: string, init?: any) => { ok?: boolean; status?: number; body?: string }): FetchLike {
  return vi.fn(async (url: string, init?: any) => {
    const r = handler(String(url), init);
    return {
      ok: r.ok !== false,
      status: r.status ?? 200,
      text: async () => r.body ?? '',
    };
  }) as unknown as FetchLike;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTML helpers', () => {
  it('unwraps DuckDuckGo redirect links', () => {
    expect(unwrapRedirectHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fx&rut=z')).toBe('https://a.example/x');
    expect(unwrapRedirectHref('https://plain.example/x')).toBe('https://plain.example/x');
  });
  it('strips tags, scripts and decodes entities', () => {
    expect(stripTags('<p>a &amp; b</p><script>x()</script>')).toBe('a & b');
  });
  it('resolves relative hrefs and refuses non-http schemes', () => {
    expect(absoluteUrl('https://a.example/x', '/y')).toBe('https://a.example/y');
    expect(absoluteUrl('https://a.example/x', 'javascript:alert(1)')).toBeNull();
  });
  it('keeps one hit per URL', () => {
    const hits = [
      { title: 'a', url: 'https://a.example/x?utm=1', snippet: '', source: 'duckduckgo' },
      { title: 'a again', url: 'https://a.example/x', snippet: '', source: 'bing' },
      { title: 'b', url: 'https://b.example/', snippet: '', source: 'bing' },
    ];
    expect(dedupeHits(hits).map((h) => h.title)).toEqual(['a', 'b']);
    expect(domainOf('https://www.a.example/x')).toBe('a.example');
  });
});

describe('search-result parsers', () => {
  it('reads DuckDuckGo HTML, unwrapping redirects and entities', () => {
    const hits = parseDuckDuckGoHtml(DDG_HTML);
    expect(hits).toHaveLength(2);
    expect(hits[0].url).toBe('https://www.mumbaimetroone.com/timings');
    expect(hits[0].title).toBe('Mumbai Metro timings');
    expect(hits[0].snippet).toContain('frequency 4-8 minutes');
    expect(hits[0].source).toBe('duckduckgo');
  });
  it('reads Bing HTML', () => {
    const hits = parseBingHtml(BING_HTML);
    expect(hits.map((h) => h.url)).toEqual([
      'https://en.wikipedia.org/wiki/Mumbai_Suburban_Railway',
      'https://example.net/second',
    ]);
    expect(hits[0].snippet).toContain('7 million passengers');
  });
  it('returns nothing (never a guess) for an unexpected page', () => {
    expect(parseDuckDuckGoHtml('<html>captcha wall</html>')).toEqual([]);
    expect(parseBingHtml('<html>captcha wall</html>')).toEqual([]);
    expect(parseMojeekHtml('<html>captcha wall</html>')).toEqual([]);
  });
});

describe('readable text extraction', () => {
  it('keeps article paragraphs and drops nav, scripts and short crumbs', () => {
    const { title, text } = extractReadable(PAGE_HTML);
    expect(title).toBe('Mumbai Metro Line 1 — Timetable');
    expect(text).toContain('05:55 until 23:41');
    expect(text).toContain('revised timings');
    expect(text).not.toContain('var tracking');
    expect(text).not.toContain('Copyright');
  });
});

describe('SSRF guard', () => {
  it('allows ordinary public https URLs', () => {
    expect(isSafePublicUrl('https://example.com/page?q=1').ok).toBe(true);
    expect(isSafePublicUrl('http://8.8.8.8/x').ok).toBe(true);
  });
  it('refuses internal hosts, metadata IPs, odd ports and non-http schemes', () => {
    for (const bad of [
      'http://localhost/admin',
      'http://127.0.0.1/',
      'http://10.1.2.3/',
      'http://192.168.1.1/router',
      'http://172.16.0.5/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://printer.local/',
      'http://internal.service/',
      'http://printer/',
      'http://api.svc.cluster.local/x',
      'http://host.test/admin',
      'http://example.com:8080/',
      'ftp://example.com/x',
      'http://user:pass@example.com/',
      'not a url',
    ]) {
      expect(isSafePublicUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe('searchDirect (scraped engines)', () => {
  it('returns the first provider that parses, and reports the others', async () => {
    const fetchImpl = mockFetch((url) => (url.includes('duckduckgo') ? { body: DDG_HTML } : { ok: false, status: 403 }));
    const r = await searchDirect('mumbai metro timings', fetchImpl);
    expect(r.providers).toEqual(['duckduckgo']);
    expect(r.hits[0].url).toContain('mumbaimetroone.com');
    expect(r.errors.length).toBe(0);
  });
  it('falls through to the next engine when one is blocked', async () => {
    const fetchImpl = mockFetch((url) => (url.includes('bing') ? { body: BING_HTML } : { ok: false, status: 403 }));
    const r = await searchDirect('mumbai suburban', fetchImpl);
    expect(r.providers).toEqual(['bing']);
    expect(r.hits).toHaveLength(2);
  });
  it('answers with errors, not invented hits, when nothing works', async () => {
    const r = await searchDirect('anything', mockFetch(() => ({ ok: false, status: 503 })));
    expect(r.hits).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('readDirect', () => {
  it('returns readable text for a page', async () => {
    const page = await readDirect('https://www.mumbaimetroone.com/timings', mockFetch(() => ({ body: PAGE_HTML })));
    expect(page?.title).toBe('Mumbai Metro Line 1 — Timetable');
    expect(page?.text).toContain('05:55 until 23:41');
  });
  it('keeps a JSON endpoint verbatim (bounded)', async () => {
    const page = await readDirect('https://api.adsb.lol/v2/callsign/AIC101', mockFetch(() => ({ body: '{"ac":[{"callsign":"AIC101"}]}' })));
    expect(page?.text).toBe('{"ac":[{"callsign":"AIC101"}]}');
  });
  it('refuses an internal address without fetching it', async () => {
    const fetchImpl = mockFetch(() => ({ body: PAGE_HTML }));
    expect(await readDirect('http://127.0.0.1/admin', fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('gatherSources', () => {
  it('searches, reads the best results and labels each source', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('duckduckgo')) return { body: DDG_HTML };
      if (url.includes('mumbaimetroone.com')) return { body: PAGE_HTML };
      return { body: '<html><body><article><p>' + 'Local trains run every three minutes in the peak. '.repeat(3) + '</p></article></body></html>' };
    });
    const r = await gatherSources('mumbai metro and local timings', { fetchImpl, readPages: 2 });
    expect(r.sources.length).toBeGreaterThanOrEqual(2);
    expect(r.sources[0].domain).toBe('mumbaimetroone.com');
    // The read page, not the search snippet, is what gets quoted.
    expect(r.sources[0].snippet).toContain('05:55 until 23:41');
    expect(r.providers).toContain('duckduckgo');
  });
  it('spreads sources across domains instead of repeating one site', async () => {
    const fetchImpl = mockFetch(() => ({
      body: `<div class="result__body"><h2><a class="result__a" href="https://same.example/1">One</a></h2><a class="result__snippet">snippet one</a></div>
             <div class="result__body"><h2><a class="result__a" href="https://same.example/2">Two</a></h2><a class="result__snippet">snippet two</a></div>
             <div class="result__body"><h2><a class="result__a" href="https://other.example/3">Three</a></h2><a class="result__snippet">snippet three</a></div>`,
    }));
    const r = await gatherSources('x', { fetchImpl, readPages: 0 });
    // Distinct domains come first; the repeat is last, not in the middle.
    expect(r.sources.map((s) => s.domain)).toEqual(['same.example', 'other.example', 'same.example']);
  });
});

describe('webSearch routing', () => {
  it('asks the app’s own /api/web route first when running in a browser', async () => {
    vi.stubGlobal('window', {});
    const fetchImpl = mockFetch((url, init) => {
      if (url.endsWith('/api/web')) {
        expect(JSON.parse(init.body).action).toBe('search');
        return { body: JSON.stringify({ hits: [{ title: 'T', url: 'https://a.example/x', snippet: 's', source: 'duckduckgo' }], providers: ['duckduckgo'] }) };
      }
      throw new Error('should not scrape directly from the browser');
    });
    const r = await webSearch('mumbai local', { fetchImpl });
    expect(r.providers).toEqual(['duckduckgo']);
    expect(r.hits[0].url).toBe('https://a.example/x');
  });
  it('falls back to keyless CORS providers when the route is not deployed', async () => {
    vi.stubGlobal('window', {});
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith('/api/web')) return { ok: false, status: 404 };
      if (url.includes('wikipedia')) {
        return { body: JSON.stringify({ query: { search: [{ title: 'Mumbai Metro', snippet: 'A rapid transit <em>system</em>' }] } }) };
      }
      if (url.includes('hn.algolia')) {
        return { body: JSON.stringify({ hits: [{ title: 'Transit data', url: 'https://news.example/x' }] }) };
      }
      return { ok: false, status: 403 };
    });
    const r = await webSearch('mumbai metro', { fetchImpl });
    expect(r.providers).toEqual(expect.arrayContaining(['wikipedia', 'hackernews']));
    expect(r.hits[0].title).toBe('Mumbai Metro');
    expect(r.errors).toContain('web route unavailable');
  });
});

describe('live facts for a chat turn', () => {
  it('only looks up questions about things that change', () => {
    expect(looksLive('latest iPhone price in India')).toBe(true);
    expect(looksLive('aaj mumbai me mausam kaisa hai')).toBe(true);
    expect(looksLive('sensex today')).toBe(true);
    expect(looksLive('add a note to call mom')).toBe(false);
    expect(looksLive('20 + 4')).toBe(false);
  });
  it('returns labelled lines, or nothing at all', async () => {
    const fetchImpl = mockFetch((url) => (url.includes('duckduckgo') ? { body: DDG_HTML } : { ok: false, status: 403 }));
    const facts = await liveFacts('mumbai metro timings', { fetchImpl });
    expect(facts).toContain('1) Mumbai Metro timings (mumbaimetroone.com)');
    const none = await liveFacts('x', { fetchImpl: mockFetch(() => ({ ok: false, status: 503 })) });
    expect(none).toBe('');
  });
});
