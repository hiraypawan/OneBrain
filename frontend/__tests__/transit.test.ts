// Live transit: what OneBrain may claim about trains, Mumbai local, metro and
// flights — and, more importantly, what it must NOT claim when a source does
// not answer. Every provider call is injected, so this runs offline.
import { describe, it, expect, vi } from 'vitest';
import {
  detectTransitIntent,
  matchCity,
  callsignVariants,
  distanceKm,
  ntesDate,
  ntesLiveUrl,
  parseNtesRunning,
  parseAdsbAircraft,
  trainLiveStatus,
  liveFlights,
  suburbanStatus,
  metroTimings,
  pnrResult,
  trainsBetween,
  runTransit,
  CITY_TRANSIT,
  NTES_HUMAN_URL,
} from '../lib/transit';
import type { FetchLike } from '../lib/websearch';

const NTES_HTML = `
<html><body>
<div>Train Name : MUMBAI RAJDHANI</div>
<div>Train Started from source station. Late by 12 min</div>
<table>
 <tr><th>#</th><th>Station</th><th>Sch Arr</th><th>Sch Dep</th><th>Actual</th><th>Delay</th><th>PF</th></tr>
 <tr><td>1</td><td>H NIZAMUDDIN</td><td>--</td><td>16:55</td><td>17:07</td><td>12 min</td><td>4</td></tr>
 <tr><td>2</td><td>MATHURA JN</td><td>18:20</td><td>18:22</td><td></td><td></td><td></td></tr>
 <tr><td>3</td><td>RATLAM JN</td><td>21:15</td><td>21:20</td><td></td><td></td><td></td></tr>
</table>
<p>This page carries enough prose to survive the readable-text extractor, which drops short lines and navigation.</p>
</body></html>`;

const ADSB_PAYLOAD = JSON.stringify({
  ac: [
    { hex: '800abc', callsign: 'AIC101 ', lat: 19.2, lon: 72.9, alt_baro: 12000, gs: 280, track: 250, seen: 3 },
    { hex: '800def', callsign: 'IGO612', lat: 19.5, lon: 73.4, alt_baro: 34000, gs: 460, track: 90, seen: 8 },
    { hex: '800111', callsign: '', lat: 19.1, lon: 72.9 },
  ],
});

const DDG_RESULTS = (title: string, url: string, snippet: string) => `
<div class="result"><div class="links_main links_deep result__body">
  <h2 class="result__title"><a class="result__a" href="${url}">${title}</a></h2>
  <a class="result__snippet" href="${url}">${snippet}</a>
</div></div>`;

function mockFetch(handler: (url: string) => { ok?: boolean; status?: number; body?: string }): FetchLike {
  return vi.fn(async (url: string) => {
    const r = handler(String(url));
    return { ok: r.ok !== false, status: r.status ?? 200, text: async () => r.body ?? '' };
  }) as unknown as FetchLike;
}

describe('transit intent detection', () => {
  it('routes a 5-digit train number to live status', () => {
    const i = detectTransitIntent('12951 train status kahan pahunchi');
    expect(i?.kind).toBe('train-live');
    expect(i?.trainNo).toBe('12951');
  });
  it('routes a PNR question to PNR, not to train status', () => {
    const i = detectTransitIntent('PNR 1234567890 confirm hua kya?');
    expect(i?.kind).toBe('pnr');
    expect(i?.pnr).toBe('1234567890');
  });
  it('recognises Mumbai local and its lines', () => {
    const i = detectTransitIntent('mumbai local central line aaj delay hai kya');
    expect(i?.kind).toBe('suburban');
    expect(i?.city?.id).toBe('mumbai');
    expect(i?.line).toBe('Central line');
  });
  it('takes stations out of a route question', () => {
    const i = detectTransitIntent('mumbai local from churchgate to andheri timetable');
    expect(i?.kind).toBe('suburban');
    expect(i?.from).toBe('churchgate');
    expect(i?.to).toBe('andheri');
  });
  it('routes metro questions with the city', () => {
    const i = detectTransitIntent('pune metro first train timing kya hai');
    expect(i?.kind).toBe('metro');
    expect(i?.city?.id).toBe('pune');
  });
  it('routes flight status and keeps the flight number as a callsign', () => {
    const i = detectTransitIntent('AI101 flight status kahan hai abhi');
    expect(i?.kind).toBe('flights');
    expect(i?.callsign).toBe('AI101');
    const del = detectTransitIntent('delhi me flight arrival status live');
    expect(del?.kind).toBe('flights');
    expect(del?.city?.id).toBe('delhi');
  });
  it('routes trains between stations', () => {
    const i = detectTransitIntent('trains from pune to mumbai batao');
    expect(i?.kind).toBe('between');
    expect(i?.from).toBe('pune');
    expect(i?.to).toBe('mumbai');
  });
  it('leaves ordinary chat alone', () => {
    expect(detectTransitIntent('namaste, kaise ho')).toBeNull();
    expect(detectTransitIntent('20 pushups kiye')).toBeNull();
    expect(detectTransitIntent('')).toBeNull();
  });
  it('matches cities from what people actually say', () => {
    expect(matchCity('churchgate se borivali local')?.id).toBe('mumbai');
    expect(matchCity('ameerpet metro')?.id).toBe('hyderabad');
    expect(matchCity('nothing relevant here')).toBeNull();
  });
});

