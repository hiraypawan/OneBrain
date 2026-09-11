import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { startGoogleLogin, finishGoogleLogin, googleConfigured, sessionUser } from './google-auth';
import { actor, audit, fail, hash, id, membership, number, object, publicConnection, randomToken, rateLimit, seal, text, unseal, type PlatformContext } from './core';
import { jsonRequest, PROVIDERS, validateConnection, type Provider } from './connectors';
import { prepareJob, runDue } from './jobs';
import { RECORD_KINDS, validateRecord } from './records';
export const platform = new Hono<PlatformContext>();
platform.onError((error,c) => {
  if(/exceeded D1|D1.*(?:overloaded|too many requests|exceeded|quota)/i.test(error.message)) { c.header('Retry-After','60'); return c.json({error:'Server capacity is temporarily unavailable. Device-local capture still works; no server save is claimed.'},503); }
  if(error instanceof HTTPException) return c.json({error:error.message},error.status);
  if(/(?:Workspace|Record|Connection|Job) allowance reached/.test(error.message))return c.json({error:'Workspace allowance reached. Nothing extra was saved; no paid overflow was enabled.'},429);
  if(error instanceof SyntaxError)return c.json({error:'Invalid JSON request.'},400);
  if(/UNIQUE constraint failed: space_imports/.test(error.message))return c.json({error:'The same request is being committed. Refresh or retry with the unchanged request ID.'},409);
  if(/Invalid scoped relationship|Circular dependency|dependent links/.test(error.message))return c.json({error:'A related record changed concurrently. Reload and review dependencies.'},409);
  console.error('Platform operation failed:',error.name);
  return c.json({error:'Server operation failed. No success is claimed.'},500);
});
platform.use('*',bodyLimit({maxSize:750000,onError:c=>c.json({error:'Request exceeds 750 KB.'},413)}));
platform.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next();});
platform.get('/capabilities',c=>c.json({service:'OneBrain platform',configured:googleConfigured(c.env),authMode:'google-only',encryptedConnections:!!c.env.TOKEN_ENCRYPTION_KEY,googleOAuth:!!(c.env.GOOGLE_CLIENT_ID&&c.env.GOOGLE_CLIENT_SECRET&&c.env.GOOGLE_CONNECT_REDIRECT),providers:PROVIDERS,recordKinds:RECORD_KINDS,limits:{records:2000,connections:20,jobs:500,executionsPerDay:100},mode:c.env.PLATFORM_MODE||'normal',requestLimiter:c.env.API_RATE_LIMITER?'native':'d1-fallback',scheduler:{cadenceMinutes:5,batchSize:Number(c.env.SCHEDULED_JOB_BATCH_SIZE)||2},billing:'No paid overflow or payment collection enabled'}));
platform.post('/register',c=>c.json({error:'Password signup is disabled. Use Google sign-in.'},410));
platform.post('/login',c=>c.json({error:'Password login is disabled. Use Google sign-in.'},410));
platform.post('/auth/google/start',async c=>{await rateLimit(c,'google-start',20);return c.json(await startGoogleLogin(c.env));});
platform.post('/auth/google/finish',async c=>{await rateLimit(c,'google-finish',20);return c.json(await finishGoogleLogin(c.env,await c.req.json()));});
platform.use('*',async(c,next)=>{
 const token=c.req.header('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!token)fail(401,'Sign in with Google to access server workspaces.');
 c.set('session',await hash(token!));
 const revocation=['/api/platform/logout','/api/platform/logout-all'].includes(c.req.path);
 if(!revocation&&c.env.API_RATE_LIMITER)await rateLimit(c,'platform',240);
 const user=await sessionUser(c.env,token!);if(!user)fail(401,'Session expired or revoked. Sign in with Google again.');
 c.set('actor',user!);if(!revocation&&!c.env.API_RATE_LIMITER)await rateLimit(c,'platform',240);await next();
});
platform.get('/me',c=>c.json({user:actor(c)}));
platform.post('/logout',async c=>{await c.env.DB.prepare('DELETE FROM platform_sessions WHERE token_hash=?').bind(c.get('session')).run();return c.json({ok:true});});
platform.post('/logout-all',async c=>{await c.env.DB.prepare('DELETE FROM platform_sessions WHERE user_id=?').bind(actor(c).id).run();return c.json({ok:true});});
platform.get('/spaces',async c=>c.json({spaces:(await c.env.DB.prepare('SELECT s.id,s.name,s.created_at,m.role FROM spaces s JOIN space_members m ON m.space_id=s.id WHERE m.user_id=? ORDER BY s.created_at').bind(actor(c).id).all()).results}));
// One authenticated request instead of separate identity and workspace-list calls.
platform.get('/bootstrap',async c=>c.json({user:actor(c),spaces:(await c.env.DB.prepare('SELECT s.id,s.name,s.created_at,m.role FROM space_members m JOIN spaces s ON s.id=m.space_id WHERE m.user_id=? ORDER BY s.created_at').bind(actor(c).id).all()).results}));
platform.post('/spaces',async c=>{
  const name=text(object(await c.req.json()).name,'Workspace name',100),space=id(),now=Date.now();
  const n=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM spaces WHERE owner_id=?').bind(actor(c).id).first<{n:number}>();if((n?.n||0)>=20)fail(429,'20-workspace limit reached.');
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO spaces (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind(space,name,actor(c).id,now),c.env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,joined_at) VALUES (?,?,?,?)').bind(space,actor(c).id,'owner',now),audit(c.env,space,actor(c).id,'workspace.created',space,{name})]);
  return c.json({id:space,name,role:'owner'},201);
});
platform.delete('/spaces/:space',async c=>{
  const space=c.req.param('space');await membership(c,space,'owner');
  if(object(await c.req.json()).confirm!==space)fail(400,'Confirm the workspace ID to delete it.');
  if(await c.env.DB.prepare("SELECT id FROM jobs WHERE space_id=? AND status='running'").bind(space).first())fail(409,'A dispatched job is running. Wait for its result before deleting.');
  await c.env.DB.prepare('DELETE FROM spaces WHERE id=? AND owner_id=?').bind(space,actor(c).id).run();
  return c.json({ok:true,notice:'Workspace data, credentials and jobs deleted. External destinations were not changed.'});
});
platform.get('/spaces/:space/members',async c=>{
  const space=c.req.param('space');await membership(c,space);return c.json({members:(await c.env.DB.prepare('SELECT m.user_id,m.role,u.email,u.display_name FROM space_members m JOIN users u ON u.id=m.user_id WHERE m.space_id=?').bind(space).all()).results});
});
platform.post('/spaces/:space/invites',async c=>{
  const space=c.req.param('space'),role=await membership(c,space,'admin'),b=object(await c.req.json()),email=text(b.email,'Invite email',254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Use a valid email.');
  if(!['admin','editor','viewer'].includes(b.role)||(b.role==='admin'&&role!=='owner'))fail(403,'Only the owner can invite another admin.');
  const token=randomToken(),expires=Date.now()+7*86400000;
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO space_invites (token_hash,space_id,email,role,expires_at,created_by) VALUES (?,?,?,?,?,?)').bind(await hash(token),space,email,b.role,expires,actor(c).id),audit(c.env,space,actor(c).id,'invite.created',email,{role:b.role})]);
  return c.json({token,expiresAt:expires,delivery:'Copy and share this single-use invite. No email was sent.'},201);
});
platform.post('/invites/accept',async c=>{
  const digest=await hash(text(object(await c.req.json()).token,'Invitation token',64));
  const invite=await c.env.DB.prepare('SELECT * FROM space_invites WHERE token_hash=? AND email=? AND accepted_by IS NULL AND expires_at>?').bind(digest,actor(c).email,Date.now()).first<any>();
  if(!invite)fail(400,'Invitation is invalid, expired, used or belongs to another email.');
  const result=await c.env.DB.batch([c.env.DB.prepare('INSERT INTO space_members (space_id,user_id,role,joined_at) SELECT space_id,?,role,? FROM space_invites WHERE token_hash=? AND accepted_by IS NULL AND expires_at>? ON CONFLICT(space_id,user_id) DO NOTHING').bind(actor(c).id,Date.now(),digest,Date.now()),c.env.DB.prepare('UPDATE space_invites SET accepted_by=? WHERE token_hash=? AND accepted_by IS NULL').bind(actor(c).id,digest),audit(c.env,invite.space_id,actor(c).id,'invite.accepted',actor(c).id,{role:invite.role})]);
  return c.json({spaceId:invite.space_id,joined:result[0].meta.changes===1});
});
platform.put('/spaces/:space/members/:user',async c=>{
  const space=c.req.param('space'),user=c.req.param('user');await membership(c,space,'owner');const b=object(await c.req.json());
  if(!['admin','editor','viewer','remove'].includes(b.role))fail(400,'Choose a valid role.');if(user===actor(c).id)fail(400,'Owner cannot remove or demote themselves.');
  await c.env.DB.batch([b.role==='remove'?c.env.DB.prepare("DELETE FROM space_members WHERE space_id=? AND user_id=? AND role!='owner'").bind(space,user):c.env.DB.prepare("UPDATE space_members SET role=? WHERE space_id=? AND user_id=? AND role!='owner'").bind(b.role,space,user),c.env.DB.prepare('DELETE FROM space_invites WHERE space_id=? AND created_by=?').bind(space,user),c.env.DB.prepare("UPDATE jobs SET status='draft',approved_hash=NULL,approved_by=NULL,revision=revision+1,updated_at=? WHERE space_id=? AND approved_by=? AND status IN ('queued','paused')").bind(Date.now(),space,user),audit(c.env,space,actor(c).id,'membership.changed',user,{role:b.role})]);return c.json({ok:true});
});
platform.get('/spaces/:space/records',async c=>{
  const space=c.req.param('space');await membership(c,space);
  // Existing export/editor clients explicitly retain the bounded full catalog.
  // Browsing opts into keyset pages (no deep OFFSET scans or COUNT(*) request).
  const paged=c.req.query('pageSize')!==undefined, size=paged?Number(c.req.query('pageSize')):2000;
  if (!Number.isInteger(size)||size<1||size>(paged?100:2000))fail(400,'Page size must be 1–100.');
  let cursor: [number,string] | null=null;
  if(c.req.query('cursor')) {
    try {const raw=c.req.query('cursor')!;if(raw.length>300)throw new Error();const v=JSON.parse(atob(raw));if(!Array.isArray(v)||v.length!==2||!Number.isSafeInteger(v[0])||v[0]<0||typeof v[1]!=='string'||v[1].length>100)throw new Error();cursor=v as [number,string];}
    catch {fail(400,'Invalid record cursor.');}
  }
  const rows=await c.env.DB.prepare('SELECT * FROM space_records WHERE space_id=?'+(cursor?' AND (updated_at,id)<(?,?)':'')+' ORDER BY updated_at DESC,id DESC LIMIT ?').bind(space,...(cursor||[]),size+(paged?1:0)).all<any>();
  const more=paged&&rows.results.length>size, records=rows.results.slice(0,size),last=records.at(-1);
  return c.json({records:records.map(r=>({...r,data:JSON.parse(r.data)})),nextCursor:more?btoa(JSON.stringify([last.updated_at,last.id])):null});
});
platform.post('/spaces/:space/records',async c=>{
  const space=c.req.param('space');await membership(c,space,'write');const r=await validateRecord(c.env,space,await c.req.json()),rid=id(),now=Date.now();
  const n=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM space_records WHERE space_id=?').bind(space).first<{n:number}>();if((n?.n||0)>=2000)fail(429,'Workspace record allowance reached.');
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO space_records (id,space_id,kind,title,data,created_by,created_at,updated_at,mutation_id) VALUES (?,?,?,?,?,?,?,?,?)').bind(rid,space,r.kind,r.title,JSON.stringify({...r.data,links:[],dependencies:[]}),actor(c).id,now,now,id()),...((r.data.links.length||r.data.dependencies.length)?[c.env.DB.prepare('UPDATE space_records SET data=? WHERE id=?').bind(JSON.stringify(r.data),rid)]:[]),audit(c.env,space,actor(c).id,'record.created',rid,{kind:r.kind,title:r.title})]);return c.json({id:rid,revision:1},201);
});
platform.put('/spaces/:space/records/:record',async c=>{
  const space=c.req.param('space'),rid=c.req.param('record');await membership(c,space,'write');const b=object(await c.req.json()),revision=number(b.revision,'Revision',1,1e9),r=await validateRecord(c.env,space,b,rid),mutation=id(),now=Date.now();
  const result=await c.env.DB.batch([c.env.DB.prepare('UPDATE space_records SET kind=?,title=?,data=?,revision=revision+1,updated_at=?,mutation_id=? WHERE id=? AND space_id=? AND revision=?').bind(r.kind,r.title,JSON.stringify(r.data),now,mutation,rid,space,revision),c.env.DB.prepare('INSERT INTO space_audit (id,space_id,actor_id,operation,subject_id,at,detail) SELECT ?,space_id,?,?,id,?,? FROM space_records WHERE id=? AND mutation_id=?').bind(id(),actor(c).id,'record.updated',now,JSON.stringify({revision:revision+1,title:r.title}),rid,mutation)]);
  if(result[0].meta.changes!==1)fail(409,'Record changed or was removed. Reload before editing.');return c.json({id:rid,revision:revision+1});
});
platform.delete('/spaces/:space/records/:record',async c=>{
  const space=c.req.param('space'),rid=c.req.param('record');await membership(c,space,'write');const b=object(await c.req.json());number(b.revision,'Revision',1,1e9);
  const linked=await c.env.DB.prepare("SELECT r.id FROM space_records r,json_each(r.data,'$.links') l WHERE r.space_id=? AND l.value=? UNION SELECT r.id FROM space_records r,json_each(r.data,'$.dependencies') d WHERE r.space_id=? AND d.value=?").bind(space,rid,space,rid).first();if(linked)fail(409,'Unlink this record from relationships and dependencies before deleting.');
  const result=await c.env.DB.batch([audit(c.env,space,actor(c).id,'record.delete-requested',rid,{revision:b.revision}),c.env.DB.prepare('DELETE FROM space_records WHERE id=? AND space_id=? AND revision=?').bind(rid,space,b.revision)]);if(result[1].meta.changes!==1)fail(409,'Record changed. Reload before deleting.');return c.json({ok:true});
});
platform.get('/spaces/:space/export',async c=>{
  const space=c.req.param('space');await membership(c,space);const records=await c.env.DB.prepare('SELECT id,kind,title,data,revision,created_at,updated_at FROM space_records WHERE space_id=?').bind(space).all<any>();
  const jobs=await c.env.DB.prepare('SELECT id,action,payload,plan,status,created_at FROM jobs WHERE space_id=?').bind(space).all();const receipts=await c.env.DB.prepare('SELECT * FROM job_receipts WHERE space_id=?').bind(space).all();
  return c.json({version:2,spaceId:space,exportedAt:new Date().toISOString(),records:records.results.map(r=>({...r,data:JSON.parse(r.data)})),jobs:jobs.results,receipts:receipts.results});
});
platform.get('/spaces/:space/connections',async c=>{const space=c.req.param('space');await membership(c,space);return c.json({connections:(await c.env.DB.prepare('SELECT * FROM connections WHERE space_id=? ORDER BY created_at DESC').bind(space).all()).results.map(publicConnection)});});
platform.post('/spaces/:space/connections',async c=>{
  const space=c.req.param('space');await membership(c,space,'admin');const b=object(await c.req.json()),provider=text(b.provider,'Provider') as Provider,name=text(b.name,'Connection name',100);
  const n=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM connections WHERE space_id=?').bind(space).first<{n:number}>();if((n?.n||0)>=20)fail(429,'Connection allowance reached.');
  const clean=await validateConnection(c.env,provider,b.config,b.credentials),connection=id(),now=Date.now();
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO connections (id,space_id,provider,name,config,secret,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(connection,space,provider,name,JSON.stringify(clean.config),await seal(c.env,`${space}:${connection}`,clean.secret),'connected',actor(c).id,now,now),audit(c.env,space,actor(c).id,'connection.created',connection,{provider})]);return c.json({id:connection,status:'connected',verification:clean.config.verification},201);
});
platform.delete('/spaces/:space/connections/:connection',async c=>{
  const space=c.req.param('space'),connection=c.req.param('connection');await membership(c,space,'admin');
  await c.env.DB.batch([c.env.DB.prepare("UPDATE connections SET status='revoked',secret='',updated_at=? WHERE id=? AND space_id=?").bind(Date.now(),connection,space),c.env.DB.prepare("UPDATE jobs SET status='cancelled',last_error='Connection revoked',updated_at=? WHERE connection_id=? AND space_id=? AND status IN ('queued','paused','draft')").bind(Date.now(),connection,space),audit(c.env,space,actor(c).id,'connection.revoked',connection)]);
  return c.json({ok:true,notice:'Stored credentials erased; queued jobs cancelled. Dispatched requests cannot be recalled. Revoke provider-side access separately if needed.'});
});
platform.post('/spaces/:space/oauth/google',async c=>{
  const space=c.req.param('space');await membership(c,space,'admin');if(!c.env.GOOGLE_CLIENT_ID||!c.env.GOOGLE_CLIENT_SECRET||!c.env.GOOGLE_CONNECT_REDIRECT)fail(503,'Operator must configure Google OAuth and an exact callback URL.');
  const provider=text(object(await c.req.json()).provider,'Provider') as Provider;if(!['google-calendar','google-sheets','gmail'].includes(provider))fail(400,'Choose a Google provider.');
  const state=randomToken(),verifier=randomToken(),digest=await hash(state);const sha=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));const challenge=btoa(String.fromCharCode(...new Uint8Array(sha))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  await c.env.DB.prepare('INSERT INTO oauth_states (state_hash,space_id,user_id,provider,verifier,expires_at) VALUES (?,?,?,?,?,?)').bind(digest,space,actor(c).id,provider,await seal(c.env,`oauth:${digest}`,{verifier}),Date.now()+600000).run();
  return c.json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:c.env.GOOGLE_CLIENT_ID!,redirect_uri:c.env.GOOGLE_CONNECT_REDIRECT!,response_type:'code',scope:(PROVIDERS[provider] as any).scopes,state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent'})});
});
platform.get('/oauth/google/callback',async c=>{
  const digest=await hash(text(c.req.query('state'),'OAuth state',64)),row=await c.env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND user_id=? AND expires_at>? RETURNING *').bind(digest,actor(c).id,Date.now()).first<any>();if(!row)fail(400,'OAuth state expired or was used. Start again.');
  await membership(c,row.space_id,'admin');const {verifier}=await unseal(c.env,`oauth:${digest}`,row.verifier);
  const token=await jsonRequest('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:text(c.req.query('code'),'Authorization code',2000),client_id:c.env.GOOGLE_CLIENT_ID||'',client_secret:c.env.GOOGLE_CLIENT_SECRET||'',redirect_uri:c.env.GOOGLE_CONNECT_REDIRECT||'',code_verifier:verifier,grant_type:'authorization_code'})});if(!token.access_token)fail(400,'Google did not grant this connection.');
  const connection=id(),now=Date.now(),secret=await seal(c.env,`${row.space_id}:${connection}`,{token:token.access_token,refreshToken:token.refresh_token,expiresAt:now+Number(token.expires_in||3600)*1000});
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO connections (id,space_id,provider,name,config,secret,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(connection,row.space_id,row.provider,PROVIDERS[row.provider as Provider].label,JSON.stringify({verification:'OAuth consent granted',scopes:token.scope}),secret,'connected',actor(c).id,now,now),audit(c.env,row.space_id,actor(c).id,'connection.oauth',connection,{provider:row.provider})]);return c.json({ok:true,connectionId:connection,notice:'Connection authorized. Return to Operations to review actions.'});
});
platform.get('/spaces/:space/jobs',async c=>{
  const space=c.req.param('space');await membership(c,space);const rows=await c.env.DB.prepare('SELECT * FROM jobs WHERE space_id=? ORDER BY created_at DESC LIMIT 500').bind(space).all<any>(),receipts=await c.env.DB.prepare('SELECT * FROM job_receipts WHERE space_id=? ORDER BY at DESC LIMIT 1000').bind(space).all<any>();return c.json({jobs:rows.results.map(r=>({...r,payload:JSON.parse(r.payload),plan:JSON.parse(r.plan)})),receipts:receipts.results.map(r=>({...r,evidence:JSON.parse(r.evidence)}))});
});
platform.post('/spaces/:space/jobs',async c=>{
  const space=c.req.param('space');await membership(c,space,'write');const raw=object(await c.req.json()),requestKey=raw.requestId?'job:'+text(raw.requestId,'Request ID',64):null,fingerprint=await hash(JSON.stringify(raw));
  if(requestKey){const previous=await c.env.DB.prepare('SELECT fingerprint,result FROM space_imports WHERE space_id=? AND id=?').bind(space,requestKey).first<{fingerprint:string;result:string}>();if(previous){if(previous.fingerprint!==fingerprint)fail(409,'Request ID already belongs to another draft.');return c.json(JSON.parse(previous.result));}}
  const p=await prepareJob(c.env,space,raw),job=id(),now=Date.now();const n=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM jobs WHERE space_id=?').bind(space).first<{n:number}>();if((n?.n||0)>=500)fail(429,'500-job workspace allowance reached.');
  const result={id:job,revision:1,status:'draft',planHash:p.planHash};
  await c.env.DB.batch([...(requestKey?[c.env.DB.prepare('INSERT INTO space_imports (id,space_id,fingerprint,result,created_at) VALUES (?,?,?,?,?)').bind(requestKey,space,fingerprint,JSON.stringify(result),now)]:[]),c.env.DB.prepare('INSERT INTO jobs (id,space_id,connection_id,action,payload,plan,plan_hash,status,next_run,created_by,created_at,updated_at,mutation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(job,space,p.connectionId,p.action,JSON.stringify(p.payload),JSON.stringify(p.plan),p.planHash,'draft',p.plan.firstRun,actor(c).id,now,now,id()),audit(c.env,space,actor(c).id,'job.drafted',job,{hash:p.planHash,action:p.action})]);return c.json(result,201);
});
async function jobMutation(c:any,space:string,job:string,mutation:string,statement:D1PreparedStatement,operation:string,detail:unknown){
 const results=await c.env.DB.batch([statement,c.env.DB.prepare('INSERT INTO space_audit (id,space_id,actor_id,operation,subject_id,at,detail) SELECT ?,space_id,?,?,id,?,? FROM jobs WHERE id=? AND space_id=? AND mutation_id=?').bind(id(),actor(c).id,operation,Date.now(),JSON.stringify(detail),job,space,mutation)]);
 if(results[0].meta.changes!==1)fail(409,'Job changed, is already dispatched, or is not in a controllable state. Refresh and review it again.');
}
platform.put('/spaces/:space/jobs/:job',async c=>{
 const space=c.req.param('space'),job=c.req.param('job');await membership(c,space,'write');const b=object(await c.req.json()),p=await prepareJob(c.env,space,b),mutation=id();number(b.revision,'Revision',1,1e9);
 await jobMutation(c,space,job,mutation,c.env.DB.prepare("UPDATE jobs SET connection_id=?,action=?,payload=?,plan=?,plan_hash=?,approved_hash=NULL,approved_by=NULL,status='draft',next_run=?,revision=revision+1,updated_at=?,mutation_id=? WHERE id=? AND space_id=? AND revision=? AND runs=0 AND status IN ('draft','queued','paused')").bind(p.connectionId,p.action,JSON.stringify(p.payload),JSON.stringify(p.plan),p.planHash,p.plan.firstRun,Date.now(),mutation,job,space,b.revision),'job.changed-reapproval-required',{hash:p.planHash});
 return c.json({revision:b.revision+1,status:'draft',planHash:p.planHash});
});
platform.post('/spaces/:space/jobs/:job/approve',async c=>{
 const space=c.req.param('space'),job=c.req.param('job');await membership(c,space,'admin');const b=object(await c.req.json()),mutation=id();number(b.revision,'Revision',1,1e9);const planHash=text(b.planHash,'Reviewed plan hash',64);if(b.confirm!==true)fail(400,'Confirm the reviewed action and schedule.');
 await jobMutation(c,space,job,mutation,c.env.DB.prepare("UPDATE jobs SET approved_hash=plan_hash,approved_by=?,status='queued',revision=revision+1,updated_at=?,mutation_id=? WHERE id=? AND space_id=? AND revision=? AND plan_hash=? AND status='draft'").bind(actor(c).id,Date.now(),mutation,job,space,b.revision,planHash),'job.approved',{hash:planHash});
 return c.json({status:'queued',notice:'Approved and queued; not yet executed.'});
});
platform.post('/spaces/:space/jobs/:job/control',async c=>{
 const space=c.req.param('space'),job=c.req.param('job');await membership(c,space,'admin');const action=object(await c.req.json()).action,mutation=id();if(!['pause','resume','cancel'].includes(action))fail(400,'Choose pause, resume or cancel.');const from=action==='resume'?['paused']:action==='pause'?['queued']:['draft','queued','paused'];
 await jobMutation(c,space,job,mutation,c.env.DB.prepare(`UPDATE jobs SET status=?,revision=revision+1,updated_at=?,mutation_id=? WHERE id=? AND space_id=? AND status IN (${from.map(()=>'?').join(',')})`).bind(action==='resume'?'queued':action==='pause'?'paused':'cancelled',Date.now(),mutation,job,space,...from),`job.${action}`,{});return c.json({ok:true});
});
platform.post('/spaces/:space/run-due',async c=>{const space=c.req.param('space');await membership(c,space,'admin');return c.json(await runDue(c.env,space,Date.now(),Math.max(1,Math.min(20,Number(c.env.SCHEDULED_JOB_BATCH_SIZE)||2))));});
platform.get('/spaces/:space/inbox',async c=>{const space=c.req.param('space');await membership(c,space);return c.json({notifications:(await c.env.DB.prepare('SELECT * FROM space_notifications WHERE space_id=? ORDER BY created_at DESC LIMIT 100').bind(space).all()).results});});
platform.get('/spaces/:space/audit',async c=>{const space=c.req.param('space');await membership(c,space,'admin');return c.json({audit:(await c.env.DB.prepare('SELECT * FROM space_audit WHERE space_id=? ORDER BY at DESC LIMIT 300').bind(space).all()).results});});
platform.post('/spaces/:space/import',async c=>{
 const space=c.req.param('space');await membership(c,space,'write');const b=object(await c.req.json()),importId=text(b.importId,'Import ID',64),source=b.records||b.items;
 if(!Array.isArray(source)||!source.length||source.length>100)fail(400,'Import 1–100 records per reviewed file. Nothing was imported.');
 const fingerprint=await hash(JSON.stringify(source));
 const previous=await c.env.DB.prepare('SELECT fingerprint,result FROM space_imports WHERE space_id=? AND id=?').bind(space,importId).first<{fingerprint:string;result:string}>();
 if(previous){if(previous.fingerprint!==fingerprint)fail(409,'This import ID belongs to a different file.');return c.json(JSON.parse(previous.result));}
 const count=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM space_records WHERE space_id=?').bind(space).first<{n:number}>();if((count?.n||0)+source.length>2000)fail(429,'Import exceeds the workspace record allowance.');
 const mapping=new Map<string,string>();for(const row of source){text(row.id,'Source record ID',200);if(mapping.has(row.id))fail(400,'Duplicate source record IDs.');mapping.set(row.id,id());}
 const memberIds=new Set((await c.env.DB.prepare('SELECT user_id FROM space_members WHERE space_id=?').bind(space).all<{user_id:string}>()).results.map(r=>r.user_id));
 const prepared=[];for(const row of source){
  const sourceData=row.data||Object.fromEntries(['body','status','due','links','amount','currency'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
  const r=await validateRecord(c.env,space,{kind:row.kind,title:row.title,data:{...sourceData,links:[],dependencies:[]}},undefined,memberIds);
  for(const field of ['links','dependencies']){
   if(sourceData[field]!==undefined&&(!Array.isArray(sourceData[field])||sourceData[field].length>50))fail(400,'Invalid imported relationships.');
   r.data[field]=(sourceData[field]||[]).map((old:string)=>{const replacement=mapping.get(old);if(!replacement)fail(400,'Imported relationships must reference records included in this file.');return replacement;});
  }
  prepared.push({id:mapping.get(row.id)!,...r});
 }
 const result={imported:prepared.length,ids:prepared.map(r=>r.id),notice:'Records imported atomically; credentials and executable jobs were not imported.'},now=Date.now();
 const byId=new Map(prepared.map(r=>[r.id,r]));
 for(const r of prepared)if(r.data.status==='done'&&r.data.dependencies.some((dep:string)=>byId.get(dep)?.data.status!=='done'))fail(409,'Complete imported dependencies before marking a task done.');
 // Four transactional statements, not 2*N+2. json_each uses one bound JSON
 // parameter, avoiding both the 50-query and 100-parameter free-plan limits.
 const encoded=JSON.stringify(prepared),related=prepared.filter(r=>r.data.links.length||r.data.dependencies.length);
 const statements=[
  c.env.DB.prepare('INSERT INTO space_imports (id,space_id,fingerprint,result,created_at) VALUES (?,?,?,?,?)').bind(importId,space,fingerprint,JSON.stringify(result),now),
  c.env.DB.prepare("INSERT INTO space_records (id,space_id,kind,title,data,created_by,created_at,updated_at,mutation_id) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.kind'),json_extract(value,'$.title'),json_set(json_extract(value,'$.data'),'$.links',json('[]'),'$.dependencies',json('[]')),?,?,?,json_extract(value,'$.id') FROM json_each(?)").bind(space,actor(c).id,now,now,encoded),
  ...(related.length?[c.env.DB.prepare("UPDATE space_records SET data=json_extract(j.value,'$.data') FROM json_each(?) j WHERE space_records.id=json_extract(j.value,'$.id') AND space_records.space_id=?").bind(JSON.stringify(related),space)]:[]),
  audit(c.env,space,actor(c).id,'records.imported',importId,{count:prepared.length}),
 ];await c.env.DB.batch(statements);return c.json(result,201);
});
