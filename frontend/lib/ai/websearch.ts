// Live web access for OneBrain: keyless search, page reading ("scraping") and
// source gathering. No API keys, no accounts, no paid tiers — only public
// endpoints that answer an anonymous request.
//
// Why two paths exist:
//   * Server path (Next route /api/web): the browser cannot fetch
//     duckduckgo.com, bing.com, enquiry.indianrail.gov.in or api.adsb.lol —
//     they send no CORS header. The route fetches them and returns JSON.
//   * Browser path: used when the app is deployed as a static export with no
//     route available. Only genuinely CORS-open endpoints are used there
//     (Wikipedia, Hacker News Algolia, Crossref).
//
// Everything is defensive: a provider that fails is skipped, and the caller
// always learns WHICH providers answered so the answer can be labelled
// honestly. Nothing here invents a result.
//
// Parsing is pure (string in, data out) so it is unit-tested without network.

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  /** Which provider produced this hit ("duckduckgo", "wikipedia", …). */
  source: string;
}

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 OneBrainResearch/1.0';

export const SEARCH_TIMEOUT_MS = 9000;
export const READ_TIMEOUT_MS = 12000;
/** Never pull more than this from one page. */
export const MAX_PAGE_BYTES = 1_500_000;
/** Readable text kept per page. */
export const MAX_PAGE_CHARS = 4000;

// ── Small HTML helpers (pure) ──────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–',
  mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  middot: '·', bull: '•', deg: '°', times: '×',
};

export function decodeEntities(input: string): string {
  return String(input || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Drop tags, scripts/styles and comments; fold whitespace. */
export function stripTags(html: string): string {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

export function absoluteUrl(base: string, href: string): string | null {
  const raw = String(href || '').trim();
  if (!raw || raw.startsWith('javascript:') || raw.startsWith('#')) return null;
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** DuckDuckGo wraps results: //duckduckgo.com/l/?uddg=<encoded real url>. */
export function unwrapRedirectHref(href: string): string {
  const raw = String(href || '');
  if (!/duckduckgo\.com\/l\/?/.test(raw)) return raw;
  const m = raw.match(/[?&]uddg=([^&]+)/);
  if (!m) return raw;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return raw;
  }
}

// ── Search-result parsers (pure) ───────────────────────────────────────

function anchorBlocks(html: string, containerRe: RegExp): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(containerRe)) out.push(m[0]);
  return out;
}

const FIRST_HREF = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;

export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const block of anchorBlocks(html, /<div[^>]+class="[^"]*result__body[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*result__body|$)/gi)) {
    const a = block.match(FIRST_HREF);
    if (!a) continue;
    const url = absoluteUrl('https://duckduckgo.com/', unwrapRedirectHref(decodeEntities(a[1])));
    if (!url) continue;
    const title = stripTags(a[2]);
    const snip = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = stripTags(snip?.[1] || '');
    if (!title) continue;
    hits.push({ title: title.slice(0, 180), url, snippet: snippet.slice(0, 400), source: 'duckduckgo' });
  }
  // The lite endpoint has no result__body wrapper: plain linked headings.
  if (!hits.length) {
    for (const m of html.matchAll(/<a[^>]+class="[^"]*result-link[^"]*"[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = absoluteUrl('https://lite.duckduckgo.com/', unwrapRedirectHref(decodeEntities(m[1])));
      if (!url) continue;
      const title = stripTags(m[2]);
      if (!title) continue;
      hits.push({ title: title.slice(0, 180), url, snippet: '', source: 'duckduckgo-lite' });
    }
  }
  return hits;
}

export function parseBingHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const block of anchorBlocks(html, /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?(?=<li[^>]+class="[^"]*b_algo|<\/ol>)/gi)) {
    const a = block.match(FIRST_HREF);
    if (!a) continue;
    const url = absoluteUrl('https://www.bing.com/', decodeEntities(a[1]));
    if (!url) continue;
    const title = stripTags(a[2]);
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = stripTags(p?.[1] || '');
    if (!title) continue;
    hits.push({ title: title.slice(0, 180), url, snippet: snippet.slice(0, 400), source: 'bing' });
  }
  return hits;
}

