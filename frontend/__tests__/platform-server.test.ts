import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {platformFetch} from '../lib/platform-server';
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:vi.fn()}));
beforeEach(()=>{vi.mocked(getCloudflareContext).mockReset();vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}')));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('private service binding transport',()=>{
 it('prefers the private binding and preserves authorization and the edge client address',async()=>{
  const fetch=vi.fn(async(_request:Request)=>new Response('{"ok":true}'));vi.mocked(getCloudflareContext).mockReturnValue({env:{PLATFORM_API:{fetch}}} as any);vi.stubEnv('PLATFORM_API_URL','https://unused.example.test');
  const result=await platformFetch('/me',{headers:{Authorization:'Bearer fixture'}},'192.0.2.1');expect(result.ok).toBe(true);expect(globalThis.fetch).not.toHaveBeenCalled();
  const request=fetch.mock.calls[0][0] as Request;expect(request.url).toBe('https://onebrain.internal/api/platform/me');expect(request.headers.get('Authorization')).toBe('Bearer fixture');expect(request.headers.get('CF-Connecting-IP')).toBe('192.0.2.1');
 });
 it('uses manual redirects and rejects them without forwarding credentials',async()=>{
  const fetch=vi.fn(async(_request:Request)=>new Response(null,{status:302,headers:{Location:'https://elsewhere.example'}}));vi.mocked(getCloudflareContext).mockReturnValue({env:{PLATFORM_API:{fetch}}} as any);
  await expect(platformFetch('/me',{redirect:'error'})).rejects.toThrow('not followed');expect(fetch.mock.calls[0][0].redirect).toBe('manual');expect(fetch).toHaveBeenCalledOnce();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it('never retries a failed private mutation against a public URL',async()=>{
  vi.mocked(getCloudflareContext).mockReturnValue({env:{PLATFORM_API:{fetch:async()=>{throw new Error('binding unavailable');}}}} as any);vi.stubEnv('PLATFORM_API_URL','https://unused.example.test');
  await expect(platformFetch('/spaces',{method:'POST',body:'{}'})).rejects.toThrow('binding unavailable');expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it('retains the local Next.js transport, without spoofing client IP on public HTTP',async()=>{
  vi.mocked(getCloudflareContext).mockImplementation(()=>{throw new Error('not in Cloudflare');});vi.stubEnv('PLATFORM_API_URL','http://127.0.0.1:8787/');
  await platformFetch('/bootstrap',{method:'GET'},'192.0.2.1');expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:8787/api/platform/bootstrap',{method:'GET',redirect:'manual'});
 });
});
