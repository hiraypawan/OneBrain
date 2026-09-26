import { NextRequest,NextResponse } from 'next/server';
import { authRequest,localRedirect,STATE_COOKIE } from '@/lib/google-auth-server';
import { NEXT_COOKIE,safeReturnPath } from '@/lib/auth-return';
export const dynamic='force-dynamic';
async function returnPath(request:NextRequest){
 try{const form=await request.formData();return safeReturnPath(form.get('next'));}catch{return safeReturnPath(request.nextUrl.searchParams.get('next'));}
}
export async function POST(request:NextRequest){
 try{const origin=request.headers.get('origin');if(!origin||new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Same-origin sign-in required.'},{status:403});}catch{return NextResponse.json({error:'Invalid origin.'},{status:403});}
 const next=await returnPath(request),back=(code:string)=>localRedirect(`/auth/login?error=${code}${next!=='/'?`&next=${encodeURIComponent(next)}`:''}`);
 let result:any;
 try{result=await authRequest('start',{},request.headers.get('CF-Connecting-IP')||undefined);}
 catch(e){return back(e instanceof Error&&/not completed|Configure/.test(e.message)?'configuration':'unreachable');}
 try{
  const url=new URL(result.url);
  if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||!/^[a-f0-9]{64}$/.test(result.state)||!/^[a-f0-9]{64}$/.test(result.browserToken))throw new Error('Invalid sign-in response');
  const callback=new URL(url.searchParams.get('redirect_uri')!),secure=callback.protocol==='https:';
  const response=NextResponse.redirect(url,303);response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
  response.cookies.set(STATE_COOKIE,`${result.state}.${result.browserToken}`,{httpOnly:true,sameSite:'lax',secure,path:'/api/auth/google',maxAge:600});
  response.cookies.set(NEXT_COOKIE,next,{httpOnly:true,sameSite:'lax',secure,path:'/api/auth/google',maxAge:600});
  return response;
 }catch{return back('configuration');}
}
