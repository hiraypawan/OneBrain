import {afterEach,describe,expect,it,vi} from 'vitest';
import worker,{app} from '../src/index';
import {capacityRetryAfter,noteD1Failure} from '../src/platform/capacity';
import {validateRecord} from '../src/platform/records';
afterEach(()=>vi.restoreAllMocks());
const request=(env:any,path='/me',method='GET')=>app.request('/api/platform'+path,{method,headers:{Authorization:`Bearer ${'a'.repeat(64)}`}},env);
describe('advisory overload cooldown, never authorization or a quota ledger',()=>{
 it('only recognizes D1 capacity errors, isolates databases, and expires',()=>{
  const a={},b={};expect(noteD1Failure(a,new Error('bad JSON'),1000)).toBe(false);
  expect(noteD1Failure(a,new Error('D1_ERROR: database overloaded'),1000)).toBe(true);
  expect(capacityRetryAfter(a,1000)).toBe(60);expect(capacityRetryAfter(b,1000)).toBe(0);expect(capacityRetryAfter(a,61000)).toBe(0);
 });
 it('returns Retry-After without another D1 attempt after an actual overload; then recovers',async()=>{
  let failing=true,clock=100000;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  const DB={prepare:vi.fn(()=>({bind:()=>({first:async()=>{if(failing)throw new Error('D1_ERROR: database overloaded');return {id:'u',email:'fixture@example.test'};}})}))};
  const env={DB,API_RATE_LIMITER:{limit:async()=>({success:true})}};
  const first=await request(env);expect(first.status).toBe(503);expect(DB.prepare).toHaveBeenCalledOnce();
  failing=false;
  const second=await request(env);expect(second.status).toBe(503);expect(second.headers.get('Retry-After')).toBe('60');expect(second.headers.get('Cache-Control')).toBe('no-store');expect(DB.prepare).toHaveBeenCalledOnce();
  expect((await request(env,'/capabilities')).status).toBe(200);expect(DB.prepare).toHaveBeenCalledOnce();
  clock+=60000;expect((await request(env)).status).toBe(200);expect(DB.prepare).toHaveBeenCalledTimes(2);
 });
 it('never blocks a revocation attempt behind a cached overload',async()=>{
  const run=vi.fn(async()=>({meta:{changes:1}}));
  const DB={prepare:vi.fn(()=>({bind:()=>({first:async()=>({id:'u',email:'fixture@example.test'}),run})}))};
  noteD1Failure(DB,new Error('D1_ERROR: daily quota exceeded'));
  expect((await request({DB,API_RATE_LIMITER:{limit:async()=>({success:true})}},'/logout','POST')).status).toBe(200);expect(run).toHaveBeenCalledOnce();
 });
 it('skips scheduled database work while the circuit is cooling down',async()=>{
  const DB={prepare:vi.fn()},ctx={waitUntil:vi.fn()};noteD1Failure(DB,new Error('D1_ERROR: overloaded'));
  await worker.scheduled({scheduledTime:Date.now()} as any,{DB} as any,ctx as any);expect(ctx.waitUntil).not.toHaveBeenCalled();expect(DB.prepare).not.toHaveBeenCalled();
 });
});
describe('cheap relationship shape validation',()=>{
 it('rejects malformed relationships before catalog or assignee queries',async()=>{
  const prepare=vi.fn(()=>{throw new Error('Unexpected query');});
  for(const links of ['bad',{},[12],[''],['x'.repeat(201)],Array(51).fill('x')]) {
   await expect(validateRecord({DB:{prepare}} as any,'s',{kind:'note',title:'Invalid',data:{links,assignee:'u'}})).rejects.toMatchObject({status:400});
  }
  expect(prepare).not.toHaveBeenCalled();
 });
});
