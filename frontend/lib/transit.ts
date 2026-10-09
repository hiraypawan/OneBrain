// Live travel and transit: trains, Mumbai local, metro, flights.
//
// Honest scope, and it matters here more than anywhere else in the app:
//
//  * Indian Railways has NO public keyless JSON API. The official enquiry
//    portal (enquiry.indianrail.gov.in/mntes, CRIS) is public and free, so it
//    is read server-side and parsed. It covers mail/express trains; suburban
//    (Mumbai local) running data is not published there.
//  * Mumbai local live running is not available from any free keyless feed.
//    What IS possible for free is the schedule plus live disruption reports,
//    gathered from the live web and always labelled with source + as-of.
//  * Aircraft positions are free and keyless (ADS-B aggregators), so live
//    flight position/altitude/speed is real. A flight NUMBER is not an ADS-B
//    callsign (AI101 flies as AIC101), so callsign matches are labelled as
//    "probable match" and never presented as a boarding-gate status.
//  * Metro timings are read from the live web (operator sites), not invented.
//
// Nothing in here fabricates a time, a platform or a delay. When a source
// cannot be reached the reply says exactly that and gives the official link.

import { readPage, webSearch, type FetchLike, type WebSource } from './websearch';

export type TransitKind = 'train-live' | 'pnr' | 'suburban' | 'metro' | 'flights' | 'between';

export interface TransitIntent {
  kind: TransitKind;
  /** The user's own words, cleaned up. */
  query: string;
  trainNo?: string;
  pnr?: string;
  callsign?: string;
  city?: CityTransit;
  line?: string;
  from?: string;
  to?: string;
}

export interface TransitResult {
  kind: TransitKind;
  title: string;
  spoken: string;
  lines: string[];
  sources: WebSource[];
  /** True when the numbers came from a live feed rather than a schedule. */
  live: boolean;
  asOf: string;
  /** Honest limitation the user should hear, e.g. "not an official live feed". */
  notice?: string;
}

// ── Knowledge: lines, cities, airports ─────────────────────────────────
// Public, stable facts (station/line geography, airport coordinates). No
// timings live here — timings are always fetched and labelled.

export interface CityTransit {
  id: string;
  city: string;
  /** Names the user may say, in English and Roman Hindi/Marathi. */
  aliases: string[];
  rail: string[];
  metro: string[];
  airport?: { code: string; name: string; lat: number; lon: number };
}

