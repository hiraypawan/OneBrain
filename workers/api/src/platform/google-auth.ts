import { createRemoteJWKSet, jwtVerify } from 'jose';
import { fail, hash, id, object, randomToken, seal, text, unseal, type PlatformEnv } from './core';
import { jsonRequest } from './connectors';
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export function googleConfigured(env:PlatformEnv){return !!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_LOGIN_REDIRECT&&env.TOKEN_ENCRYPTION_KEY);}
function config(env:PlatformEnv){
 if(!googleConfigured(env))fail(503,'Google sign-in is not configured. Follow docs/GOOGLE-AUTH-SETUP.md.');
 let redirect:URL;try{redirect=new URL(env.GOOGLE_LOGIN_REDIRECT!);}catch{return fail(503,'Configure a valid Google login callback.');}
 if((redirect.protocol!=='https:'&&!(redirect.protocol==='http:'&&['localhost','127.0.0.1'].includes(redirect.hostname)))||redirect.pathname!=='/api/auth/google/callback'||redirect.search||redirect.hash||redirect.username||redirect.password)fail(503,'Google login requires HTTPS (or local loopback HTTP) and the exact /api/auth/google/callback path.');
 return {clientId:env.GOOGLE_CLIENT_ID!,clientSecret:env.GOOGLE_CLIENT_SECRET!,redirect:redirect.href};
}
export async function startGoogleLogin(env:PlatformEnv){
 const settings=config(env),state=randomToken(),browserToken=randomToken(),verifier=randomToken(),nonce=randomToken(),digest=await hash(state);
 const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 await env.DB.prepare('INSERT INTO google_login_states (state_hash,browser_hash,sealed,expires_at) VALUES (?,?,?,?)').bind(digest,await hash(browserToken),await seal(env,`google-login:${digest}`,{verifier,nonce}),Date.now()+600000).run();
 return {state,browserToken,url:'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:settings.clientId,redirect_uri:settings.redirect,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account',access_type:'online'})};
}
export async function finishGoogleLogin(env:PlatformEnv,input:unknown){
 const settings=config(env),raw=object(input),state=text(raw.state,'State',64),browser=text(raw.browserToken,'Browser binding',64),code=text(raw.code,'Authorization code',2048);
 if(!/^[a-f0-9]{64}$/.test(state)||!/^[a-f0-9]{64}$/.test(browser))fail(400,'Invalid sign-in state. Start Google sign-in again.');
 const digest=await hash(state),row=await env.DB.prepare('DELETE FROM google_login_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING sealed').bind(digest,await hash(browser),Date.now()).first<{sealed:string}>();
 if(!row)fail(400,'Sign-in expired, was used, or belongs to another browser. Start again.');
 const {verifier,nonce}=await unseal(env,`google-login:${digest}`,row!.sealed);
 let identity:any;
 try{
  const tokens=await jsonRequest('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:settings.clientId,client_secret:settings.clientSecret,redirect_uri:settings.redirect,grant_type:'authorization_code',code,code_verifier:verifier})});
  if(typeof tokens.id_token!=='string')throw new Error('No identity token');
  identity=(await jwtVerify(tokens.id_token,googleKeys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:settings.clientId,algorithms:['RS256'],clockTolerance:5,maxTokenAge:'10m',requiredClaims:['sub','iat','exp','nonce','email','email_verified']})).payload;
  if(identity.nonce!==nonce||identity.email_verified!==true||typeof identity.sub!=='string'||!identity.sub||identity.sub.length>255||(identity.azp&&identity.azp!==settings.clientId)||typeof identity.email!=='string'||!/^\S+@\S+\.\S+$/.test(identity.email)||identity.email.length>254)throw new Error('Invalid identity claims');
 }catch{return fail(401,'Google identity could not be verified. Start sign-in again.');}
 const email=identity.email.toLowerCase(),name=typeof identity.name==='string'?identity.name.slice(0,120):email.split('@')[0];
 let user=await env.DB.prepare('SELECT u.id,u.email,u.display_name FROM google_identities g JOIN users u ON u.id=g.user_id WHERE g.subject=?').bind(identity.sub).first<any>();
 const existingEmail=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first<{id:string}>();
 // Email is an attribute, never an account-linking credential. Legacy accounts require an operator-reviewed migration.
 if(existingEmail&&existingEmail.id!==user?.id)fail(409,'This email belongs to an existing account. Ask the operator for a reviewed identity migration; accounts are never linked automatically by email.');
 const now=Date.now(),token=randomToken(),tokenHash=await hash(token);
 if(!user){
  user={id:id(),email,display_name:name};
  try{await env.DB.batch([
   env.DB.prepare('INSERT INTO users (id,email,password_hash,display_name,settings,created_at) VALUES (?,?,NULL,?,?,?)').bind(user.id,email,name,'{}',now),
   env.DB.prepare('INSERT INTO google_identities (subject,user_id,verified_email,created_at) VALUES (?,?,?,?)').bind(identity.sub,user.id,email,now),
   sessionInsert(env,tokenHash,user.id,now),
  ]);}catch{fail(409,'Account changed during sign-in. Start Google sign-in again; no automatic account linking occurred.');}
 }else{
  await env.DB.batch([
   env.DB.prepare('UPDATE users SET email=?,display_name=? WHERE id=?').bind(email,name,user.id),
   env.DB.prepare('UPDATE google_identities SET verified_email=? WHERE subject=?').bind(email,identity.sub),
   sessionInsert(env,tokenHash,user.id,now),
  ]);
 }
 return {token,user:{id:user.id,email,displayName:name}};
}
function sessionInsert(env:PlatformEnv,tokenHash:string,user:string,now:number){
 return env.DB.prepare("INSERT INTO platform_sessions (token_hash,user_id,created_at,expires_at,auth_provider) VALUES (?,?,?,?,'google')").bind(tokenHash,user,now,now+7*86400000);
}
export async function sessionUser(env:PlatformEnv,token:string){
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 return env.DB.prepare("SELECT u.id,u.email,u.display_name AS displayName FROM platform_sessions s JOIN users u ON u.id=s.user_id JOIN google_identities g ON g.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND s.auth_provider='google'").bind(await hash(token),Date.now()).first<{id:string;email:string;displayName:string}>();
}