export function parseMojeekHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const block of anchorBlocks(html, /<li[^>]*>[\s\S]*?<h2[\s\S]*?<\/h2>[\s\S]*?(?=<li|<\/ul>)/gi)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = absoluteUrl('https://www.mojeek.com/', decodeEntities(a[1]));
    if (!url) continue;
    const title = stripTags(a[2]);
    const p = block.match(/<p[^>]*class="[^"]*s[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (!title) continue;
    hits.push({ title: title.slice(0, 180), url, snippet: stripTags(p?.[1] || '').slice(0, 400), source: 'mojeek' });
  }
  return hits;
}

/** One hit per URL, keeping the first (best-ranked) wording. */
export function dedupeHits(hits: SearchHit[], max = 10): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    const key = h.url.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
    if (!h.url || seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ── Readable text extraction (pure) ────────────────────────────────────

const BLOCK_TAGS = /(p|li|h[1-6]|div|section|article|blockquote|td|br|tr)\b/gi;

export function extractReadable(html: string, maxChars = MAX_PAGE_CHARS): { title: string; text: string } {
  const raw = String(html || '');
  const titleM = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripTags(titleM?.[1] || '').slice(0, 200);
  // Drop navigation chrome and non-content embeds before textifying.
  const body = raw
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|svg|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const text = decodeEntities(body.replace(/<[^>]*>/g, (m) => (BLOCK_TAGS.test(m) ? '\n' : ' ')))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    // Cookie walls, menu crumbs and 1-word nav leftovers are not content.
    .filter((line) => line.length > 40)
    .join('\n')
    .trim();
  return { title, text: text.slice(0, maxChars) };
}

// ── SSRF guard (pure) ──────────────────────────────────────────────────
// /api/web fetches whatever URL it is given, so it must refuse anything that
// is not a plain public web page. This is the same rule applied on both sides.

// Suffixes that are never in the public DNS root: reserved (RFC 2606/6762),
// special-use, or container/cluster names. A URL ending in one of these is
// aimed at the network the app runs on, not at the web.
const NON_PUBLIC_TLD =
  /\.(internal|local|localhost|test|invalid|example|arpa|lan|svc|corp|home|intranet|localdomain|service|onion)$/i;

const PRIVATE_HOSTS = /^(localhost|metadata\.google\.internal|.*\.cluster\.local)$/i;

/** A hostname with no dot resolves inside the local network, not the web. */
function isSingleLabelHost(host: string): boolean {
  return !host.includes('.') && !host.includes(':');
}

function isPrivateIp(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (v4.slice(1).some((o) => Number(o) > 255)) return true;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const v6 = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (v6.includes(':')) {
    if (v6 === '::' || v6 === '::1') return true;
    if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8')) return true;
    // IPv4-mapped (::ffff:127.0.0.1)
    const mapped = v6.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return false;
}

export function isSafePublicUrl(raw: string): { ok: boolean; reason?: string; url?: URL } {
  let u: URL;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'protocol not allowed' };
  if (u.username || u.password) return { ok: false, reason: 'credentials in URL' };
  const host = u.hostname;
  if (!host) return { ok: false, reason: 'no host' };
  if (PRIVATE_HOSTS.test(host) || NON_PUBLIC_TLD.test(host)) return { ok: false, reason: 'private host' };
  if (isSingleLabelHost(host)) return { ok: false, reason: 'unqualified host' };
  if (isPrivateIp(host)) return { ok: false, reason: 'private address' };
  if (u.port && !['80', '443'].includes(u.port)) return { ok: false, reason: 'port not allowed' };
  return { ok: true, url: u };
}

// ── Direct network calls (server side, or CORS-open browser providers) ──

async function getText(url: string, fetchImpl: FetchLike, timeoutMs: number, method = 'GET'): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const r = await fetchImpl(url, {
      method,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' },
      signal: typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body: typeof body === 'string' ? body.slice(0, MAX_PAGE_BYTES) : '' };
  } catch {
    return { ok: false, status: 0, body: '' };
  }
}

