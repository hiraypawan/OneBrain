import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {applyMigrations} from './helpers/migrations';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {startGoogleLogin,finishGoogleLogin,sessionUser,googleSignInStatus,loginRedirect,validEncryptionKey} from '../src/platform/google-auth';
import {app} from '../src/index';
import {hash} from '../src/platform/core';
let mf:Miniflare,env:any,keys:any,jwk:any;
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-08-06',d1Databases:['DB']});const DB=await mf.getD1Database('DB');
 await applyMigrations(DB);
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
describe('Google sign-in readiness (what the sign-in page and deploy log report)',()=>{
 const base={DB:{} as any};
 it('names exactly what is missing, never a value',()=>{
  const status=googleSignInStatus({...base,GOOGLE_CLIENT_ID:'id-value-123',FRONTEND_URL:'https://onebrains.pages.dev'});
  expect(status.ready).toBe(false);
  expect(status.missing).toEqual(['GOOGLE_CLIENT_SECRET','TOKEN_ENCRYPTION_KEY']);
  expect(status.callback).toBe('https://onebrains.pages.dev/api/auth/google/callback');
  expect(JSON.stringify(status)).not.toContain('id-value-123');
 });
 it('derives the callback from the site origin so no redirect secret is needed',()=>{
  expect(loginRedirect({...base,FRONTEND_URL:'https://onebrains.pages.dev'})).toBe('https://onebrains.pages.dev/api/auth/google/callback');
  expect(loginRedirect({...base,FRONTEND_URL:'https://a.example, https://b.example'})).toBe('https://a.example/api/auth/google/callback');
  expect(loginRedirect({...base,APP_ORIGIN:'http://localhost:3000',FRONTEND_URL:'https://a.example'})).toBe('http://localhost:3000/api/auth/google/callback');
  expect(loginRedirect({...base,GOOGLE_LOGIN_REDIRECT:'https://custom.example/api/auth/google/callback',FRONTEND_URL:'https://a.example'})).toBe('https://custom.example/api/auth/google/callback');
  expect(loginRedirect(base)).toBeNull();
 });
 it('fails closed on an unsafe explicit callback instead of silently deriving another',()=>{
  const status=googleSignInStatus({...env,GOOGLE_LOGIN_REDIRECT:'http://evil.example/api/auth/google/callback',FRONTEND_URL:'https://onebrains.pages.dev'});
  expect(status.ready).toBe(false);expect(status.missing).toEqual(['GOOGLE_LOGIN_REDIRECT']);expect(status.callback).toBeNull();
 });
 it('treats a malformed encryption key as missing (it would fail at sign-in time)',()=>{
  expect(validEncryptionKey(btoa('01234567890123456789012345678901'))).toBe(true);
  expect(validEncryptionKey('not base64!')).toBe(false);
  expect(validEncryptionKey(btoa('too short'))).toBe(false);
  expect(validEncryptionKey(undefined)).toBe(false);
 });
 it('signs in with the derived callback when GOOGLE_LOGIN_REDIRECT is not set',async()=>{
  const {GOOGLE_LOGIN_REDIRECT:_unused,...rest}=env;
  const start=await startGoogleLogin({...rest,FRONTEND_URL:'https://onebrains.pages.dev'});
  expect(new URL(start.url).searchParams.get('redirect_uri')).toBe('https://onebrains.pages.dev/api/auth/google/callback');
 });
 it('publishes readiness on /capabilities without leaking secrets',async()=>{
  const secrets={GOOGLE_CLIENT_ID:'public-client-id',GOOGLE_CLIENT_SECRET:'super-secret-value',TOKEN_ENCRYPTION_KEY:btoa('01234567890123456789012345678901')};
  const r=await app.request('/api/platform/capabilities',{},{DB:env.DB,FRONTEND_URL:'https://onebrains.pages.dev',API_RATE_LIMITER:{limit:async()=>({success:true})},...secrets});
  const body:any=await r.json();
  expect(r.status).toBe(200);expect(body.configured).toBe(true);expect(body.encryptedConnections).toBe(true);
  expect(body.googleSignIn).toEqual({ready:true,missing:[],callback:'https://onebrains.pages.dev/api/auth/google/callback'});
  const dumped=JSON.stringify(body);
  expect(dumped).not.toContain('super-secret-value');expect(dumped).not.toContain(secrets.TOKEN_ENCRYPTION_KEY);
  const off:any=await (await app.request('/api/platform/capabilities',{},{DB:env.DB,FRONTEND_URL:'https://onebrains.pages.dev',API_RATE_LIMITER:{limit:async()=>({success:true})}})).json();
  expect(off.configured).toBe(false);expect(off.googleSignIn.missing).toEqual(['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','TOKEN_ENCRYPTION_KEY']);
 });
});
