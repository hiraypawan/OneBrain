import { platformFetch } from './platform-server';
import { NextResponse } from 'next/server';
export const STATE_COOKIE='onebrain-google-login';
export const SESSION_COOKIE='onebrain-platform-session';
export function localRedirect(path:string){return new NextResponse(null,{status:303,headers:{Location:path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
export async function authRequest(path:'start'|'finish',body:unknown,clientIp?:string){
 const result=await platformFetch(`/auth/google/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)},clientIp);
 if(!result.ok)throw new Error('Google sign-in was not completed');return result.json();
}
