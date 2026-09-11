import { NextRequest,NextResponse } from 'next/server';
import { authRequest,localRedirect,STATE_COOKIE } from '@/lib/google-auth-server';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
 try{const origin=request.headers.get('origin');if(!origin||new URL(origin).host!==request.headers.get('host'))return NextResponse.json({error:'Same-origin sign-in required.'},{status:403});}catch{return NextResponse.json({error:'Invalid origin.'},{status:403});}
 try{
  const result=await authRequest('start',{}),url=new URL(result.url);
  if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||!/^[a-f0-9]{64}$/.test(result.state)||!/^[a-f0-9]{64}$/.test(result.browserToken))throw new Error('Invalid sign-in response');
  const callback=new URL(url.searchParams.get('redirect_uri')!);
  const response=NextResponse.redirect(url,303);response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
  response.cookies.set(STATE_COOKIE,`${result.state}.${result.browserToken}`,{httpOnly:true,sameSite:'lax',secure:callback.protocol==='https:',path:'/api/auth/google',maxAge:600});return response;
 }catch{return localRedirect('/auth/login?error=configuration');}
}
