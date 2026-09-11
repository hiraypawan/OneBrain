import {afterEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {GET} from '../app/api/platform/[...path]/route';
import {shouldRestoreSession,SESSION_HINT} from '../lib/session-hint';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();vi.resetModules();});
describe('request economy without cached authorization',()=>{
 it('skips guest hydration and delegates Account/Connected checks to their own verifier',()=>{
  expect(shouldRestoreSession('','/','')).toBe(false);
  expect(shouldRestoreSession(`${SESSION_HINT}=1`,'/','')).toBe(true);
  expect(shouldRestoreSession(`${SESSION_HINT}=1`,'/control','?panel=account')).toBe(false);
  expect(shouldRestoreSession(`${SESSION_HINT}=1`,'/control','?panel=shared')).toBe(false);
  expect(shouldRestoreSession(`${SESSION_HINT}=1`,'/control','?panel=voice')).toBe(true);
 });
 it('a forged presence hint cannot authorize or forward a guest API request',async()=>{
  vi.stubEnv('PLATFORM_API_URL','https://api.example.test');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const r=await GET(new NextRequest('https://app.example.test/api/platform/me',{headers:{cookie:`${SESSION_HINT}=1`}}),{params:Promise.resolve({path:['me']})});
  expect(r.status).toBe(401);expect(fetch).not.toHaveBeenCalled();expect(r.cookies.get(SESSION_HINT)?.value).toBe('');
 });
 it('still verifies legacy sessions that do not have the hint, and forwards Retry-After',async()=>{
  vi.stubEnv('PLATFORM_API_URL','https://api.example.test');const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({user:{id:'verified'}})));vi.stubGlobal('fetch',fetch);
  const request=new NextRequest('https://app.example.test/api/platform/bootstrap',{headers:{cookie:'onebrain-platform-session='+ 'a'.repeat(64)}});
  const r=await GET(request,{params:Promise.resolve({path:['bootstrap']})});expect(fetch).toHaveBeenCalledOnce();expect(r.cookies.get(SESSION_HINT)?.value).toBe('1');
  fetch.mockResolvedValue(new Response('{"error":"Busy"}',{status:503,headers:{'Retry-After':'30'}}));
  const busy=await GET(request,{params:Promise.resolve({path:['bootstrap']})});expect(busy.headers.get('Retry-After')).toBe('30');
 });
 it('reuses only public capabilities; identity reads are never cached',async()=>{
  const fetch=vi.fn().mockImplementation(async()=>new Response('{"ok":true}'));vi.stubGlobal('fetch',fetch);
  const {platformApi}=await import('../lib/platform');
  await platformApi('/capabilities');await platformApi('/capabilities');expect(fetch).toHaveBeenCalledOnce();
  await platformApi('/me');await platformApi('/me');expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('does not automatically retry overloads and never blocks explicit sign-out on a client cooldown',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response('{"error":"Capacity unavailable"}',{status:503,headers:{'Retry-After':'60'}})).mockImplementation(async()=>new Response('{"ok":true}'));vi.stubGlobal('fetch',fetch);
  const {platformApi}=await import('../lib/platform');
  await expect(platformApi('/me')).rejects.toThrow('Capacity unavailable');
  await expect(platformApi('/spaces')).rejects.toThrow('Wait before retrying');expect(fetch).toHaveBeenCalledOnce();
  await platformApi('/logout','POST',{});expect(fetch).toHaveBeenCalledTimes(2);
 });
});
