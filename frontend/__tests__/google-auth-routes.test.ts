import {describe,it,expect,vi,beforeEach} from 'vitest';
import {NextRequest} from 'next/server';
import {POST} from '../app/api/auth/google/start/route';
import {GET} from '../app/api/auth/google/callback/route';
import {authRequest,STATE_COOKIE,SESSION_COOKIE} from '../lib/google-auth-server';
vi.mock('../lib/google-auth-server',async()=>({...await vi.importActual<any>('../lib/google-auth-server'),authRequest:vi.fn()}));
const state='a'.repeat(64),browser='b'.repeat(64),session='c'.repeat(64);
beforeEach(()=>vi.mocked(authRequest).mockReset());
describe('Google browser cookie boundary',()=>{
 it('sets an HttpOnly browser binding and never sends its secret to Google',async()=>{
  const url='https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({redirect_uri:'https://app.example.test/api/auth/google/callback',state});vi.mocked(authRequest).mockResolvedValue({url,state,browserToken:browser});
  const r=await POST(new NextRequest('https://app.example.test/api/auth/google/start',{method:'POST',headers:{host:'app.example.test',origin:'https://app.example.test'}}));
  expect(r.status).toBe(303);expect(r.headers.get('location')).not.toContain(browser);expect(r.headers.get('set-cookie')).toContain('HttpOnly');expect(r.headers.get('set-cookie')).toContain('Secure');expect(r.cookies.get(STATE_COOKIE)?.value).toBe(`${state}.${browser}`);
 });
 it('rejects cross-origin start before calling the backend',async()=>{
  const r=await POST(new NextRequest('https://app.example.test/api/auth/google/start',{method:'POST',headers:{host:'app.example.test',origin:'https://evil.example'}}));expect(r.status).toBe(403);expect(authRequest).not.toHaveBeenCalled();
 });
 it('moves the verified session into a scoped HttpOnly cookie, not a URL or response body',async()=>{
  vi.mocked(authRequest).mockResolvedValue({token:session,user:{id:'verified-user'}});
  const r=await GET(new NextRequest(`https://app.example.test/api/auth/google/callback?state=${state}&code=test-code`,{headers:{cookie:`${STATE_COOKIE}=${state}.${browser}`}}));
  expect(r.headers.get('location')).toBe('/operations');expect(await r.text()).not.toContain(session);expect(r.cookies.get(SESSION_COOKIE)?.value).toBe(session);expect(r.headers.get('set-cookie')).toContain('HttpOnly');expect(r.cookies.get(STATE_COOKIE)?.value).toBe('');expect(r.headers.get('referrer-policy')).toBe('no-referrer');
 });
 it('rejects missing/mismatched state without exchanging an authorization code',async()=>{
  const r=await GET(new NextRequest(`https://app.example.test/api/auth/google/callback?state=${state}&code=forged`,{headers:{cookie:`${STATE_COOKIE}=wrong.${browser}`}}));expect(r.headers.get('location')).toBe('/auth/login?error=google');expect(authRequest).not.toHaveBeenCalled();
 });
});
