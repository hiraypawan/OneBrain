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
 await page.context().addCookies([{name:'onebrain-platform-session',value:token,domain:base.hostname,path:'/api/platform',httpOnly:true,sameSite:'Lax',secure:false}]);
}