describe('provider helpers', () => {
  it('builds official enquiry URLs with the right date shape', () => {
    const d = new Date('2026-03-04T05:00:00Z');
    const { jDate, jDateDay } = ntesDate(d);
    expect(jDate).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4}$/);
    expect(jDateDay).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/);
    const url = ntesLiveUrl('12951', d);
    expect(url).toContain('enquiry.indianrail.gov.in/mntes/q');
    expect(url).toContain('trainNo=12951');
    expect(url).toContain('subOpt=ShowRunC');
  });
  it('maps flight numbers to probable ADS-B callsigns', () => {
    expect(callsignVariants('AI101')).toEqual(['AI101', 'AIC101']);
    expect(callsignVariants('6E 2043')).toEqual(['6E2043', 'IGO2043']);
    expect(callsignVariants('AIC101')).toEqual(['AIC101']);
  });
  it('computes a plausible great-circle distance', () => {
    const km = distanceKm(19.0896, 72.8656, 18.5204, 73.8567); // BOM -> Pune
    expect(km).toBeGreaterThan(100);
    expect(km).toBeLessThan(150);
    expect(distanceKm(19.0896, 72.8656, 19.0896, 72.8656)).toBe(0);
  });
  it('parses the official live-running table', () => {
    const p = parseNtesRunning(NTES_HTML);
    expect(p.trainName).toBe('MUMBAI RAJDHANI');
    expect(p.status).toContain('Late by 12 min');
    expect(p.rows[0].station).toBe('H NIZAMUDDIN');
    expect(p.rows[0].actual).toBe('17:07');
    expect(p.rows[0].platform).toBe('4');
    expect(p.rows).toHaveLength(3);
  });
  it('parses both ADS-B payload shapes', () => {
    const ac = parseAdsbAircraft(JSON.parse(ADSB_PAYLOAD));
    expect(ac.map((a) => a.callsign)).toEqual(['AIC101', 'IGO612']);
    expect(ac[0].altitudeFt).toBe(12000);
    const sky = parseAdsbAircraft({
      states: [['800abc', 'AIC101 ', 'India', 1700000000, 1700000001, 72.9, 19.2, 3657.6, false, 231.5, 250, null, 0]],
    });
    expect(sky[0].callsign).toBe('AIC101');
    expect(sky[0].altitudeFt).toBe(Math.round(3657.6 * 3.28084));
    expect(sky[0].speedKt).toBe(Math.round(231.5 * 1.94384));
  });
});

