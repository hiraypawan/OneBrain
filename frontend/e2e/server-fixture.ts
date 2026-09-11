// Test process only: no fixture HTTP endpoint, password backdoor or production auth switch.
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {Page} from '@playwright/test';
export async function seedServerSession(page:Page){
 const user=randomUUID(),email=`browser-${user}@example.test`,token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex'),now=Date.now();
 const sql=`INSERT INTO users (id,email,created_at) VALUES ('${user}','${email}',${now}); INSERT INTO google_identities (subject,user_id,verified_email,created_at) VALUES ('fixture-${user}','${user}','${email}',${now}); INSERT INTO platform_sessions (token_hash,user_id,created_at,expires_at,auth_provider) VALUES ('${hash}','${user}',${now},${now+3600000},'google');`;
 execFileSync(process.execPath,[resolve('../workers/api/node_modules/wrangler/bin/wrangler.js'),'d1','execute','onebrain-db','--local','--command',sql],{cwd:resolve('../workers/api'),stdio:'pipe',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 const base=new URL(process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:3000');
 if(!['127.0.0.1','localhost'].includes(base.hostname))throw new Error('Fixtures only support a local test server');
 await page.context().addCookies([{name:'onebrain-session-present',value:'1',domain:base.hostname,path:'/',sameSite:'Lax',secure:false},{name:'onebrain-platform-session',value:token,domain:base.hostname,path:'/api/platform',httpOnly:true,sameSite:'Lax',secure:false}]);
 return {userId:user};
}

export function seedActionHistory(space:string,user:string){
 if(![space,user].every(v=>/^[a-f0-9-]{36}$/.test(v)))throw new Error('Use fixture UUIDs only');
 const plan=JSON.stringify({firstRun:Date.now(),maxRuns:3,everyMinutes:15});
 const jobs=JSON.stringify(Array.from({length:26},(_,i)=>String(i).padStart(2,'0')));
 const sql=`INSERT INTO jobs(id,space_id,action,payload,plan,plan_hash,status,created_by,created_at,updated_at,next_run,runs,mutation_id) SELECT '${space}-job-'||value,'${space}','local.notify','{}',json_set('${plan}','$.name','History job '||value),'fixture','verified','${user}',1,1,1,3,value FROM json_each('${jobs}'); INSERT INTO job_receipts(id,job_id,space_id,run_number,at,status,evidence) SELECT '${space}-receipt-'||value,'${space}-job-25','${space}',value,value,'verified',json_object('fixtureRun',value) FROM json_each('[1,2,3]');`;
 execFileSync(process.execPath,[resolve('../workers/api/node_modules/wrangler/bin/wrangler.js'),'d1','execute','onebrain-db','--local','--command',sql],{cwd:resolve('../workers/api'),stdio:'pipe',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
}
