import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { app } from '../src/index';
import { hash, rateLimit } from '../src/platform/core';
import { maintenance } from '../src/platform/maintenance';
import { jsonRequest } from '../src/platform/connectors';
import { validateRecord } from '../src/platform/records';
import { runDue } from '../src/platform/jobs';
let mf:Miniflare, env:any, token='a'.repeat(64), scope='scale-space';
const allow={limit:vi.fn(async()=>({success:true}))};
async function request(path:string,method='GET',body?:unknown, override=env) {
 return app.request('/api/platform'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body&&method!=='GET'?{body:JSON.stringify(body)}:{})},override);
}
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-08-06',d1Databases:['DB']});
 const DB=await mf.getD1Database('DB');
 for(const name of ['0001_schema','0002_platform','0003_session_versions','0004_atomic_allowances','0005_google_identity','0006_free_tier_indexes','0007_action_history_pages']) {
  const sql=readFileSync(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8').replace(/--[^\n]*/g,'');
  const triggers=[...sql.matchAll(/CREATE TRIGGER[\s\S]*?\nEND;/g)].map(m=>m[0]);
  await DB.batch([...sql.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g,'').split(';').filter(s=>s.trim()),...triggers].map(s=>DB.prepare(s)));
 }
 env={DB,API_RATE_LIMITER:allow,AUTH_RATE_LIMITER:allow};
 await DB.batch([
  DB.prepare("INSERT INTO users(id,email,created_at) VALUES('scale-user','scale@example.test',1)"),
  DB.prepare("INSERT INTO google_identities(subject,user_id,verified_email,created_at) VALUES('scale-sub','scale-user','scale@example.test',1)"),
  DB.prepare("INSERT INTO platform_sessions(token_hash,user_id,created_at,expires_at,auth_provider) VALUES(?,'scale-user',1,?,'google')").bind(await hash(token),Date.now()+86400000),
  DB.prepare("INSERT INTO spaces(id,name,owner_id,created_at) VALUES(?,'Scale fixture','scale-user',1)").bind(scope),
  DB.prepare("INSERT INTO space_members VALUES(?,'scale-user','owner',1)").bind(scope),
 ]);
},30000);
afterAll(async()=>{await mf?.dispose();});
describe('free-tier regression boundaries (local, not a production load test)',()=>{
 it('bootstraps only the verified identity and its memberships',async()=>{
  const response=await request('/bootstrap');expect(response.status).toBe(200);
  const body:any=await response.json();expect(body.user.id).toBe('scale-user');expect(body.spaces.map((s:any)=>s.id)).toEqual([scope]);expect(body.records).toBeUndefined();expect(response.headers.get('Cache-Control')).toBe('no-store');
 });
 it('performs no D1 limiter writes for repeated authenticated reads with native bindings',async()=>{
  for(let i=0;i<30;i++)expect((await request('/me')).status).toBe(200);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM platform_rate_limits').first()).n).toBe(0);
 });
 it('rejects at the native limiter before touching D1',async()=>{
  const DB={prepare:vi.fn(()=>{throw new Error('D1 must not be reached');})};
  const response=await request('/me','GET',undefined,{...env,DB,API_RATE_LIMITER:{limit:async()=>({success:false})}});
  expect(response.status).toBe(429);expect(response.headers.get('Retry-After')).toBe('60');expect(DB.prepare).not.toHaveBeenCalled();
 });
 it('keeps 10,000 simulated session limiter keys independent behind one proxy',async()=>{
  const keys=new Set<string>(), DB={prepare:vi.fn()};
  const limiter={limit:async({key}:{key:string})=>{keys.add(key);return {success:true};}};
  await Promise.all(Array.from({length:10000},(_,i)=>rateLimit({env:{DB,API_RATE_LIMITER:limiter},get:()=>`session-${i}`,req:{header:()=> 'one-proxy'},header:vi.fn()} as any,'platform',240)));
  expect(keys.size).toBe(10000);expect(DB.prepare).not.toHaveBeenCalled();
 });
 it('does not create fallback write buckets for random invalid sessions',async()=>{
  const response=await app.request('/api/platform/me',{headers:{Authorization:`Bearer ${'b'.repeat(64)}`}},{...env,API_RATE_LIMITER:undefined});expect(response.status).toBe(401);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM platform_rate_limits').first()).n).toBe(0);
 });
 it('uses keyset pages without losing records with identical timestamps',async()=>{
  const rows=Array.from({length:205},(_,i)=>({id:`page-${String(i).padStart(3,'0')}`,title:`Record ${i}`}));
  await env.DB.prepare("INSERT INTO space_records(id,space_id,kind,title,data,created_by,created_at,updated_at,mutation_id) SELECT json_extract(value,'$.id'),?,'note',json_extract(value,'$.title'),'{}','scale-user',7,7,json_extract(value,'$.id') FROM json_each(?)").bind(scope,JSON.stringify(rows)).run();
  let cursor:string|null=null;const ids:string[]=[];const lengths:number[]=[];
  do { const r=await request(`/spaces/${scope}/records?pageSize=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`);expect(r.status).toBe(200);const b:any=await r.json();ids.push(...b.records.map((r:any)=>r.id));lengths.push(b.records.length);cursor=b.nextCursor; } while(cursor);
  expect(lengths).toEqual([100,100,5]);expect(new Set(ids).size).toBe(205);expect(ids[0]).toBe('page-204');
  expect(((await (await request(`/spaces/${scope}/records`)).json()) as any).records).toHaveLength(205);
 });
 it('rejects invalid and oversized cursors/page sizes and enforces tenant access',async()=>{
  for(const query of ['pageSize=101','pageSize=-1','pageSize=1.5','pageSize=100&cursor=bad','pageSize=100&cursor='+encodeURIComponent(btoa('[0,{}]'))])expect((await request(`/spaces/${scope}/records?${query}`)).status).toBe(400);
  expect((await request('/spaces/not-my-space/records?pageSize=100')).status).toBe(403);
 });
 it('imports 100 assigned records in fewer than 15 prepared queries, atomically and idempotently',async()=>{
  let prepared=0;const DB={prepare:(sql:string)=>{prepared++;return env.DB.prepare(sql);},batch:(queries:any)=>env.DB.batch(queries)};
  const body={importId:'scale-import',records:Array.from({length:100},(_,i)=>({id:`import-${i}`,kind:'task',title:`Assigned ${i}`,data:{assignee:'scale-user',links:i?[`import-${i-1}`]:[]}}))};
  const r=await request(`/spaces/${scope}/import`,'POST',body,{...env,DB});expect(r.status).toBe(201);expect(prepared).toBeLessThan(15);
  expect(((await r.json()) as any).imported).toBe(100);
  expect((await request(`/spaces/${scope}/import`,'POST',body)).status).toBe(200);
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM space_records WHERE space_id=?').bind(scope).first()).n).toBe(305);
 });
 it('does not bypass imported assignee, relationship or completion validation',async()=>{
  const count=async()=> (await env.DB.prepare('SELECT COUNT(*) n FROM space_records WHERE space_id=?').bind(scope).first()).n;
  const before=await count();
  for(const [n,data] of [{assignee:'other-user'},{links:['missing']},{dependencies:['self']},{links:Array(51).fill('self')}].entries()) {
   const r=await request(`/spaces/${scope}/import`,'POST',{importId:`invalid-${n}`,records:[{id:'self',kind:'task',title:'Invalid',data}]});expect(r.status).toBe(n===2?409:400);
  }
  expect((await request(`/spaces/${scope}/import`,'POST',{importId:'invalid-completion',records:[{id:'a',kind:'task',title:'A',data:{status:'done',dependencies:['b']}},{id:'b',kind:'task',title:'B',data:{status:'active'}}]})).status).toBe(409);
  expect(await count()).toBe(before);
 });
 it('uses tenant/time indexes for large inboxes and measures local D1 scan accounting',async()=>{
  await env.DB.prepare("INSERT INTO space_notifications(id,space_id,job_id,title,body,created_at) SELECT 'noise-'||value,?,'noise-'||value,'Fixture','',CAST(value AS INTEGER) FROM json_each(?)").bind(scope,JSON.stringify(Array.from({length:10000},(_,i)=>i))).run();
  const sql='SELECT * FROM space_notifications WHERE space_id=? ORDER BY created_at DESC LIMIT 100';
  const indexed=await env.DB.prepare(sql).bind(scope).all();
  const scan=await env.DB.prepare(sql.replace('space_notifications WHERE','space_notifications NOT INDEXED WHERE')).bind(scope).all();
  const plan=await env.DB.prepare('EXPLAIN QUERY PLAN '+sql).bind(scope).all();
  expect(JSON.stringify(plan.results)).toContain('notifications_scope_time');
  expect(indexed.results).toEqual(scan.results);expect(indexed.meta.rows_read).toBeLessThan(scan.meta.rows_read);
  console.log('LOCAL D1 inbox rows_read, 10,000 rows:',JSON.stringify({indexed:indexed.meta.rows_read,unindexed:scan.meta.rows_read}));
 });
 it('has indexed membership, receipt, cursor and lease lookups',async()=>{
  for(const [sql,index] of [
   ["SELECT * FROM space_members WHERE user_id='scale-user'",'space_members_user'],
   ["SELECT * FROM job_receipts WHERE space_id='scale-space' ORDER BY at DESC LIMIT 1000",'job_receipts_scope_time'],
   ["SELECT * FROM space_records WHERE space_id='scale-space' AND (updated_at,id)<(7,'z') ORDER BY updated_at DESC,id DESC LIMIT 101",'space_records_scope'],
   ["SELECT * FROM jobs WHERE status='running' AND lease_until<10",'jobs_expired_leases'],
  ])expect(JSON.stringify((await env.DB.prepare('EXPLAIN QUERY PLAN '+sql).all()).results)).toContain(index);
 });
 it('does not issue a redundant data UPDATE when creating an unlinked record',async()=>{
  const queries:string[]=[];const DB={prepare:(sql:string)=>{queries.push(sql);return env.DB.prepare(sql);},batch:(q:any)=>env.DB.batch(q)};
  expect((await request(`/spaces/${scope}/records`,'POST',{kind:'note',title:'One insert, not two writes'},{...env,DB})).status).toBe(201);
  expect(queries.some(sql=>sql.startsWith('UPDATE space_records'))).toBe(false);
 });
 it('looks up only referenced records and traverses only reachable dependencies',async()=>{
  const target='query-scale';
  await env.DB.prepare("INSERT INTO spaces(id,name,owner_id,created_at) VALUES(?,'Query fixture','scale-user',1)").bind(target).run();
  await env.DB.prepare("INSERT INTO space_members VALUES(?,'scale-user','owner',1)").bind(target).run();
  await env.DB.prepare("INSERT INTO space_records(id,space_id,kind,title,data,created_by,created_at,updated_at,mutation_id) SELECT 'q-'||value,?,'task','Noise',json_object('body',?,'status','active','links',json('[]'),'dependencies',json('[]')),'scale-user',1,1,'q-'||value FROM json_each(?)").bind(target,'x'.repeat(3000),JSON.stringify(Array.from({length:2000},(_,i)=>i))).run();
  let read=0;const queries:string[]=[];
  const DB={prepare:(sql:string)=>{queries.push(sql);return {bind:(...args:any[])=>{
   const q=env.DB.prepare(sql).bind(...args);
   const all=async()=>{const result=await q.all();read+=result.meta.rows_read;return result;};
   return {all,first:async()=>(await all()).results[0]||null};
  }};}};
  const old=await env.DB.prepare('SELECT id,data FROM space_records WHERE space_id=?').bind(target).all();
  await validateRecord({...env,DB},target,{kind:'note',title:'One link',data:{links:['q-1999']}});
  expect(read).toBeLessThan(20);expect(queries).toHaveLength(1);
  console.log('LOCAL relationship rows_read / 2,000-record catalog:',JSON.stringify({targeted:read,previous:old.meta.rows_read}));
  await expect(validateRecord({...env,DB},target,{kind:'note',title:'Other scope',data:{links:['page-204']}})).rejects.toMatchObject({status:400});
  for(const [id,dep] of [['q-0','q-1'],['q-1','q-2']])await env.DB.prepare("UPDATE space_records SET data=json_set(data,'$.dependencies',json(?)) WHERE id=?").bind(JSON.stringify([dep]),id).run();
  read=0;
  await expect(validateRecord({...env,DB},target,{kind:'task',title:'Cycle',data:{dependencies:['q-0']}},'q-2')).rejects.toMatchObject({status:409});
  expect(read).toBeLessThan(100);
  await expect(validateRecord({...env,DB},target,{kind:'task',title:'Not done',data:{status:'done',dependencies:['q-1']}})).rejects.toMatchObject({status:409});
 });
 it('pages equal-time jobs, returns just latest receipts, and exposes older receipt history',async()=>{
  const target='query-scale',jobs=Array.from({length:31},(_,i)=>`query-job-${String(i).padStart(2,'0')}`);
  await env.DB.prepare("INSERT INTO jobs(id,space_id,action,payload,plan,plan_hash,status,created_by,created_at,updated_at,next_run,runs,mutation_id) SELECT value,?,'local.notify','{}','{}','fixture','verified','scale-user',7,7,7,30,value FROM json_each(?)").bind(target,JSON.stringify(jobs)).run();
  await env.DB.prepare("INSERT INTO job_receipts(id,job_id,space_id,run_number,at,status,evidence) SELECT j.value||'-'||r.value,j.value,?,r.value,7,'verified','{}' FROM json_each(?) j CROSS JOIN json_each(?) r").bind(target,JSON.stringify(jobs),JSON.stringify(Array.from({length:30},(_,i)=>i+1))).run();
  const first:any=await (await request(`/spaces/${target}/jobs?pageSize=25`)).json();
  expect(first.jobs).toHaveLength(25);expect(first.receipts).toHaveLength(25);expect(first.receipts.every((r:any)=>r.run_number===30)).toBe(true);
  const second:any=await (await request(`/spaces/${target}/jobs?pageSize=25&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  expect(second.jobs).toHaveLength(6);expect(second.nextCursor).toBeNull();expect(new Set([...first.jobs,...second.jobs].map(r=>r.id)).size).toBe(31);
  const legacy:any=await (await request(`/spaces/${target}/jobs`)).json();expect(legacy.jobs).toHaveLength(31);expect(legacy.receipts).toHaveLength(930);
  let before:number|null=30;const seen=[30];
  do {const history:any=await (await request(`/spaces/${target}/jobs/query-job-30/receipts?pageSize=10&beforeRun=${before}`)).json();seen.push(...history.receipts.map((r:any)=>r.run_number));before=history.nextBeforeRun;}while(before!==null);
  expect(seen).toEqual(Array.from({length:30},(_,i)=>30-i));
  const other:any=await (await request(`/spaces/${scope}/jobs/query-job-30/receipts`)).json();expect(other.receipts).toEqual([]);
  expect((await request('/spaces/not-a-member/jobs/query-job-30/receipts')).status).toBe(403);
  for(const path of [`/spaces/${target}/jobs?pageSize=101`,`/spaces/${target}/jobs?cursor=bad`,`/spaces/${target}/jobs/query-job-30/receipts?beforeRun=NaN`])expect((await request(path)).status).toBe(400);
  const plan=await env.DB.prepare("EXPLAIN QUERY PLAN SELECT * FROM jobs WHERE space_id=? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT 26").bind(target,7,'query-job-06').all();expect(JSON.stringify(plan.results)).toContain('jobs_scope');expect(JSON.stringify(plan.results)).not.toContain('TEMP B-TREE');
 });
 it('pauses writes or all server data before DB access while keeping logout possible',async()=>{
  const DB={prepare:vi.fn(()=>{throw new Error('D1 must not be reached');})};
  for(const [mode,path,method] of [['read-only',`/spaces/${scope}/records`,'POST'],['local-only','/bootstrap','GET']]) {
   const response=await request(path,method,{kind:'note'}, {...env,DB,PLATFORM_MODE:mode});expect(response.status).toBe(503);expect(response.headers.get('Retry-After')).toBe('60');
  }
  expect(DB.prepare).not.toHaveBeenCalled();
  expect((await request('/me','GET',undefined,{...env,PLATFORM_MODE:'read-only'})).status).toBe(200);
  const r=await request('/logout','POST',{}, {...env,PLATFORM_MODE:'local-only',API_RATE_LIMITER:{limit:async()=>({success:false})}});expect(r.status).toBe(200);
  expect((await request('/me')).status).toBe(401); // Real revocation, not a cached identity.
 });
 it('bounds hourly expiry cleanup without removing unexpired sessions or durable receipts',async()=>{
  await env.DB.prepare("INSERT INTO platform_sessions(token_hash,user_id,created_at,expires_at,auth_provider) SELECT 'expired-'||value,'scale-user',1,2,'google' FROM json_each(?)").bind(JSON.stringify(Array.from({length:80},(_,i)=>i))).run();
  await env.DB.prepare("INSERT INTO platform_sessions(token_hash,user_id,created_at,expires_at,auth_provider) VALUES('still-valid','scale-user',1,9999999999999,'google')").run();
  await maintenance(env,100);
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM platform_sessions WHERE expires_at<100').first()).n).toBe(30);
  expect(await env.DB.prepare("SELECT 1 FROM platform_sessions WHERE token_hash='still-valid'").first()).toBeTruthy();
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM space_notifications').first()).n).toBe(10000);
 });
 it('uses Workers-compatible manual redirects and marks redirected writes unknown without retrying',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:302,headers:{Location:'https://elsewhere.example'}}));
  try {await expect(jsonRequest('https://api.example.test',{method:'POST'},true)).rejects.toMatchObject({outcome:'unknown'});expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0][1]?.redirect).toBe('manual');}finally{fetch.mockRestore();}
 });
 it('does not run scheduled work or maintenance when paused',async()=>{
  const DB={prepare:vi.fn()};const paused={...env,DB,PLATFORM_MODE:'read-only'};
  expect(await runDue(paused)).toEqual({handled:0,paused:true});await maintenance(paused);expect(DB.prepare).not.toHaveBeenCalled();
 });
});