describe('train live status', () => {
  it('reports what the official portal said, with the source', async () => {
    const fetchImpl = mockFetch((url) => (url.includes('mntes') ? { body: NTES_HTML } : { ok: false, status: 404 }));
    const r = await trainLiveStatus('12951', { fetchImpl });
    expect(r.live).toBe(true);
    expect(r.spoken).toContain('12951');
    expect(r.lines.join('\n')).toContain('H NIZAMUDDIN');
    expect(r.lines.join('\n')).toContain('MATHURA JN');
    expect(r.sources[0].url).toContain('enquiry.indianrail.gov.in');
  });
  it('says it could not verify instead of inventing a delay', async () => {
    const r = await trainLiveStatus('12951', { fetchImpl: mockFetch(() => ({ ok: false, status: 503 })) });
    expect(r.live).toBe(false);
    expect(r.spoken).toMatch(/nahi mil paya/);
    expect(r.sources[0].url).toBe(NTES_HUMAN_URL);
  });
});

describe('live flights', () => {
  it('lists aircraft nearest the airport first, labelled as ADS-B', async () => {
    const fetchImpl = mockFetch((url) => (url.includes('adsb.lol') ? { body: ADSB_PAYLOAD } : { ok: false, status: 404 }));
    const r = await liveFlights(CITY_TRANSIT[0], { fetchImpl });
    expect(r.live).toBe(true);
    expect(r.lines[0]).toContain('AIC101');
    expect(r.lines[0]).toContain('km from BOM');
    expect(r.notice).toContain('not an airline gate status');
  });
  it('falls back to OpenSky when the first feed is down', async () => {
    const fetchImpl = mockFetch((url) =>
      url.includes('opensky')
        ? { body: JSON.stringify({ states: [['800abc', 'AIC101', 'India', 0, 0, 72.9, 19.2, 3657.6, false, 231.5, 250, null, 0]] }) }
        : { ok: false, status: 503 },
    );
    const r = await liveFlights(CITY_TRANSIT[0], { fetchImpl });
    expect(r.live).toBe(true);
    expect(r.lines[0]).toContain('AIC101');
    expect(r.sources[0].url).toContain('opensky');
  });
  it('never guesses a status when no feed answers', async () => {
    const r = await liveFlights(CITY_TRANSIT[0], { fetchImpl: mockFetch(() => ({ ok: false, status: 503 })) });
    expect(r.live).toBe(false);
    expect(r.spoken).toMatch(/guess nahi karunga/);
  });
});

describe('Mumbai local, metro, PNR and route lookups', () => {
  it('labels suburban results as schedule/news, never as a live feed', async () => {
    const fetchImpl = mockFetch((url) =>
      url.includes('duckduckgo')
        ? {
            body:
              DDG_RESULTS('Mumbai local Central line delayed', 'https://news.example/cr', 'Central line services running 15 minutes late near Kurla.') +
              DDG_RESULTS('Mumbai local timetable', 'https://timetable.example/mumbai', 'First fast local from CSMT at 04:10.'),
          }
        : { ok: false, status: 403 },
    );
    const r = await suburbanStatus(
      { kind: 'suburban', query: 'mumbai local central line delay', city: CITY_TRANSIT[0], line: 'Central line' },
      { fetchImpl },
    );
    expect(r.live).toBe(false);
    expect(r.notice).toContain('not an official suburban live feed');
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.lines.join('\n')).toContain('Central line');
  });
  it('points at the railways when no free source answers for the local', async () => {
    const r = await suburbanStatus(
      { kind: 'suburban', query: 'mumbai local status', city: CITY_TRANSIT[0] },
      { fetchImpl: mockFetch(() => ({ ok: false, status: 503 })) },
    );
    expect(r.live).toBe(false);
    expect(r.sources.map((s) => s.domain)).toEqual(['cr.indianrailways.gov.in', 'wr.indianrailways.gov.in']);
    expect(r.spoken).toMatch(/bana kar nahi bataunga/);
  });
  it('reads metro timings from the live web and says the operator can change them', async () => {
    const fetchImpl = mockFetch((url) =>
      url.includes('duckduckgo')
        ? { body: DDG_RESULTS('Pune Metro timings', 'https://metrorail.example/pune', 'Line 1 runs 06:00 to 22:00.') }
        : { ok: false, status: 403 },
    );
    const r = await metroTimings(matchCity('pune metro'), 'pune metro first train timing', { fetchImpl });
    expect(r.sources[0].domain).toBe('metrorail.example');
    expect(r.notice).toContain('operator can change them');
  });
  it('links the official PNR portal rather than claiming a confirmation', () => {
    const r = pnrResult('1234567890');
    expect(r.live).toBe(false);
    expect(r.spoken).toContain('guess nahi karunga');
    expect(r.sources[0].url).toContain('pnr=1234567890');
  });
  it('gathers trains between stations from the web and says to verify', async () => {
    const fetchImpl = mockFetch((url) =>
      url.includes('duckduckgo')
        ? { body: DDG_RESULTS('Pune to Mumbai trains', 'https://trains.example/pune-mumbai', 'Deccan Queen departs Pune at 07:15.') }
        : { ok: false, status: 403 },
    );
    const r = await trainsBetween({ kind: 'between', query: 'q', from: 'pune', to: 'mumbai' }, { fetchImpl });
    expect(r.sources[0].title).toContain('Pune to Mumbai');
    expect(r.notice).toContain('verify');
  });
});

