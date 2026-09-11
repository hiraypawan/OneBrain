import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const root=new URL('../',import.meta.url);
const vars=new URL('workers/api/.dev.vars',root);
if(!existsSync(vars)){
 writeFileSync(vars,`JWT_SECRET=${randomBytes(48).toString('hex')}\nTOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\nAPP_ORIGIN=http://localhost:3000\nOUTBOUND_HOSTS=\n`,{mode:0o600});
 console.log('Created private local development keys. Existing keys are never overwritten.');
}else console.log('Preserving existing local development keys.');
const frontend=new URL('frontend/.env.local',root);
const current=existsSync(frontend)?readFileSync(frontend,'utf8'):'';
if(!/^PLATFORM_API_URL=/m.test(current))writeFileSync(frontend,current+'\nPLATFORM_API_URL=http://127.0.0.1:8787\n',{mode:0o600});
console.log('Configured the server-only local API proxy. No deployment or third-party credential was created.');