export const SERVER_SEARCH_PROVIDERS: { name: string; url: (q: string) => string; parse: (h: string) => SearchHit[]; method?: string }[] = [
  {
    name: 'duckduckgo',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDuckDuckGoHtml,
    method: 'POST',
  },
  {
    name: 'duckduckgo-lite',
    url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
    parse: parseDuckDuckGoHtml,
    method: 'POST',
  },
  {
    name: 'bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20`,
    parse: parseBingHtml,
  },
  {
    name: 'mojeek',
    url: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
    parse: parseMojeekHtml,
  },
];

/** Scraped search engines. Server side only (they send no CORS header). */
export async function searchDirect(
  query: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  maxHits = 8,
): Promise<{ hits: SearchHit[]; providers: string[]; errors: string[] }> {
  const q = String(query || '').trim().slice(0, 300);
  const errors: string[] = [];
  const providers: string[] = [];
  if (!q) return { hits: [], providers, errors: ['empty query'] };
  for (const p of SERVER_SEARCH_PROVIDERS) {
    const r = await getText(p.url(q), fetchImpl, SEARCH_TIMEOUT_MS, p.method || 'GET');
    if (!r.ok || !r.body) {
      errors.push(`${p.name}: ${r.status || 'no response'}`);
      continue;
    }
    let hits: SearchHit[];
    try {
      hits = p.parse(r.body);
    } catch {
      hits = [];
    }
    if (hits.length) {
      providers.push(p.name);
      const out = dedupeHits(hits, maxHits);
      if (out.length) return { hits: out, providers, errors };
    }
    errors.push(`${p.name}: no results parsed`);
  }
  return { hits: [], providers, errors };
}

/** Raw markup is only ever returned when the caller needs to parse structure
 *  (e.g. a railway timetable table). Always bounded. */
export const MAX_RAW_CHARS = 200_000;

