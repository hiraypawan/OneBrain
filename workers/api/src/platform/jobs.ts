import { canonical, fail, hash, id, number, object, text, type PlatformEnv } from './core';
import { DeliveryError, executeConnector, PROVIDERS, validatePayload, type Provider } from './connectors';
export async function prepareJob(env: PlatformEnv, space: string, input: unknown) {
  const raw=object(input), action=text(raw.action,'Action');
  const payload=validatePayload(action,raw.payload);
  const connectionId=raw.connectionId ? text(raw.connectionId,'Connection') : null;
  if (action !== 'local.notify') {
    const connection=connectionId && await env.DB.prepare('SELECT provider,status FROM connections WHERE id=? AND space_id=?').bind(connectionId,space).first<{provider:Provider;status:string}>();
    if (!connection || connection.status !== 'connected' || !(PROVIDERS[connection.provider].actions as readonly string[]).includes(action)) fail(400,'Choose a connected provider that permits this action.');
  } else if (connectionId) fail(400,'In-app notifications do not use an external connector.');
  const p=object(raw.plan || {});
  const firstRun=p.firstRun === undefined ? Date.now() : number(p.firstRun,'First run',Date.now()-60000,Date.now()+90*86400000);
  const maxRuns=number(p.maxRuns ?? 1,'Occurrences',1,30);
  if (!Number.isInteger(maxRuns)) fail(400,'Occurrences must be a whole number.');
  const everyMinutes=number(p.everyMinutes ?? 0,'Repeat interval',0,525600);
  if (maxRuns > 1 && everyMinutes < 15) fail(400,'Recurring jobs need at least 15 minutes between occurrences.');
  if (firstRun+(maxRuns-1)*everyMinutes*60000 > Date.now()+90*86400000) fail(400,'The approved schedule must fit within 90 days.');
  const plan={expiresAt:Date.now()+90*86400000,name:text(p.name || action,'Routine name',120),firstRun,maxRuns,everyMinutes,whenRecordDone:p.whenRecordDone ? text(p.whenRecordDone,'Condition record') : null};
  if (plan.whenRecordDone && !await env.DB.prepare('SELECT id FROM space_records WHERE id=? AND space_id=?').bind(plan.whenRecordDone,space).first()) fail(400,'Condition record must belong to this workspace.');
  return {action,payload,connectionId,plan,planHash:await hash(canonical({action,payload,connectionId,plan}))};
}
export async function runDue(env: PlatformEnv, space?: string, now=Date.now()) {
  // Recovery is lease-gated and atomic: a crashed delivery gets a durable unknown receipt, not a replay.
  const expired=await env.DB.prepare("SELECT id,lease_id FROM jobs WHERE status='running' AND lease_until<?"+(space?' AND space_id=?':'')+' LIMIT 100').bind(...(space?[now,space]:[now])).all<any>();
  for(const old of expired.results){
    const evidence=JSON.stringify({error:'Worker lease expired. Inspect the destination; no automatic redelivery.'});
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO job_receipts (id,job_id,space_id,run_number,at,status,destination_id,evidence) SELECT ?,id,space_id,runs+1,?,'unknown',NULL,? FROM jobs WHERE id=? AND lease_id=? AND status='running' AND lease_until<?").bind(id(),now,evidence,old.id,old.lease_id,now),
      env.DB.prepare("INSERT INTO space_audit (id,space_id,actor_id,operation,subject_id,at,detail) SELECT ?,space_id,COALESCE(approved_by,created_by),'job.lease-expired',id,?,? FROM jobs WHERE id=? AND lease_id=? AND status='running' AND lease_until<?").bind(id(),now,evidence,old.id,old.lease_id,now),
      env.DB.prepare("UPDATE jobs SET status='unknown',last_error='Worker lease expired. Inspect the destination; no automatic redelivery.',lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=? AND status='running' AND lease_until<?").bind(now,old.id,old.lease_id,now),
    ]);
  }
  // Filter blocked conditions and revoked approvers before LIMIT, so they cannot starve ready work.
  const condition="(json_extract(plan,'$.whenRecordDone') IS NULL OR NOT EXISTS(SELECT 1 FROM space_records WHERE id=json_extract(jobs.plan,'$.whenRecordDone') AND space_id=jobs.space_id) OR EXISTS(SELECT 1 FROM space_records WHERE id=json_extract(jobs.plan,'$.whenRecordDone') AND space_id=jobs.space_id AND json_extract(data,'$.status')='done'))";
  const authorization="approved_hash=plan_hash AND EXISTS(SELECT 1 FROM space_members WHERE space_id=jobs.space_id AND user_id=jobs.approved_by AND role IN ('owner','admin'))";
  const candidates=await env.DB.prepare("SELECT * FROM jobs WHERE status='queued' AND next_run<=? AND "+authorization+' AND '+condition+(space?' AND space_id=?':'')+' ORDER BY next_run LIMIT 20').bind(...(space?[now,space]:[now])).all<any>();
  let handled=0;
  for (const job of candidates.results) {
    const plan=JSON.parse(job.plan);
    const lease=id();
    const claim=await env.DB.prepare("UPDATE jobs SET status='running',lease_id=?,lease_until=?,updated_at=? WHERE id=? AND status='queued' AND next_run<=? AND "+authorization+' AND '+condition+' RETURNING id').bind(lease,now+120000,now,job.id,now).first();
    if (!claim) continue;
    handled++;
    const run=job.runs+1, occurrence=`${job.id}-${run}`;
    try {
      const expiresAt=plan.expiresAt||job.created_at+90*86400000;
      if(now>expiresAt)throw new DeliveryError('failed','Approved schedule expired. Create and review a new action.');
      if(plan.whenRecordDone&&!await env.DB.prepare('SELECT id FROM space_records WHERE id=? AND space_id=?').bind(plan.whenRecordDone,job.space_id).first())throw new DeliveryError('failed','The approved condition record was deleted. Review a new action.');
      let proof;
      if (job.action==='local.notify') {
        const payload=validatePayload(job.action,JSON.parse(job.payload));
        // Idempotent internal delivery: notification and its receipt are committed in the same transaction below.
        proof={status:'verified',destinationId:occurrence,evidence:{destination:'Workspace inbox',delivery:'Persisted in app; not an OS push notification'}};
      } else {
        const connection=await env.DB.prepare("SELECT * FROM connections WHERE id=? AND space_id=? AND status='connected'").bind(job.connection_id,job.space_id).first<any>();
        if (!connection) throw new DeliveryError('failed','Connection was revoked or expired. Reconnect and create a newly reviewed action.');
        // Bounded server allowance; no auto-purchase or paid overflow.
        const budgetKey=`executions:${job.space_id}:${new Date(now).toISOString().slice(0,10)}`;
        const allowance=await env.DB.prepare('INSERT INTO platform_rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<100 RETURNING count').bind(budgetKey,now+2*86400000).first<{count:number}>();
        if(!allowance)throw new DeliveryError('failed','Daily external-dispatch allowance reached. No paid overflow was enabled.');
        proof=await executeConnector(env,connection,job.action,validatePayload(job.action,JSON.parse(job.payload)),occurrence);
      }
      const candidateNext=Math.max(now,Date.now())+plan.everyMinutes*60000;
      const more=run < plan.maxRuns && candidateNext<=expiresAt;
      if(run<plan.maxRuns&&!more)proof.evidence={...proof.evidence,remainingOccurrences:"Omitted: the next occurrence would exceed the approved expiry."};
      // Schedule from completion to avoid blasting missed occurrences after downtime.
      const next=more?Math.max(now,Date.now())+plan.everyMinutes*60000:job.next_run;
      const statements=[
        leaseAudit(env,job.id,lease,'job.result',{status:proof.status,occurrence}),
        env.DB.prepare('INSERT INTO job_receipts (id,job_id,space_id,run_number,at,status,destination_id,evidence) SELECT ?,id,space_id,?,?,?,?,? FROM jobs WHERE id=? AND lease_id=? AND status=?').bind(id(),run,Date.now(),proof.status,proof.destinationId,JSON.stringify(proof.evidence),job.id,lease,'running'),
        env.DB.prepare('UPDATE jobs SET status=?,runs=?,attempts=0,next_run=?,lease_id=NULL,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=? AND lease_id=? AND status=?').bind(more?'queued':proof.status,run,next,Date.now(),job.id,lease,'running'),

      ];
      if (job.action==='local.notify') {
        const p=JSON.parse(job.payload);
        statements.unshift(env.DB.prepare("INSERT OR IGNORE INTO space_notifications (id,space_id,job_id,title,body,created_at) SELECT ?,space_id,?,?,?,? FROM jobs WHERE id=? AND lease_id=? AND status='running'").bind(occurrence,occurrence,p.title,p.body,Date.now(),job.id,lease));
      }
      await env.DB.batch(statements);
    } catch (error) {
      const problem=error instanceof DeliveryError ? error : new DeliveryError('unknown','Execution did not finish with reliable evidence. Inspect the destination before retrying.');
      const retry=problem.outcome==='retry' && job.attempts < 4;
      const state=retry?'queued':problem.outcome==='retry'?'failed':problem.outcome;
      const statements=[leaseAudit(env,job.id,lease,'job.error',{status:state,error:problem.message})];
      if(!retry)statements.push(env.DB.prepare("INSERT OR IGNORE INTO job_receipts (id,job_id,space_id,run_number,at,status,destination_id,evidence) SELECT ?,id,space_id,?,?,?,NULL,? FROM jobs WHERE id=? AND lease_id=? AND status='running'").bind(id(),run,Date.now(),state,JSON.stringify({error:problem.message,retry:'No automatic redelivery'}),job.id,lease));
      statements.push(env.DB.prepare("UPDATE jobs SET status=?,attempts=attempts+1,next_run=?,last_error=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=? AND status='running'").bind(state,now+Math.min(3600000,60000*2**job.attempts),problem.message,Date.now(),job.id,lease));
      await env.DB.batch(statements);
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM platform_sessions WHERE expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM google_login_states WHERE expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM platform_rate_limits WHERE expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM space_invites WHERE expires_at<?').bind(now),
  ]);
  return {handled};
}

function leaseAudit(env:PlatformEnv,job:string,lease:string,operation:string,detail:unknown){return env.DB.prepare("INSERT INTO space_audit (id,space_id,actor_id,operation,subject_id,at,detail) SELECT ?,space_id,COALESCE(approved_by,created_by),?,id,?,? FROM jobs WHERE id=? AND lease_id=? AND status='running'").bind(id(),operation,Date.now(),JSON.stringify(detail),job,lease);}
