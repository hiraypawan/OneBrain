import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { safeReturnPath, loginHref, signInErrorMessage, NEXT_COOKIE } from '../lib/auth-return';
import { POST } from '../app/api/auth/google/start/route';
import { GET } from '../app/api/auth/google/callback/route';
import { authRequest, STATE_COOKIE } from '../lib/google-auth-server';
vi.mock('../lib/google-auth-server', async () => ({ ...(await vi.importActual<any>('../lib/google-auth-server')), authRequest: vi.fn() }));
beforeEach(() => vi.mocked(authRequest).mockReset());
const state = 'a'.repeat(64), browser = 'b'.repeat(64), token = 'c'.repeat(64);

describe('safe return path', () => {
  it('keeps same-site paths', () => {
    expect(safeReturnPath('/you')).toBe('/you');
    expect(safeReturnPath('/control?panel=shared')).toBe('/control?panel=shared');
  });
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/auth/login', '/api/x', '', null, 42, '/a\nb'])(
    'rejects %s', (v) => expect(safeReturnPath(v)).toBe('/'));
  it('builds one login link', () => {
    expect(loginHref('/')).toBe('/auth/login');
    expect(loginHref('/control?panel=shared')).toBe('/auth/login?next=%2Fcontrol%3Fpanel%3Dshared');
    expect(loginHref('//evil')).toBe('/auth/login');
  });
  it('explains each failure differently', () => {
    const codes = ['cancelled', 'expired', 'configuration', 'unreachable', 'google'];
    expect(new Set(codes.map(signInErrorMessage)).size).toBe(codes.length);
    expect(signInErrorMessage(null)).toBeNull();
  });
});

const start = (body: string, origin = 'https://app.test') => POST(new NextRequest('https://app.test/api/auth/google/start', {
  method: 'POST', body, headers: { host: 'app.test', origin, 'content-type': 'application/x-www-form-urlencoded' } }));

describe('Google start/callback routes', () => {
  it('remembers a safe return path through Google', async () => {
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ redirect_uri: 'https://app.test/api/auth/google/callback', state });
    vi.mocked(authRequest).mockResolvedValue({ url, state, browserToken: browser });
    const r = await start('next=%2Fyou');
    expect(r.status).toBe(303);
    expect(r.cookies.get(NEXT_COOKIE)?.value).toBe('/you');
  });
  it('never stores an off-site return path', async () => {
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ redirect_uri: 'https://app.test/api/auth/google/callback', state });
    vi.mocked(authRequest).mockResolvedValue({ url, state, browserToken: browser });
    const r = await start('next=%2F%2Fevil.com');
    expect(r.cookies.get(NEXT_COOKIE)?.value).toBe('/');
  });
  it('reports missing setup as configuration, network failure as unreachable', async () => {
    vi.mocked(authRequest).mockRejectedValueOnce(new Error('Google sign-in was not completed'));
    expect((await start('next=%2Fyou')).headers.get('location')).toBe('/auth/login?error=configuration&next=%2Fyou');
    vi.mocked(authRequest).mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await start('')).headers.get('location')).toBe('/auth/login?error=unreachable');
  });
  it('returns the user where they started after sign-in', async () => {
    vi.mocked(authRequest).mockResolvedValue({ token });
    const r = await GET(new NextRequest(`https://app.test/api/auth/google/callback?state=${state}&code=x`, {
      headers: { cookie: `${STATE_COOKIE}=${state}.${browser}; ${NEXT_COOKIE}=%2Fcontrol%3Fpanel%3Dshared` } }));
    expect(r.headers.get('location')).toBe('/control?panel=shared');
  });
  it('tells a cancelled consent apart from a failed exchange', async () => {
    const cancelled = await GET(new NextRequest(`https://app.test/api/auth/google/callback?error=access_denied&state=${state}`, {
      headers: { cookie: `${STATE_COOKIE}=${state}.${browser}` } }));
    expect(cancelled.headers.get('location')).toBe('/auth/login?error=cancelled');
  });
  it('reports a rejected code exchange as a Google error', async () => {
    vi.mocked(authRequest).mockResolvedValue({ token: 'not-a-session' });
    const failed = await GET(new NextRequest(`https://app.test/api/auth/google/callback?state=${state}&code=x`, {
      headers: { cookie: `${STATE_COOKIE}=${state}.${browser}` } }));
    expect(failed.headers.get('location')).toBe('/auth/login?error=google');
  });
});