/** Read one page and return its readable text. Server side (no CORS). */
export async function readDirect(
  url: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  maxChars = MAX_PAGE_CHARS,
  opts: { raw?: boolean } = {},
): Promise<{ url: string; title: string; text: string; chars: number; raw?: string; error?: string } | null> {
  const guard = isSafePublicUrl(url);
  if (!guard.ok) return null;
  const r = await getText(guard.url!.toString(), fetchImpl, READ_TIMEOUT_MS);
  if (!r.ok || !r.body) return null;
  const trimmed = r.body.slice(0, MAX_PAGE_BYTES);
  const raw = opts.raw ? trimmed.slice(0, MAX_RAW_CHARS) : undefined;
  // A JSON endpoint is already readable; keep it verbatim but bounded.
  if (/^\s*[[{]/.test(trimmed)) {
    const compact = trimmed.replace(/\s+/g, ' ').trim();
    return { url: guard.url!.toString(), title: '', text: compact.slice(0, maxChars), chars: compact.length, raw };
  }
  const { title, text } = extractReadable(trimmed, maxChars);
  if (!text && !raw) return null;
  return { url: guard.url!.toString(), title, text, chars: text.length, raw };
}

// ── CORS-open providers usable straight from the browser ───────────────

/** Wikipedia: free, keyless, CORS-open (`origin=*`), and fresh. */
export async function wikipediaHits(
  query: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  max = 4,
): Promise<SearchHit[]> {
  try {
    const api = 'https://en.wikipedia.org/w/api.php';
    const s = await getText(
      `${api}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${max}&format=json&origin=*`,
      fetchImpl,
      SEARCH_TIMEOUT_MS,
    );
    if (!s.ok) return [];
    const j = JSON.parse(s.body);
    const rows = Array.isArray(j?.query?.search) ? j.query.search : [];
    return rows
      .filter((r: any) => r?.title)
      .map((r: any) => ({
        title: String(r.title),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, '_'))}`,
        snippet: stripTags(String(r.snippet || '')).slice(0, 400),
        source: 'wikipedia',
      }));
  } catch {
    return [];
  }
}

/** Hacker News (Algolia): keyless and CORS-open; good for tech/news topics. */
export async function hackerNewsHits(
  query: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  max = 4,
): Promise<SearchHit[]> {
  try {
    const s = await getText(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${max}`,
      fetchImpl,
      SEARCH_TIMEOUT_MS,
    );
    if (!s.ok) return [];
    const j = JSON.parse(s.body);
    const rows = Array.isArray(j?.hits) ? j.hits : [];
    return rows
      .filter((h: any) => h?.url || h?.objectID)
      .map((h: any) => ({
        title: String(h.title || h.story_title || ''),
        url: String(h.url || `https://news.ycombinator.com/item?id=${h.objectID}`),
        snippet: stripTags(String(h.story_text || '')).slice(0, 300),
        source: 'hackernews',
      }))
      .filter((h: SearchHit) => h.title);
  } catch {
    return [];
  }
}

/** Keyless browser search: only endpoints that allow a cross-origin read. */
export async function searchBrowser(
  query: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  maxHits = 8,
): Promise<{ hits: SearchHit[]; providers: string[] }> {
  const providers: string[] = [];
  const [wiki, hn] = await Promise.all([wikipediaHits(query, fetchImpl), hackerNewsHits(query, fetchImpl)]);
  if (wiki.length) providers.push('wikipedia');
  if (hn.length) providers.push('hackernews');
  return { hits: dedupeHits([...wiki, ...hn], maxHits), providers };
}

/**
 * Search the live web. In a browser this asks the app's own /api/web route
 * first (which can scrape real search engines) and falls back to the keyless
 * CORS-open providers; on the server it scrapes directly.
 */
export async function webSearch(
  query: string,
  opts: { fetchImpl?: FetchLike; viaServer?: boolean; maxHits?: number } = {},
): Promise<{ hits: SearchHit[]; providers: string[]; errors: string[] }> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const maxHits = opts.maxHits ?? 8;
  const errors: string[] = [];
  if (opts.viaServer !== false && typeof window !== 'undefined') {
    const via = await callWebRoute({ action: 'search', q: String(query).slice(0, 300), max: maxHits }, fetchImpl);
    if (via && Array.isArray(via.hits) && via.hits.length) {
      return {
        hits: dedupeHits(via.hits.slice(0, maxHits), maxHits),
        providers: Array.isArray(via.providers) ? via.providers.map(String) : ['web'],
        errors,
      };
    }
    errors.push('web route unavailable');
  }
  const direct = await searchDirect(query, fetchImpl, maxHits);
  if (direct.hits.length) return { ...direct, errors: [...errors, ...direct.errors] };
  const browser = await searchBrowser(query, fetchImpl, maxHits);
  return {
    hits: browser.hits,
    providers: [...direct.providers, ...browser.providers],
    errors: [...errors, ...direct.errors, ...(browser.hits.length ? [] : ['no keyless provider answered'])],
  };
}

/** Read a page through the app's own route (the browser cannot, CORS). */
export async function readPage(
  url: string,
  opts: { fetchImpl?: FetchLike; maxChars?: number; raw?: boolean } = {},
): Promise<{ url: string; title: string; text: string; chars: number; raw?: string } | null> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof window === 'undefined') return readDirect(url, fetchImpl, opts.maxChars, { raw: opts.raw });
  const guard = isSafePublicUrl(url);
  if (!guard.ok) return null;
  const via = await callWebRoute(
    {
      action: 'read',
      url: guard.url!.toString(),
      maxChars: opts.maxChars ?? MAX_PAGE_CHARS,
      raw: opts.raw === true,
    },
    fetchImpl,
  );
  if (via && ((typeof via.text === 'string' && via.text) || (typeof via.raw === 'string' && via.raw))) {
    return {
      url: String(via.url || url),
      title: String(via.title || ''),
      text: typeof via.text === 'string' ? via.text : '',
      chars: Number(via.chars || (via.text || '').length),
      raw: typeof via.raw === 'string' ? via.raw : undefined,
    };
  }
  return null;
}

