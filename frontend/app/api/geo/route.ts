import { NextRequest, NextResponse } from 'next/server';
import { normalizeCountry } from '@/lib/locale/countries';

// The visitor's country as the network edge sees it. Cloudflare adds
// CF-IPCountry to every request (other hosts use similar headers). The app
// asks for this only when the device time zone does not name a country
// (lib/locale/detect.ts). Only the country code leaves; nothing is stored.
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country'];

export function GET(req: NextRequest) {
  let country: string | null = null;
  for (const header of COUNTRY_HEADERS) {
    country = normalizeCountry(req.headers.get(header));
    if (country) break;
  }
  return NextResponse.json({ country }, { headers: { 'Cache-Control': 'private, no-store' } });
}
