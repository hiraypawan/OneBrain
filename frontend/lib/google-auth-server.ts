import { platformFetch } from './platform-server';
import { NextResponse } from 'next/server';
export const STATE_COOKIE='onebrain-google-login';
export const SESSION_COOKIE='onebrain-platform-session';
export function localRedirect(path:string){return new NextResponse(null,{status:303,headers:{Location:path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}

/** A non-OK answer from the platform API. Carries the status only — never the body. */
export class AuthRequestError extends Error{
 constructor(readonly status:number){super('Google sign-in was not completed');this.name='AuthRequestError';}
}

export async function authRequest(path:'start'|'finish',body:unknown,clientIp?:string){
 const result=await platformFetch(`/auth/google/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)},clientIp);
 if(!result.ok){try{await result.body?.cancel();}catch{}throw new AuthRequestError(result.status);}
 return result.json();
}

/**
 * Turn a failed start/finish call into the sign-in page's `?error=` code.
 * Every failure used to read "isn't switched on", which sent people (and the
 * operator) looking for a missing setting when the server was merely busy,
 * erroring, or the sign-in had simply expired.
 */
export function signInFailureCode(error:unknown,stage:'start'|'finish'):string{
 if(error instanceof AuthRequestError){
  const s=error.status;
  if(s===503)return 'configuration';   // the API says Google sign-in is not configured
  if(s===429)return 'busy';
  if(s>=500)return 'server';
  if(stage==='finish'){if(s===400)return 'expired';if(s===409)return 'account';return 'google';}
  return 'configuration';
 }
 if(error instanceof Error&&/Configure the PLATFORM_API/.test(error.message))return 'configuration';
 if(error instanceof TypeError||(error instanceof Error&&/network|fetch|timed? ?out|abort/i.test(`${error.name} ${error.message}`)))return 'unreachable';
 return stage==='start'?'unreachable':'google';
}
