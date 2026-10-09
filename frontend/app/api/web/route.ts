import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody, bodyError, RequestBodyError } from '@/lib/request-body';
import {
  searchDirect,
  readDirect,
  gatherSources,
  isSafePublicUrl,
  MAX_PAGE_CHARS,
} from '@/lib/websearch';

// Live web access for the browser: search engines, arbitrary pages ("scraping")
// and multi-source research bundles. All of it keyless.
//
// The browser cannot call these hosts itself — duckduckgo.com, bing.com,
// enquiry.indianrail.gov.in and api.adsb.lol send no CORS header — so the app
// asks its own route and this route fetches. That makes it a proxy, so it is
// deliberately narrow:
//   * http/https only, public hosts only (see isSafePublicUrl — no loopback,
//     no RFC1918, no cloud metadata IP, no odd ports, no credentials in URLs);
//   * its own User-Agent and Accept headers only — client-supplied headers are
//     never forwarded, so this cannot be used to impersonate a browser or to
//     carry an Authorization header to a third party;
//   * bounded response size and hard timeouts;
//   * no request body is ever forwarded.
// It is an SSRF guard, not a rate limiter: it protects the network the app runs
// on, and the honest labelling of sources happens in the callers.

export async function POST(req: NextRequest) {
  let input: Record<string, unknown>;
  try {
    input = await readJsonBody(req);
  } catch (error) {
    return bodyError(error);
  }
  const action = typeof input.action === 'string' ? input.action : '';
  try {
    if (action === 'search') {
      const q = typeof input.q === 'string' ? input.q.trim().slice(0, 300) : '';
      if (!q) throw new RequestBodyError('Missing search query.', 400);
      const max = typeof input.max === 'number' && input.max > 0 ? Math.min(20, Math.floor(input.max)) : 8;
      const r = await searchDirect(q, undefined, max);
      return NextResponse.json({ action, q, hits: r.hits, providers: r.providers, errors: r.errors });
    }

    if (action === 'read') {
      const url = typeof input.url === 'string' ? input.url.trim() : '';
      const guard = isSafePublicUrl(url);
      if (!guard.ok) throw new RequestBodyError(`Refusing to fetch that address (${guard.reason}).`, 400);
      const maxChars =
        typeof input.maxChars === 'number' && input.maxChars > 0
          ? Math.min(MAX_PAGE_CHARS * 4, Math.floor(input.maxChars))
          : MAX_PAGE_CHARS;
      const page = await readDirect(guard.url!.toString(), undefined, maxChars, { raw: input.raw === true });
      if (!page) return NextResponse.json({ action, url: guard.url!.toString(), error: 'unreadable' }, { status: 502 });
      return NextResponse.json({ action, ...page });
    }

    if (action === 'bundle') {
      const q = typeof input.q === 'string' ? input.q.trim().slice(0, 300) : '';
      if (!q) throw new RequestBodyError('Missing research query.', 400);
      const readPages =
        typeof input.readPages === 'number' && input.readPages > 0 ? Math.min(6, Math.floor(input.readPages)) : 3;
      const bundle = await gatherSources(q, { readPages, viaServer: false });
      return NextResponse.json({
        action,
        q,
        sources: bundle.sources,
        providers: bundle.providers,
        errors: bundle.errors,
        asOf: new Date().toISOString(),
      });
    }

    throw new RequestBodyError('Unknown action. Use search, read or bundle.', 400);
  } catch (error) {
    return bodyError(error);
  }
}