export const CITY_TRANSIT: CityTransit[] = [
  {
    id: 'mumbai',
    city: 'Mumbai',
    aliases: ['mumbai', 'bombay', 'bai', 'chatrapati', 'csmt', 'churchgate', 'andheri', 'borivali', 'virar', 'bandra', 'dadar', 'ghatkopar', 'kurla', 'thane', 'kalyan', 'dombivli', 'ambernath', 'badlapur', 'neral', 'panvel', 'vasai', 'bhiwandi', 'vile parle', 'jogeshwari', 'malad', 'kandivali', 'goregaon', 'marine lines', 'byculla', 'mulund', 'vikroli', 'sion', 'matunga', 'lower parel', 'maha laxmi', 'grant road', 'elphinstone', 'prabhadevi', 'santacruz', 'kharghar', 'nerul', 'vashi', 'mankhurd', 'chembur', 'tilak nagar', 'currey road', 'sandhurst road', 'dockyard', 'reay road', 'cotton green', 'wadala', 'king circle', 'mahim', 'matunga road'],
    rail: ['Central line (CSMT–Kalyan/Kasara)', 'Western line (Churchgate–Dahanu Road)', 'Harbour line (CSMT–Panvel / Andheri–Goregaon)', 'Trans-Harbour (Thane–Kopar Khairane–Panvel)', 'Mumbai Metro Line 1 (Versova–Ghatkopar)', 'Mumbai Metro Line 2A/7', 'Monorail (Chembur–Jacob Circle)'],
    metro: ['Mumbai Metro Line 1: Versova–Ghatkopar', 'Mumbai Metro Line 2A: Dahisar East–DN Nagar', 'Mumbai Metro Line 7: Dahisar East–Gundavali', 'Monorail: Chembur–Jacob Circle'],
    airport: { code: 'BOM', name: 'Chhatrapati Shivaji Maharaj International', lat: 19.0896, lon: 72.8656 },
  },
  {
    id: 'delhi',
    city: 'Delhi',
    aliases: ['delhi', 'new delhi', 'noida', 'gurgaon', 'gurugram', 'ghaziabad', 'faridabad', 'dwarka', 'rohini', 'kashmere gate', 'rajiv chowk', 'airport express'],
    rail: ['Delhi suburban (Delhi–Ghaziabad/Palwal/ROK EMU)'],
    metro: ['Delhi Metro (Red/Yellow/Blue/Green/Violet/Pink/Magenta/Airport Express)', 'Noida Metro Aqua line', 'Rapid Metro Gurgaon'],
    airport: { code: 'DEL', name: 'Indira Gandhi International', lat: 28.5562, lon: 77.1 },
  },
  {
    id: 'pune',
    city: 'Pune',
    aliases: ['pune', 'pimpri', 'chinchwad', 'shivajinagar', 'hadapsar', 'kharadi', 'hinjewadi'],
    rail: ['Pune suburban (Pune–Lonavala / Pune–Talegaon)'],
    metro: ['Pune Metro Line 1 (PCMC–Swargate)', 'Pune Metro Line 2 (Vanaz–Ramwadi)'],
    airport: { code: 'PNQ', name: 'Pune', lat: 18.5821, lon: 73.9197 },
  },
  {
    id: 'bengaluru',
    city: 'Bengaluru',
    aliases: ['bengaluru', 'bangalore', 'bengalooru', 'majestic', 'kempegowda'],
    rail: ['No suburban metro rail running yet (Bengaluru Suburban Rail under construction)'],
    metro: ['Namma Metro Purple line', 'Namma Metro Green line'],
    airport: { code: 'BLR', name: 'Kempegowda International', lat: 13.1986, lon: 77.7066 },
  },
  {
    id: 'chennai',
    city: 'Chennai',
    aliases: ['chennai', 'madras', 'chengalpattu', 'tambaram', 'arul'],
    rail: ['Chennai suburban (Beach–Tambaram–Chengalpattu, Central line, West line)', 'Chennai MRTS'],
    metro: ['Chennai Metro Blue line', 'Chennai Metro Green line'],
    airport: { code: 'MAA', name: 'Chennai International', lat: 12.9941, lon: 80.1709 },
  },
  {
    id: 'hyderabad',
    city: 'Hyderabad',
    aliases: ['hyderabad', 'secunderabad', 'ameerpet', 'miyapur', 'lb nagar'],
    rail: ['Hyderabad MMTS (Falaknuma–Lingampalli / Secunderabad)'],
    metro: ['Hyderabad Metro Red / Blue / Green lines'],
    airport: { code: 'HYD', name: 'Rajiv Gandhi International', lat: 17.2403, lon: 78.4294 },
  },
  {
    id: 'kolkata',
    city: 'Kolkata',
    aliases: ['kolkata', 'calcutta', 'howrah', 'sealdah', 'dum dum'],
    rail: ['Kolkata suburban (Sealdah / Howrah sections)'],
    metro: ['Kolkata Metro Line 1 (North-South)', 'Kolkata Metro Line 2 (East-West)'],
    airport: { code: 'CCU', name: 'Netaji Subhas Chandra Bose International', lat: 22.6547, lon: 88.4467 },
  },
  {
    id: 'london',
    city: 'London',
    aliases: ['london', 'heathrow', 'paddington', 'waterloo', 'victoria', 'king\'s cross'],
    rail: ['National Rail services', 'London Overground', 'Elizabeth line'],
    metro: ['London Underground (all lines)', 'DLR', 'London Tram'],
    airport: { code: 'LHR', name: 'London Heathrow', lat: 51.47, lon: -0.4543 },
  },
  {
    id: 'dubai',
    city: 'Dubai',
    aliases: ['dubai', 'sharjah', 'abu dhabi'],
    rail: ['UAE national rail (limited passenger service)'],
    metro: ['Dubai Metro Red line', 'Dubai Metro Green line', 'Dubai Tram'],
    airport: { code: 'DXB', name: 'Dubai International', lat: 25.2532, lon: 55.3657 },
  },
  {
    id: 'singapore',
    city: 'Singapore',
    aliases: ['singapore', 'changi'],
    rail: ['Singapore MRT'],
    metro: ['MRT North-South / East-West / Circle / Downtown / Thomson-East Coast'],
    airport: { code: 'SIN', name: 'Singapore Changi', lat: 1.3644, lon: 103.9915 },
  },
];