/** One POST helper for /api/web; null when the route is not deployed. */
async function callWebRoute(payload: Record<string, unknown>, fetchImpl: FetchLike): Promise<any | null> {
  const bases = new Set<string>(['']);
  const configured = (typeof process !== 'undefined' && (process.env as any)?.NEXT_PUBLIC_API_URL) || '';
  if (configured) bases.add(configured);
  const body = JSON.stringify(payload);
  for (const base of bases) {
    try {
      const r = await fetchImpl(`${base}/api/web`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(READ_TIMEOUT_MS + 4000) : undefined,
      });
      if (r && typeof (r as any).text !== 'function') continue;
      // A route that does not exist answers 404/405 — try the next base.
      if (!r.ok) continue;
      const j = JSON.parse(await r.text());
      return j && typeof j === 'object' ? j : null;
    } catch {
      /* next base */
    }
  }
  return null;
}

// ── Source gathering for research ──────────────────────────────────────

/**
 * Search, then read the most useful results. Returns grounded sources with
 * real snippets; if reading fails the search snippet is used, so a source is
 * never presented as read when it was not.
 */
export async function gatherSources(
  query: string,
  opts: { fetchImpl?: FetchLike; searchHits?: number; readPages?: number; viaServer?: boolean } = {},
): Promise<{ sources: WebSource[]; providers: string[]; errors: string[] }> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const wanted = opts.searchHits ?? 8;
  const toRead = opts.readPages ?? 3;
  const search = await webSearch(query, { fetchImpl, maxHits: wanted, viaServer: opts.viaServer });
  const sources: WebSource[] = [];
  const picked = dedupeHits(search.hits, wanted);
  const readTargets = picked.slice(0, toRead);
  const reads = await Promise.all(
    readTargets.map(async (h) => {
      const page = await readPage(h.url, { fetchImpl });
      return { hit: h, page };
    }),
  );
  for (const { hit, page } of reads) {
    sources.push({
      title: page?.title || hit.title,
      url: hit.url,
      snippet: (page?.text || hit.snippet || '').slice(0, 1200),
      domain: domainOf(hit.url),
    });
  }
  for (const h of picked.slice(toRead)) {
    if (!h.snippet) continue;
    sources.push({ title: h.title, url: h.url, snippet: h.snippet.slice(0, 700), domain: domainOf(h.url) });
  }
  // Spread across domains: five results from one site is one source, not five.
  const seenDomain = new Set<string>();
  const spread = sources.filter((s) => {
    if (!s.domain || seenDomain.has(s.domain)) return false;
    seenDomain.add(s.domain);
    return true;
  });
  const rest = sources.filter((s) => !spread.includes(s));
  return {
    sources: [...spread, ...rest].slice(0, 8),
    providers: search.providers,
    errors: search.errors,
  };
}

// ── Live facts for a normal chat turn ──────────────────────────────────

/**
 * True when the question cannot be answered from memory: it asks for
 * something that changes (news, prices, results, schedules, "today").
 * Deliberately narrow — a wide net would put every turn behind a web search.
 */
export function looksLive(message: string): boolean {
  const t = String(message || '').trim();
  if (!t || t.length > 240) return false;
  return /\b(latest|current|today|tonight|this week|right now|live|news|headline|score|result|rate|price|cost|quote|weather|temperature|forecast|election|poll|release|released|update|updated|stock|sensex|nifty|dollar|rupee|flight|train|metro|match|ipl|world cup|breaking)\b/i.test(t)
    || /\b(aaj|abhi|kal|taaza|naya|nayi|khabar|samachar|rate|daam|kitne|kab|mausam|chunaav|election|score|match|result|live)\b/i.test(t);
}

/**
 * Compact, labelled live facts for the system prompt. Every line names its
 * source, and the caller is told these are reference data, not instructions.
 * Returns '' when nothing answered — never a guess.
 */
export async function liveFacts(
  query: string,
  opts: { fetchImpl?: FetchLike; max?: number } = {},
): Promise<string> {
  const search = await webSearch(query, { fetchImpl: opts.fetchImpl, maxHits: opts.max ?? 5 });
  const lines = search.hits
    .slice(0, opts.max ?? 5)
    .filter((h) => h.snippet || h.title)
    .map((h, i) => `${i + 1}) ${h.title} (${domainOf(h.url) || 'source'}): ${h.snippet || 'no snippet'}`);
  return lines.join('\n');
}
