import { NextResponse } from 'next/server';
export const STATE_COOKIE='onebrain-google-login';
export const SESSION_COOKIE='onebrain-platform-session';
export function localRedirect(path:string){return new NextResponse(null,{status:303,headers:{Location:path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
export async function authRequest(path:'start'|'finish',body:unknown){
 const base=process.env.PLATFORM_API_URL;if(!base)throw new Error('Platform is not configured');
 const result=await fetch(`${base.replace(/\/$/,'')}/api/platform/auth/google/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!result.ok)throw new Error('Google sign-in was not completed');return result.json();
}