// ── Intent detection (pure) ────────────────────────────────────────────

const MUMBAI_LOCAL_WORDS =
  /(mumbai\s+local|local\s+train|local\s+pakad|central\s+line|western\s+line|harbour\s+line|fast\s+local|slow\s+local|churchgate|csmt|victoria\s+terminus|virar|dahanu|kalyan|kasara|panvel|borivali|andheri|bandra|dadar|ghatkopar|kurla|thane|dombivli|ambernath|badlapur|neral|bhiwandi|vasai)/i;

const METRO_WORDS = /(metro|monorail|namma metro|delhi metro|mumbai metro|pune metro|underground|subway|tube)\b/i;

// Word-bounded on purpose: an unanchored "ba" or "gate" matches inside
// "mumbai" and turned local-train questions into flight lookups.
const FLIGHT_WORDS =
  /\b(flights?|planes?|aircraft|aeroplane|arrival|departure|landed|take ?off|boarding|jet|air ?india|indigo|vistara|akasa|spicejet|emirates|qatar|lufthansa|british airways|singapore airlines)\b/i;

export function detectTransitIntent(text: string): TransitIntent | null {
  const t = String(text || '').trim();
  if (!t || t.length > 220) return null;
  const lower = t.toLowerCase();
  const city = matchCity(t);

  // PNR: a 10-digit number asked about as a booking.
  const pnr = t.match(/\b(\d{10})\b/);
  if (pnr && /(pnr|seat|berth|ticket|confirm|coach|chart)/i.test(t)) {
    return { kind: 'pnr', query: t, pnr: pnr[1] };
  }
  // Live train by number: 5-digit Indian train number.
  const trainNo = t.match(/\b(\d{5})\b/);
  if (trainNo && /(train|status|running|late|delay|kahan|where|delayed|cancelled|platform)/i.test(t)) {
    return { kind: 'train-live', query: t, trainNo: trainNo[1] };
  }
  // Flights: a callsign/flight number, or flight words.
  const callsign = t.match(/\b([a-z]{2}\s?\d{2,4})\b/i);
  if (FLIGHT_WORDS.test(t) && /(status|where|delay|landed|arrive|depart|live|track|time|kab|kahan|late)/i.test(t)) {
    return { kind: 'flights', query: t, callsign: callsign ? callsign[1].replace(/\s+/g, '').toUpperCase() : undefined, city: city || undefined };
  }
  // Mumbai local / suburban.
  if (MUMBAI_LOCAL_WORDS.test(t) && !METRO_WORDS.test(t)) {
    const line = matchLine(t);
    return { kind: 'suburban', query: t, city: city || CITY_TRANSIT[0], line: line || undefined, ...stationsFrom(t) };
  }
  // Metro (any city).
  if (METRO_WORDS.test(t) && /(time|timing|timings|schedule|first|last|frequency|status|delay|closed|open|route|station|kitne|kab|kitna)/i.test(t)) {
    return { kind: 'metro', query: t, city: city || undefined };
  }
  // Trains between two stations (long distance). The trailing request verbs
  // are removed first, otherwise they get read as part of the destination.
  const betweenText = t.replace(/\s+(batao|bata|dikhao|dikha|list|today|kal|tomorrow|please)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const between = betweenText.match(/^(?:trains?|rail)\s+(?:from\s+)?([\w\s]{2,24}?)\s+(?:to|se|aur|and)\s+([\w\s]{2,24})\.?$/i);
  if (between) {
    return { kind: 'between', query: t, from: between[1].trim(), to: between[2].trim() };
  }
  return null;
}

export function matchCity(text: string): CityTransit | null {
  const lower = ` ${String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  let best: { city: CityTransit; score: number } | null = null;
  for (const city of CITY_TRANSIT) {
    for (const alias of [city.city.toLowerCase(), ...city.aliases]) {
      const a = alias.toLowerCase();
      if (a.length < 3) continue;
      if (lower.includes(` ${a} `) || lower.includes(` ${a}s `)) {
        const score = a.length;
        if (!best || score > best.score) best = { city, score };
      }
    }
  }
  return best ? best.city : null;
}

function matchLine(text: string): string | null {
  const t = String(text || '').toLowerCase();
  if (/(central\s+line|main\s+line|cstm|csmt\s+to\s+kalyan)/.test(t)) return 'Central line';
  if (/(western\s+line|churchgate\s+to|wr\b)/.test(t)) return 'Western line';
  if (/(harbour|trans[-\s]?harbour)/.test(t)) return 'Harbour line';
  if (/(mono\s?rail)/.test(t)) return 'Monorail';
  return null;
}

/** "churchgate se andheri" / "from thane to kalyan" */
function stationsFrom(text: string): { from?: string; to?: string } {
  // Drop request words that trail a route, so "andheri timetable" is "andheri".
  const t = String(text || '')
    .replace(/\b(timetable|time ?table|schedule|timings?|batao|bata|dikhao|please|today|kal|tomorrow)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "from X to Y" first: without the anchor, preceding words leak into X.
  const explicit = t.match(/\bfrom\s+([A-Za-z][A-Za-z\s]{2,20}?)\s+(?:to|till|upto)\s+([A-Za-z][A-Za-z\s]{2,20})\b/i);
  const m = explicit || t.match(/\b([A-Za-z][A-Za-z\s]{2,20}?)\s+(?:se|tak)\s+([A-Za-z][A-Za-z\s]{2,20})\b/i);
  if (!m) return {};
  return { from: m[1].trim(), to: m[2].trim() };
}

// ── Providers (keyless) ────────────────────────────────────────────────

/** Official Indian Railways enquiry portal date format. */
export function ntesDate(d: Date = new Date()): { jDate: string; jDateDay: string } {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    jDate: `${pad(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()}`,
    jDateDay: days[d.getDay()],
  };
}

export function ntesLiveUrl(trainNo: string, date: Date = new Date()): string {
  const { jDate, jDateDay } = ntesDate(date);
  const qs = new URLSearchParams({
    opt: 'TrainRunning',
    subOpt: 'ShowRunC',
    trainNo: String(trainNo).slice(0, 5),
    jStation: '',
    jDate,
    jDateDay,
  });
  return `https://enquiry.indianrail.gov.in/mntes/q?${qs.toString()}`;
}

export const NTES_HUMAN_URL = 'https://enquiry.indianrail.gov.in/mntes/';

/**
 * Read the official live-running page into station rows.
 * Pure over HTML so it is testable against a saved fixture.
 */
export function parseNtesRunning(html: string): { trainName?: string; status?: string; rows: { station: string; schedArr: string; schedDep: string; actual: string; delay: string; platform?: string }[] } {
  const rows: { station: string; schedArr: string; schedDep: string; actual: string; delay: string; platform?: string }[] = [];
  const table = String(html || '').match(/<table[\s\S]*?<\/table>/i)?.[0] || '';
  for (const tr of table.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1]
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    if (cells.length < 5) continue;
    const station = cells[1] || cells[0];
    if (!station || /^\s*$/.test(station)) continue;
    // Skip the header row itself.
    if (/^(station|#|s\.?no)/i.test(station)) continue;
    rows.push({
      station: station.slice(0, 60),
      schedArr: (cells[2] || '').slice(0, 12),
      schedDep: (cells[3] || '').slice(0, 12),
      actual: (cells[4] || '').slice(0, 20),
      delay: (cells[5] || '').slice(0, 20),
      platform: (cells[6] || '').slice(0, 6) || undefined,
    });
  }
  const text = String(html || '')
    .replace(/<\/(div|p|tr|h[1-6])>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n');
  const name = text.match(/Train Name\s*:?\s*([^\n]{4,60})/i)?.[1]?.trim();
  const flat = text.replace(/\n/g, ' ');
  // Two passes, not one alternation: match() returns the leftmost hit, so a
  // generic "Train Started" earlier in the page would hide the actual delay.
  const status =
    flat.match(/(Late by \d+ min[^.]{0,20}|Running \d+ min (?:Late|Early)[^.]{0,20}|Cancelled[^.]{0,30}|Diverted[^.]{0,40})/i)?.[1]?.trim() ||
    flat.match(/(Train Started[^.]{0,60}|Train Reached Destination[^.]{0,40})/i)?.[1]?.trim();
  return { trainName: name, status, rows: rows.slice(0, 40) };
}

/** adsb.lol / OpenSky shapes differ; normalise both to one small record. */
export interface AircraftSeen {
  callsign: string;
  hex?: string;
  lat?: number;
  lon?: number;
  altitudeFt?: number;
  speedKt?: number;
  heading?: number;
  seenAgoSec?: number;
}

export function parseAdsbAircraft(payload: unknown): AircraftSeen[] {
  const raw: any = payload;
  const list: any[] = Array.isArray(raw?.ac) ? raw.ac : Array.isArray(raw?.states) ? raw.states.map(flattenOpenSky) : [];
  const out: AircraftSeen[] = [];
  for (const a of list) {
    if (!a) continue;
    const callsign = String(a.callsign || a.cs || '').trim();
    if (!callsign) continue;
    out.push({
      callsign,
      hex: a.hex ? String(a.hex) : undefined,
      lat: num(a.lat ?? a.latitude),
      lon: num(a.lon ?? a.longitude),
      altitudeFt: num(a.alt_baro ?? a.alt ?? a.baroAltitude),
      speedKt: num(a.gs ?? a.velocity),
      heading: num(a.track ?? a.trueTrack),
      seenAgoSec: num(a.seen ?? a.lastSeen),
    });
  }
  return out;
}

function flattenOpenSky(state: any): any {
  if (!Array.isArray(state)) return null;
  return {
    icao24: state[0],
    callsign: String(state[1] || '').trim(),
    lon: state[5],
    lat: state[6],
    baroAltitude: typeof state[7] === 'number' ? Math.round(state[7] * 3.28084) : undefined,
    velocity: typeof state[9] === 'number' ? Math.round(state[9] * 1.94384) : undefined,
    trueTrack: state[10],
    lastSeen: state[4],
  };
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Great-circle distance in km (small, honest maths instead of a claim). */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function adsbRadiusUrl(lat: number, lon: number, distNm = 100): string {
  return `https://api.adsb.lol/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${distNm}`;
}

export function adsbCallsignUrl(callsign: string): string {
  return `https://api.adsb.lol/v2/callsign/${encodeURIComponent(callsign.trim().toUpperCase())}`;
}

export function openSkyBoxUrl(lat: number, lon: number, halfDeg = 2.5): string {
  const q = new URLSearchParams({
    lamin: (lat - halfDeg).toFixed(3),
    lomin: (lon - halfDeg).toFixed(3),
    lamax: (lat + halfDeg).toFixed(3),
    lomax: (lon + halfDeg).toFixed(3),
  });
  return `https://opensky-network.org/api/states/all?${q.toString()}`;
}

/** Airline prefixes so "AI101" can be matched against "AIC101". */
const ICAO_PREFIX: Record<string, string> = {
  AI: 'AIC', UK: 'VTI', '6E': 'IGO', SG: 'SEJ', QP: 'AXM', IX: 'AXB', I5: 'IAD', QH: 'QQE',
  EK: 'UAE', QR: 'QTR', BA: 'BAW', LH: 'DLH', SQ: 'SIA', CX: 'CPA', TG: 'THA', KL: 'KLM',
  AF: 'AFR', TK: 'THY', EY: 'ETD', SV: 'SVA', MU: 'CES', CA: 'CCA', JL: 'JAL', NH: 'ANA',
};

export function callsignVariants(flightNo: string): string[] {
  const f = String(flightNo || '').replace(/\s+/g, '').toUpperCase();
  const m = f.match(/^([A-Z0-9]{2})(\d{1,4})$/);
  if (!m) return f ? [f] : [];
  const [, airline, digits] = m;
  const icao = ICAO_PREFIX[airline];
  const out = new Set<string>([f]);
  if (icao) out.add(`${icao}${digits}`);
  return [...out];
}

// ── Turns ──────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

function asSource(title: string, url: string, snippet: string): WebSource {
  let domain = '';
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch {}
  return { title, url, snippet: String(snippet || '').slice(0, 900), domain };
}

async function readJsonThroughProxy(url: string, fetchImpl?: FetchLike): Promise<any | null> {
  const page = await readPage(url, { fetchImpl, maxChars: 200000 });
  if (!page?.text) return null;
  try {
    return JSON.parse(page.text);
  } catch {
    return null;
  }
}

/** Live flights around an airport, keyless. Falls back to OpenSky. */
export async function liveFlights(
  city: CityTransit,
  { fetchImpl, callsign }: { fetchImpl?: FetchLike; callsign?: string } = {},
): Promise<TransitResult> {
  const ap = city.airport;
  if (!ap) throw new Error(`No airport coordinates known for ${city.city}.`);
  const errors: string[] = [];
  let aircraft: AircraftSeen[] = [];
  let usedUrl = '';
  if (callsign) {
    for (const cs of callsignVariants(callsign)) {
      const url = adsbCallsignUrl(cs);
      const j = await readJsonThroughProxy(url, fetchImpl);
      if (j) {
        const found = parseAdsbAircraft(j);
        if (found.length) {
          aircraft = found;
          usedUrl = url;
          break;
        }
      }
      errors.push(`adsb.lol callsign ${cs}: no match`);
    }
  }
  if (!aircraft.length) {
    const url = adsbRadiusUrl(ap.lat, ap.lon, 100);
    const j = await readJsonThroughProxy(url, fetchImpl);
    if (j) {
      aircraft = parseAdsbAircraft(j);
      usedUrl = url;
    } else errors.push('adsb.lol radius: unreadable');
  }
  if (!aircraft.length) {
    const url = openSkyBoxUrl(ap.lat, ap.lon);
    const j = await readJsonThroughProxy(url, fetchImpl);
    if (j) {
      aircraft = parseAdsbAircraft(j);
      usedUrl = url;
    } else errors.push('opensky: unreadable');
  }
  if (!aircraft.length) {
    return {
      kind: 'flights',
      title: `Live flights · ${city.city}`,
      spoken: `Live flight data ke sources abhi jawab nahi de rahe, isliye main koi time ya status guess nahi karunga. Official site par check karo.`,
      lines: [],
      sources: [asSource('Official airport / airline status', `https://www.${ap.code.toLowerCase()}.aero`, errors.join(' · '))],
      live: false,
      asOf: nowIso(),
      notice: errors.join(' · ') || 'No ADS-B feed answered',
    };
  }
  // Nearest first, and only aircraft with a real position.
  const positioned = aircraft
    .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number')
    .map((a) => ({ ...a, km: distanceKm(ap.lat, ap.lon, a.lat!, a.lon!) }))
    .sort((a, b) => a.km - b.km);
  const list = positioned.slice(0, 6);
  const lines = list.map(
    (a) =>
      `${a.callsign}${a.altitudeFt != null ? ` · ${Math.round(a.altitudeFt).toLocaleString('en-IN')} ft` : ''}${a.speedKt != null ? ` · ${Math.round(a.speedKt)} kt` : ''} · ${a.km} km from ${ap.code}`,
  );
  const spoken = callsign && aircraft.length
    ? `${aircraft[0].callsign} abhi ADS-B par dikh raha hai${list[0]?.altitudeFt != null ? `, ${Math.round(list[0].altitudeFt).toLocaleString('en-IN')} feet par` : ''}. Ye position data hai — gate ya boarding time nahi.`
    : `${ap.code} ke aas paas abhi ${positioned.length} aircraft ADS-B par dikh rahe hain. Sabse nazdeek ${list[0]?.callsign || 'ek flight'}, ${list[0]?.km ?? 0} km door.`;
  return {
    kind: 'flights',
    title: `Live flights · ${city.city} (${ap.code})`,
    spoken,
    lines,
    sources: [asSource('ADS-B live positions (community receivers)', usedUrl, 'Position, altitude, ground speed, heading')],
    live: true,
    asOf: nowIso(),
    notice: 'ADS-B position data, not an airline gate status. Check the airline for boarding/departure times.',
  };
}

/** Live running status of an Indian Railways train from the official portal. */
export async function trainLiveStatus(
  trainNo: string,
  { fetchImpl }: { fetchImpl?: FetchLike } = {},
): Promise<TransitResult> {
  const url = ntesLiveUrl(trainNo);
  const page = await readPage(url, { fetchImpl, maxChars: 20000, raw: true });
  // The timetable is a table, so it is parsed from the markup, not from the
  // readable-text extraction (which flattens rows).
  const markup = page?.raw || page?.text || '';
  const parsed: ReturnType<typeof parseNtesRunning> = markup ? parseNtesRunning(markup) : { rows: [] };
  if (!markup || !parsed.rows.length) {
    return {
      kind: 'train-live',
      title: `Train ${trainNo} · live status`,
      spoken: `Train ${trainNo} ka live status official enquiry portal se nahi mil paya. Ho sakta hai train number galat ho, ya portal busy ho. Main delay guess nahi karunga.`,
      lines: [],
      sources: [asSource('National Train Enquiry System (official)', NTES_HUMAN_URL, 'Spot Your Train')],
      live: false,
      asOf: nowIso(),
      notice: 'Official portal did not answer',
    };
  }
  const done = parsed.rows.filter((r) => r.actual && !/^\s*$/.test(r.actual));
  const last = done[done.length - 1];
  const upcoming = parsed.rows.find((r) => !r.actual || /^\s*$/.test(r.actual));
  const lines = [
    parsed.trainName ? `Train: ${parsed.trainName} (${trainNo})` : `Train ${trainNo}`,
    parsed.status ? `Status: ${parsed.status}` : '',
    last ? `Last reported: ${last.station}${last.actual ? ` — ${last.actual}` : ''}${last.delay ? ` (${last.delay})` : ''}` : '',
    upcoming ? `Next scheduled: ${upcoming.station} — arr ${upcoming.schedArr || '-'}, dep ${upcoming.schedDep || '-'}` : '',
  ].filter(Boolean);
  const spoken = parsed.status
    ? `Train ${trainNo}: ${parsed.status}.${last ? ` Aakhri report ${last.station} se hai.` : ''}`
    : `Train ${trainNo} ki report ${last?.station || 'official portal'} se mili hai; details screen par hain.`;
  return {
    kind: 'train-live',
    title: `Train ${trainNo} · live status`,
    spoken,
    lines,
    sources: [asSource('National Train Enquiry System (official, CRIS)', url, parsed.status || 'Live running status')],
    live: true,
    asOf: nowIso(),
    notice: 'Source: enquiry.indianrail.gov.in (official). Suburban/local trains are not covered there.',
  };
}

/** Mumbai local / any suburban: schedule + live disruption, from the live web. */
export async function suburbanStatus(
  intent: TransitIntent,
  { fetchImpl }: { fetchImpl?: FetchLike } = {},
): Promise<TransitResult> {
  const city = intent.city || CITY_TRANSIT[0];
  const route = intent.from && intent.to ? `${intent.from} to ${intent.to}` : '';
  const line = intent.line ? `${intent.line} ` : '';
  const scheduleQuery = `${city.city} local ${line}${route || 'train'} timetable first last train`;
  const disruptionQuery = `${city.city} local ${line || 'Central Western Harbour'} line delay disruption today`;
  const [schedule, disruption] = await Promise.all([
    webSearch(scheduleQuery, { fetchImpl, maxHits: 5 }),
    webSearch(disruptionQuery, { fetchImpl, maxHits: 5 }),
  ]);
  const sources = [...schedule.hits, ...disruption.hits]
    .slice(0, 6)
    .map((h) => asSource(h.title, h.url, h.snippet));
  const lines = [
    ...city.rail.map((r) => `Line: ${r}`),
    ...(disruption.hits.slice(0, 3).map((h) => `Live report: ${h.title}${h.snippet ? ` — ${h.snippet.slice(0, 160)}` : ''}`)),
  ];
  if (!sources.length) {
    return {
      kind: 'suburban',
      title: `${city.city} local · ${route || line || 'status'}`,
      spoken: `${city.city} local ka live feed free keyless source par available nahi hai, aur main timing ya delay bana kar nahi bataunga. Screen par official lines aur enquiry links hain.`,
      lines: city.rail.map((r) => `Line: ${r}`),
      sources: [
        asSource('Central Railway (official)', 'https://cr.indianrailways.gov.in/', 'Mumbai suburban — Central line'),
        asSource('Western Railway (official)', 'https://wr.indianrailways.gov.in/', 'Mumbai suburban — Western and Harbour lines'),
      ],
      live: false,
      asOf: nowIso(),
      notice: 'No free keyless live feed exists for suburban running. Timings below are schedules from the web, not live positions.',
    };
  }
  const spoken = `${city.city} local — ${route || line || 'network'} ke liye web se schedule aur live reports nikale hain. Ye official live feed nahi hai, isliye platform par jaane se pehle station board zaroor dekh lena.`;
  return {
    kind: 'suburban',
    title: `${city.city} local · ${route || line || 'network'}`,
    spoken,
    lines: lines.slice(0, 8),
    sources,
    live: false,
    asOf: nowIso(),
    notice: 'Schedule and news gathered from the live web — not an official suburban live feed.',
  };
}

/** Metro timings for a city, from the live web (operator sites first). */
export async function metroTimings(
  city: CityTransit | null | undefined,
  query: string,
  { fetchImpl }: { fetchImpl?: FetchLike } = {},
): Promise<TransitResult> {
  const label = city ? city.city : '';
  const q = `${label} ${query}`.replace(/\s+/g, ' ').trim().slice(0, 200);
  const search = await webSearch(q, { fetchImpl, maxHits: 6 });
  const sources = search.hits.slice(0, 5).map((h) => asSource(h.title, h.url, h.snippet));
  if (!sources.length) {
    return {
      kind: 'metro',
      title: `${label} metro`.trim(),
      spoken: `${label} metro ke timings live web se nahi mil paye. Main timing guess nahi karunga — operator ki official site check karo.`,
      lines: (city?.metro || []).map((m) => `Line: ${m}`),
      sources: [],
      live: false,
      asOf: nowIso(),
      notice: 'No source answered',
    };
  }
  const spoken = `${label} metro ke liye ${sources.length} sources mile, pehla ${sources[0].domain} se hai. Timings screen par hain — pehli aur aakhri train ka time operator badal sakta hai.`;
  return {
    kind: 'metro',
    title: `${label} metro timings`.trim(),
    spoken,
    lines: [
      ...(city?.metro || []).map((m) => `Line: ${m}`),
      ...sources.slice(0, 3).map((s) => `${s.title}${s.snippet ? ` — ${s.snippet.slice(0, 140)}` : ''}`),
    ],
    sources,
    live: false,
    asOf: nowIso(),
    notice: 'Timings read from the live web; the operator can change them without notice.',
  };
}

/** PNR: honest — no keyless public JSON, so the official portal is offered. */
export function pnrResult(pnr: string): TransitResult {
  const url = `${NTES_HUMAN_URL}?opt=PNREnq&subOpt=ShowPNR&pnr=${encodeURIComponent(pnr)}`;
  return {
    kind: 'pnr',
    title: `PNR ${pnr}`,
    spoken: `PNR ${pnr} ka live status free keyless API se verify nahi ho sakta, isliye main seat confirm hai ya nahi ye guess nahi karunga. Official enquiry portal ka link screen par hai — wahan current status milega.`,
    lines: [
      `PNR: ${pnr}`,
      'Chart preparation ke baad hi coach/berth final hota hai.',
      'Status badalta rehta hai — official portal hi sahi source hai.',
    ],
    sources: [asSource('Official PNR enquiry (Indian Railways)', url, 'Live PNR status')],
    live: false,
    asOf: nowIso(),
    notice: 'No keyless public PNR feed exists; the official portal is linked instead of guessing.',
  };
}

/** Trains between two stations: gathered from the live web. */
export async function trainsBetween(
  intent: TransitIntent,
  { fetchImpl }: { fetchImpl?: FetchLike } = {},
): Promise<TransitResult> {
  const q = `trains from ${intent.from} to ${intent.to} today timetable`;
  const search = await webSearch(q, { fetchImpl, maxHits: 6 });
  const sources = search.hits.slice(0, 5).map((h) => asSource(h.title, h.url, h.snippet));
  const title = `Trains · ${intent.from} → ${intent.to}`;
  if (!sources.length) {
    return {
      kind: 'between',
      title,
      spoken: `${intent.from} se ${intent.to} ke trains ka live data source se nahi mil paya. Main list bana kar nahi bataunga.`,
      lines: [],
      sources: [asSource('Trains Between Stations (official)', NTES_HUMAN_URL, 'Trains Between Stations')],
      live: false,
      asOf: nowIso(),
      notice: 'No source answered',
    };
  }
  return {
    kind: 'between',
    title,
    spoken: `${intent.from} se ${intent.to} ke liye ${sources.length} sources mile. List screen par hai — seat availability booking se pehle confirm kar lena.`,
    lines: sources.slice(0, 4).map((s) => `${s.title}${s.snippet ? ` — ${s.snippet.slice(0, 140)}` : ''}`),
    sources,
    live: false,
    asOf: nowIso(),
    notice: 'Gathered from the live web; verify on the official portal before booking.',
  };
}

/** One entry point for the feature router. */
export async function runTransit(
  intent: TransitIntent,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<TransitResult> {
  switch (intent.kind) {
    case 'train-live':
      return trainLiveStatus(intent.trainNo!, opts);
    case 'pnr':
      return pnrResult(intent.pnr!);
    case 'suburban':
      return suburbanStatus(intent, opts);
    case 'metro':
      return metroTimings(intent.city, intent.query, opts);
    case 'flights':
      return liveFlights(intent.city || CITY_TRANSIT[0], { fetchImpl: opts.fetchImpl, callsign: intent.callsign });
    case 'between':
      return trainsBetween(intent, opts);
  }
}