describe('runTransit dispatch', () => {
  it('sends each intent to its own provider', async () => {
    const offline = mockFetch(() => ({ ok: false, status: 503 }));
    expect((await runTransit({ kind: 'train-live', query: 'q', trainNo: '12951' }, { fetchImpl: offline })).kind).toBe('train-live');
    expect((await runTransit({ kind: 'pnr', query: 'q', pnr: '1234567890' })).kind).toBe('pnr');
    expect((await runTransit({ kind: 'suburban', query: 'q', city: CITY_TRANSIT[0] }, { fetchImpl: offline })).kind).toBe('suburban');
    expect((await runTransit({ kind: 'metro', query: 'pune metro timing', city: CITY_TRANSIT[2] }, { fetchImpl: offline })).kind).toBe('metro');
    expect((await runTransit({ kind: 'flights', query: 'q', city: CITY_TRANSIT[0] }, { fetchImpl: offline })).kind).toBe('flights');
    expect((await runTransit({ kind: 'between', query: 'q', from: 'pune', to: 'mumbai' }, { fetchImpl: offline })).kind).toBe('between');
  });
  it('every result carries a source or says there is none', async () => {
    const offline = mockFetch(() => ({ ok: false, status: 503 }));
    for (const intent of [
      { kind: 'train-live' as const, query: 'q', trainNo: '12951' },
      { kind: 'suburban' as const, query: 'q', city: CITY_TRANSIT[0] },
      { kind: 'flights' as const, query: 'q', city: CITY_TRANSIT[0] },
    ]) {
      const r = await runTransit(intent, { fetchImpl: offline });
      expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(r.spoken.length).toBeGreaterThan(20);
      expect(r.live).toBe(false);
    }
  });
});

// ── Router wiring ──────────────────────────────────────────────────────
// The providers above are called through the feature router, which is the path
// a real spoken turn takes. Stubbed offline: a turn must still come back with
// an honest spoken line, not a crash and not an invented schedule.
describe('feature router wiring', () => {
  it('routes a spoken train question to a transit card', async () => {
    const { handleFeatureTurn } = await import('../lib/feature-engine');
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const turn = await handleFeatureTurn('12951 train status kahan pahunchi');
    expect(turn?.card).toMatchObject({ kind: 'transit' });
    expect(turn?.speak).toMatch(/12951/);
    // The card always says how many sources answered and what the limit was.
    expect(turn?.messages[0].meta).toMatch(/\d+ source/);
    expect(turn?.messages[0].meta).toContain('Official portal did not answer');
    vi.unstubAllGlobals();
  });

  it('routes a Mumbai local question to a transit card, not to the AI fallback', async () => {
    const { handleFeatureTurn } = await import('../lib/feature-engine');
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const turn = await handleFeatureTurn('mumbai local central line aaj delay hai kya');
    expect(turn?.card).toMatchObject({ kind: 'transit' });
    expect(turn?.speak).toMatch(/Mumbai local/);
    vi.unstubAllGlobals();
  });

  it('still lets ordinary chat fall through to the brain', async () => {
    const { handleFeatureTurn } = await import('../lib/feature-engine');
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect(await handleFeatureTurn('namaste, kaise ho')).toBeNull();
    vi.unstubAllGlobals();
  });
});
