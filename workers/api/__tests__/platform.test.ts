import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { app } from '../src/index';
import { approvedUrl, executeConnector, validatePayload } from '../src/platform/connectors';
import { seal, unseal, hash } from '../src/platform/core';
import { runDue } from '../src/platform/jobs';
let mf:Miniflare,env:any,owner:any,viewer:any,outsider:any,space:string;
async function api(path:string,who:any=owner,method='GET',body?:any){
  const response=await app.request('/api/platform'+path,{method,headers:{'Content-Type':'application/json',...(who?.token?{Authorization:`Bearer ${who.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})},env);
  return {status:response.status,body:await response.json() as any};
}
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default { fetch(){ return new Response("ok") } }',compatibilityDate:'2026-08-06',d1Databases:['DB']});
  const DB=await mf.getD1Database('DB');
  for(const file of ['0001_schema.sql','0002_platform.sql','0003_session_versions.sql','0004_atomic_allowances.sql','0005_google_identity.sql','0006_free_tier_indexes.sql']){
    const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/--[^\n]*/g,'');
    // Separate ordinary statements from complete trigger bodies.
    const triggers=[...sql.matchAll(/CREATE TRIGGER[\s\S]*?\nEND;/g)].map(m=>m[0]);
    const ordinary=sql.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g,'').split(';').filter(x=>x.trim());
    await DB.batch([...ordinary,...triggers].map(q=>DB.prepare(q)));
  }
  env={DB,JWT_SECRET:'test-only-auth-secret-012345678901234567890',TOKEN_ENCRYPTION_KEY:btoa('01234567890123456789012345678901'),OUTBOUND_HOSTS:'hooks.example.com'};
  for(const [i,email] of ['owner@example.test','viewer@example.test','other@example.test'].entries()){
    const result=await fixture(email);
    if(i===0)owner=result;else if(i===1)viewer=result;else outsider=result;
  }
  const made=await api('/spaces',owner,'POST',{name:'Test studio'});expect(made.status).toBe(201);space=made.body.id;
},30000);
afterAll(async()=>{await mf?.dispose();});
const base=()=>`/spaces/${space}`;
const draft=async(payload:any={title:'Send proposal',body:'Context from approved records'},plan:any={})=>{
  const result=await api(base()+'/jobs',owner,'POST',{action:'local.notify',payload,plan});expect(result.status).toBe(201);return result.body;
};
describe('real D1 shared workspaces',()=>{
  it('rejects anonymous and cross-workspace reads/exports/writes',async()=>{
    expect((await api(base()+'/records',null)).status).toBe(401);
    for(const route of ['/records','/jobs','/export','/connections','/inbox','/audit'])expect((await api(base()+route,outsider)).status).toBe(403);
    expect((await api(base()+'/records',outsider,'POST',{kind:'note',title:'wrong'})).status).toBe(403);
  });
  it('binds single-use invitations to email and enforces viewer permissions',async()=>{
    const invite=await api(base()+'/invites',owner,'POST',{email:viewer.user.email,role:'viewer'});expect(invite.status).toBe(201);
    expect((await api('/invites/accept',outsider,'POST',{token:invite.body.token})).status).toBe(400);
    expect((await api('/invites/accept',viewer,'POST',{token:invite.body.token})).status).toBe(200);
    expect((await api('/invites/accept',viewer,'POST',{token:invite.body.token})).status).toBe(400);
    expect((await api(base()+'/records',viewer)).status).toBe(200);
    expect((await api(base()+'/records',viewer,'POST',{kind:'note',title:'no'})).status).toBe(403);
    expect((await api(base()+'/invites',viewer,'POST',{email:'new@example.test',role:'admin'})).status).toBe(403);
  });
  it('atomically persists a record and refuses stale revisions',async()=>{
    const made=await api(base()+'/records',owner,'POST',{kind:'task',title:'Proposal',data:{body:'Original'}});expect(made.status).toBe(201);
    const route=base()+'/records/'+made.body.id;
    expect((await api(route,owner,'PUT',{revision:1,kind:'task',title:'Updated',data:{body:'New'}})).status).toBe(200);
    expect((await api(route,owner,'PUT',{revision:1,kind:'task',title:'Stale',data:{}})).status).toBe(409);
    const rows=await api(base()+'/records');expect(rows.body.records.find((r:any)=>r.id===made.body.id).title).toBe('Updated');
  });
  it('checks dependencies, cycles and inbound links before completion/deletion',async()=>{
    const a=await api(base()+'/records',owner,'POST',{kind:'task',title:'First',data:{}});
    const b=await api(base()+'/records',owner,'POST',{kind:'task',title:'Second',data:{dependencies:[a.body.id]}});
    expect((await api(base()+'/records/'+b.body.id,owner,'PUT',{revision:1,kind:'task',title:'Second',data:{status:'done',dependencies:[a.body.id]}})).status).toBe(409);
    expect((await api(base()+'/records/'+a.body.id,owner,'PUT',{revision:1,kind:'task',title:'First',data:{dependencies:[b.body.id]}})).status).toBe(409);
    expect((await api(base()+'/records/'+a.body.id,owner,'DELETE',{revision:1})).status).toBe(409);
  });
  it('refuses invalid money and unscoped assignees',async()=>{
    expect((await api(base()+'/records',owner,'POST',{kind:'expense',title:'Bad',data:{amount:1.234,currency:'INR'}})).status).toBe(400);
    expect((await api(base()+'/records',owner,'POST',{kind:'task',title:'Bad owner',data:{assignee:outsider.user.id}})).status).toBe(400);
  });
});
describe('durable approvals and scheduling',()=>{
  it('never runs a draft or accepts a stale approval hash',async()=>{
    const job=await draft();await runDue(env,space);
    expect((await api(base()+'/inbox')).body.notifications).toHaveLength(0);
    expect((await api(base()+'/jobs/'+job.id+'/approve',owner,'POST',{revision:1,planHash:'wrong',confirm:true})).status).toBe(409);
    expect((await api(base()+'/jobs/'+job.id+'/approve',viewer,'POST',{revision:1,planHash:job.planHash,confirm:true})).status).toBe(403);
  });
  it('delivers approved in-app notifications once under concurrent runners',async()=>{
    const job=await draft({title:'Exactly once locally',body:'Not a push notification'});
    expect((await api(base()+'/jobs/'+job.id+'/approve',owner,'POST',{revision:1,planHash:job.planHash,confirm:true})).status).toBe(200);
    await Promise.all([runDue(env,space),runDue(env,space)]);
    const rows=(await api(base()+'/jobs')).body;
    expect(rows.jobs.find((j:any)=>j.id===job.id).status).toBe('verified');
    expect(rows.receipts.filter((r:any)=>r.job_id===job.id)).toHaveLength(1);
    expect((await api(base()+'/inbox')).body.notifications.filter((n:any)=>n.title==='Exactly once locally')).toHaveLength(1);
  });
  it('material edits reset approval and require the new revision/hash',async()=>{
    const job=await draft();await api(base()+'/jobs/'+job.id+'/approve',owner,'POST',{revision:1,planHash:job.planHash,confirm:true});
    const changed=await api(base()+'/jobs/'+job.id,owner,'PUT',{revision:2,action:'local.notify',payload:{title:'Changed recipient context'},plan:{}});
    expect(changed.status).toBe(200);expect(changed.body.status).toBe('draft');
    expect((await api(base()+'/jobs/'+job.id+'/approve',owner,'POST',{revision:3,planHash:job.planHash,confirm:true})).status).toBe(409);
  });
  it('respects schedule, pause, resume, cancellation and bounded recurrence',async()=>{
    const first=Date.now()+600000,job=await draft({title:'Recurring'}, {firstRun:first,everyMinutes:15,maxRuns:2});
    await api(base()+'/jobs/'+job.id+'/approve',owner,'POST',{revision:1,planHash:job.planHash,confirm:true});
    await runDue(env,space);let row=(await api(base()+'/jobs')).body.jobs.find((j:any)=>j.id===job.id);expect(row.runs).toBe(0);
    await api(base()+'/jobs/'+job.id+'/control',owner,'POST',{action:'pause'});await runDue(env,space,first+1);
    row=(await api(base()+'/jobs')).body.jobs.find((j:any)=>j.id===job.id);expect(row.status).toBe('paused');expect(row.runs).toBe(0);
    await api(base()+'/jobs/'+job.id+'/control',owner,'POST',{action:'resume'});await runDue(env,space,first+1);
    row=(await api(base()+'/jobs')).body.jobs.find((j:any)=>j.id===job.id);expect(row.runs).toBe(1);expect(row.status).toBe('queued');
    await api(base()+'/jobs/'+job.id+'/control',owner,'POST',{action:'cancel'});await runDue(env,space,first+9999999);
    expect((await api(base()+'/jobs')).body.jobs.find((j:any)=>j.id===job.id).status).toBe('cancelled');
  });
  it('does not blindly replay an expired dispatched lease',async()=>{
    const job=await draft({title:'Ambiguous dispatch'});
    await env.DB.prepare("UPDATE jobs SET status='running',lease_id='crashed',lease_until=? WHERE id=?").bind(Date.now()-1,job.id).run();await runDue(env,space);
    const row=(await api(base()+'/jobs')).body.jobs.find((j:any)=>j.id===job.id);expect(row.status).toBe('unknown');
    expect((await api(base()+'/jobs/'+job.id+'/control',owner,'POST',{action:'resume'})).status).toBe(409);
  });
});
describe('connector security boundaries',()=>{
  it('encrypts credentials with workspace/connection authenticated context',async()=>{
    const cipher=await seal(env,'space:connection',{token:'private-test-value'});expect(cipher).not.toContain('private-test-value');
    expect(await unseal(env,'space:connection',cipher)).toEqual({token:'private-test-value'});
    await expect(unseal(env,'other-space:connection',cipher)).rejects.toThrow();
  });
  it.each(['http://hooks.example.com/x','https://127.0.0.1/x','https://localhost/x','https://evil.example.com/x','https://user:pass@hooks.example.com/x','https://hooks.example.com/x?token=secret'])('refuses unsafe/unapproved outbound endpoint %s',url=>{expect(()=>approvedUrl(url,env)).toThrow();});
  it('stores webhooks without sending a side-effecting probe; exports omit credentials',async()=>{
    const spy=vi.spyOn(globalThis,'fetch');const created=await api(base()+'/connections',owner,'POST',{provider:'webhook',name:'Approved endpoint',credentials:{url:'https://hooks.example.com/task',token:'private-test-secret'}});
    expect(created.status).toBe(201);expect(spy).not.toHaveBeenCalled();spy.mockRestore();
    const listed=await api(base()+'/connections');expect(JSON.stringify(listed.body)).not.toContain('private-test-secret');
    const exported=await api(base()+'/export');expect(JSON.stringify(exported.body)).not.toContain('private-test-secret');
    const job=await api(base()+'/jobs',owner,'POST',{connectionId:created.body.id,action:'webhook.post',payload:{body:{hello:'world'}},plan:{}});
    await api(base()+'/jobs/'+job.body.id+'/approve',owner,'POST',{revision:1,planHash:job.body.planHash,confirm:true});
    await api(base()+'/connections/'+created.body.id,owner,'DELETE');
    expect((await api(base()+'/jobs')).body.jobs.find((j:any)=>j.id===job.body.id).status).toBe('cancelled');
    const dbRow=await env.DB.prepare('SELECT secret FROM connections WHERE id=?').bind(created.body.id).first();expect(dbRow.secret).toBe('');
  });
  it('blocks email header injection and formula interpretation by payload validation',()=>{
    expect(()=>validatePayload('gmail.send',{to:'a@example.test',subject:'Hello\r\nBcc: stolen@example.test',body:'x'})).toThrow();
    expect(validatePayload('sheets.append',{spreadsheetId:'x',range:'A1',rows:[['=1+1']]}).rows).toEqual([['=1+1']]);
  });
  it('revokes sessions server-side',async()=>{
    const row=await env.DB.prepare('SELECT token_hash FROM platform_sessions WHERE user_id=?').bind(outsider.user.id).first();expect(row.token_hash).toBe(await hash(outsider.token));
    expect((await api('/logout-all',outsider,'POST',{})).status).toBe(200);expect((await api('/me',outsider)).status).toBe(401);
  });
});
describe('platform hardening and reviewed imports',()=>{
 it('disables password signup and login even with configured secrets',async()=>{
  expect((await api('/register',null,'POST',{email:'test@example.test',password:'any-password'})).status).toBe(410);
  expect((await api('/login',null,'POST',{email:owner.user.email,password:'any-password'})).status).toBe(410);
 });
 it('rejects a session whose Google identity was removed',async()=>{
  const fresh=await fixture('revoked-identity@example.test');expect((await api('/me',fresh)).status).toBe(200);
  await env.DB.prepare('DELETE FROM google_identities WHERE user_id=?').bind(fresh.user.id).run();expect((await api('/me',fresh)).status).toBe(401);
 });
 it('remaps imported relationships, deduplicates retries and rejects changed payloads',async()=>{
  const body={importId:'test-reviewed-import',records:[{id:'person',kind:'person',title:'Imported person',data:{}},{id:'task',kind:'task',title:'Imported task',data:{links:['person']}}]};
  const first=await api(base()+'/import',owner,'POST',body);expect(first.status).toBe(201);
  const second=await api(base()+'/import',owner,'POST',body);expect(second.status).toBe(200);expect(second.body.ids).toEqual(first.body.ids);
  const rows=(await api(base()+'/records')).body.records;expect(rows.find((r:any)=>r.id===first.body.ids[1]).data.links).toEqual([first.body.ids[0]]);
  body.records[0].title='Changed';expect((await api(base()+'/import',owner,'POST',body)).status).toBe(409);
 });
 it('rolls back cyclic imports and rejects dangling references without partial inserts',async()=>{
  const before=(await api(base()+'/records')).body.records.length;
  const records=[{id:'a',kind:'task',title:'cycle A',data:{dependencies:['b']}},{id:'b',kind:'task',title:'cycle B',data:{dependencies:['a']}}];
  expect((await api(base()+'/import',owner,'POST',{importId:'cyclic-import',records})).status).toBe(409);
  expect((await api(base()+'/records')).body.records).toHaveLength(before);
  records[0].data.dependencies=['not-in-file'];expect((await api(base()+'/import',owner,'POST',{importId:'dangling-import',records})).status).toBe(400);
  expect((await api(base()+'/records')).body.records).toHaveLength(before);
 });
 it('deduplicates explicitly identified job drafts and rejects key reuse with new content',async()=>{
  const body={requestId:'draft-once',action:'local.notify',payload:{title:'Shared voice draft'},plan:{firstRun:Date.now()+300000}};
  const a=await api(base()+'/jobs',owner,'POST',body),b=await api(base()+'/jobs',owner,'POST',body);expect(a.status).toBe(201);expect(b.body.id).toBe(a.body.id);
  body.payload.title='Changed';expect((await api(base()+'/jobs',owner,'POST',body)).status).toBe(409);
 });
 it('persists exactly one unknown receipt when concurrent recovery finds an expired lease',async()=>{
  const job=await draft();await env.DB.prepare("UPDATE jobs SET status='running',lease_id='expired-test',lease_until=? WHERE id=?").bind(Date.now()-1,job.id).run();
  await Promise.all([runDue(env,space),runDue(env,space)]);
  const receipts=(await api(base()+'/jobs')).body.receipts.filter((r:any)=>r.job_id===job.id);expect(receipts).toHaveLength(1);expect(receipts[0].status).toBe('unknown');
  const audit=(await api(base()+'/audit')).body.audit;expect(audit.filter((a:any)=>a.subject_id===job.id&&a.operation==='job.lease-expired')).toHaveLength(1);
 });
 it('does not exceed the daily external allowance under concurrent runners and accepts plaintext webhook acknowledgments',async()=>{
  const created=await api(base()+'/connections',owner,'POST',{provider:'webhook',name:'Quota test',credentials:{url:'https://hooks.example.com/quota',token:'test-secret-only'}});expect(created.status).toBe(201);
  const ids=[];for(let i=0;i<2;i++){const j=await api(base()+'/jobs',owner,'POST',{connectionId:created.body.id,action:'webhook.post',payload:{body:{i}},plan:{}});ids.push(j.body.id);expect((await api(base()+'/jobs/'+j.body.id+'/approve',owner,'POST',{revision:1,planHash:j.body.planHash,confirm:true})).status).toBe(200);}
  await env.DB.prepare('INSERT INTO platform_rate_limits (key,count,expires_at) VALUES (?,99,?)').bind(`executions:${space}:${new Date().toISOString().slice(0,10)}`,Date.now()+86400000).run();
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('OK',{status:200}));
  try{await Promise.all([runDue(env,space),runDue(env,space)]);expect(fetch).toHaveBeenCalledTimes(1);}finally{fetch.mockRestore();}
  const jobs=(await api(base()+'/jobs')).body.jobs.filter((j:any)=>ids.includes(j.id));expect(jobs.map((j:any)=>j.status).sort()).toEqual(['accepted','failed']);
 });
});

it('enforces workspace caps atomically even when concurrent requests both pass the precheck',async()=>{
 const current=await env.DB.prepare('SELECT COUNT(*) AS n FROM spaces WHERE owner_id=?').bind(owner.user.id).first();
 await env.DB.batch(Array.from({length:19-current.n},(_,i)=>env.DB.prepare('INSERT INTO spaces (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind('cap-test-'+i,'Allowance fixture',owner.user.id,Date.now())));
 const results=await Promise.all([api('/spaces',owner,'POST',{name:'Last available workspace'}),api('/spaces',owner,'POST',{name:'Concurrent extra workspace'})]);expect(results.map(r=>r.status).sort()).toEqual([201,429]);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM spaces WHERE owner_id=?').bind(owner.user.id).first()).n).toBe(20);
});

async function fixture(email:string){
 const user={id:crypto.randomUUID(),email},token=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,'');
 await env.DB.batch([
  env.DB.prepare('INSERT INTO users (id,email,created_at) VALUES (?,?,?)').bind(user.id,email,Date.now()),
  env.DB.prepare('INSERT INTO google_identities (subject,user_id,verified_email,created_at) VALUES (?,?,?,?)').bind('fixture-'+user.id,user.id,email,Date.now()),
  env.DB.prepare("INSERT INTO platform_sessions (token_hash,user_id,created_at,expires_at,auth_provider) VALUES (?,?,?,?,'google')").bind(await hash(token),user.id,Date.now(),Date.now()+7*86400000),
 ]);return {user,token};
}
