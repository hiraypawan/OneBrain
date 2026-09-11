import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync} from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {startGoogleLogin,finishGoogleLogin,sessionUser} from '../src/platform/google-auth';
import {hash} from '../src/platform/core';
let mf:Miniflare,env:any,keys:any,jwk:any;
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-08-06',d1Databases:['DB']});const DB=await mf.getD1Database('DB');
 for(const file of ['0001_schema.sql','0002_platform.sql','0003_session_versions.sql','0004_atomic_allowances.sql','0005_google_identity.sql']){
  const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/--[^\n]*/g,''),triggers=[...sql.matchAll(/CREATE TRIGGER[\s\S]*?\nEND;/g)].map(m=>m[0]);
  await DB.batch([...sql.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g,'').split(';').filter(x=>x.trim()),...triggers].map(q=>DB.prepare(q)));
 }
 env={DB,TOKEN_ENCRYPTION_KEY:btoa('01234567890123456789012345678901'),GOOGLE_CLIENT_ID:'test-client-id',GOOGLE_CLIENT_SECRET:'test-not-a-real-google-secret',GOOGLE_LOGIN_REDIRECT:'http://localhost:3000/api/auth/google/callback'};
 keys=await generateKeyPair('RS256');jwk={...await exportJWK(keys.publicKey),kid:'test-google-key',alg:'RS256',use:'sig'};
},30000);
afterEach(()=>vi.restoreAllMocks());afterAll(async()=>{await mf.dispose();});
async function attempt(overrides:Record<string,unknown>={},subject='google-test-sub',email='google@example.test'){
 const start=await startGoogleLogin(env),url=new URL(start.url),nonce=url.searchParams.get('nonce');
 const claims={sub:subject,email,email_verified:true,name:'Test Google User',nonce,iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...overrides};
 const token=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'test-google-key'}).sign(keys.privateKey);
 const network=vi.spyOn(globalThis,'fetch').mockImplementation(async (input,init)=>{
  const target=String(input);
  if(target==='https://www.googleapis.com/oauth2/v3/certs')return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}});
  if(target==='https://oauth2.googleapis.com/token'){
   const form=new URLSearchParams(String(init?.body));expect(form.get('client_secret')).toBe(env.GOOGLE_CLIENT_SECRET);expect(form.get('redirect_uri')).toBe(env.GOOGLE_LOGIN_REDIRECT);
   const digest=await hash(form.get('code_verifier')!);const bytes=Uint8Array.from(digest.match(/../g)!.map(x=>parseInt(x,16)));const challenge=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');expect(challenge).toBe(url.searchParams.get('code_challenge'));
   return new Response(JSON.stringify({id_token:token}));
  }throw new Error('Unexpected outbound destination');
 });return {start,network,body:{state:start.state,browserToken:start.browserToken,code:'test-code'}};
}
describe('Google-only authorization code authentication',()=>{
 it('fails closed when credentials/callback are missing or unsafe',async()=>{
  await expect(startGoogleLogin({...env,GOOGLE_CLIENT_SECRET:''})).rejects.toThrow();await expect(startGoogleLogin({...env,GOOGLE_LOGIN_REDIRECT:'http://evil.example/api/auth/google/callback'})).rejects.toThrow();
 });
 it('uses PKCE, nonce, browser-bound one-time state, and verified stable Google identity',async()=>{
  const {start,body}=await attempt();expect(new URL(start.url).searchParams.get('scope')).toBe('openid email profile');
  await expect(finishGoogleLogin(env,{...body,browserToken:'b'.repeat(64)})).rejects.toThrow();
  const result=await finishGoogleLogin(env,body);expect(result.user.email).toBe('google@example.test');expect((await sessionUser(env,result.token))?.id).toBe(result.user.id);
  const stored=await env.DB.prepare('SELECT token_hash FROM platform_sessions WHERE user_id=?').bind(result.user.id).first();expect(stored.token_hash).toBe(await hash(result.token));
  await expect(finishGoogleLogin(env,body)).rejects.toThrow();
 });
 it('signs back into the same subject without creating a duplicate account',async()=>{
  const {body}=await attempt();const result=await finishGoogleLogin(env,body);const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').bind(result.user.email).first();expect(row.n).toBe(1);
 });
 it.each([{nonce:'wrong'},{aud:'attacker-client'},{iss:'https://attacker.example'},{email_verified:false},{exp:1},{azp:'other-client'}])('rejects invalid signed identity claims %j',async claims=>{
  const {body}=await attempt(claims);await expect(finishGoogleLogin(env,body)).rejects.toThrow('Google identity could not be verified');
 });
 it('refuses to link an existing legacy email to a new Google subject',async()=>{
  await env.DB.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').bind('legacy-user','legacy@example.test','legacy-hash',Date.now()).run();
  const {body}=await attempt({},'unlinked-subject','legacy@example.test');await expect(finishGoogleLogin(env,body)).rejects.toThrow('never linked automatically');
  expect(await env.DB.prepare('SELECT subject FROM google_identities WHERE user_id=?').bind('legacy-user').first()).toBeNull();
 });
 it('rejects a token signed by an untrusted private key',async()=>{
  const previous=keys.privateKey;let flow:any;
  try{keys.privateKey=(await generateKeyPair('RS256')).privateKey;flow=await attempt();}finally{keys.privateKey=previous;}
  await expect(finishGoogleLogin(env,flow.body)).rejects.toThrow('Google identity could not be verified');
 });
 it('rejects an expired flow before contacting Google',async()=>{
  const {body,network}=await attempt();await env.DB.prepare('UPDATE google_login_states SET expires_at=0 WHERE state_hash=?').bind(await hash(body.state)).run();await expect(finishGoogleLogin(env,body)).rejects.toThrow();expect(network).not.toHaveBeenCalled();
 });
});
