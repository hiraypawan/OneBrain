import { NextRequest } from 'next/server';
import { authRequest,localRedirect,STATE_COOKIE,SESSION_COOKIE } from '@/lib/google-auth-server';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 let response=localRedirect('/auth/login?error=google');
 const cookie=request.cookies.get(STATE_COOKIE)?.value,[state,browserToken]=cookie?.split('.')||[];
 try{
  if(request.nextUrl.searchParams.has('error'))throw new Error('Consent declined');
  if(!state||!browserToken||request.nextUrl.searchParams.get('state')!==state)throw new Error('State mismatch');
  const code=request.nextUrl.searchParams.get('code');if(!code)throw new Error('Missing code');
  const result=await authRequest('finish',{state,browserToken,code});if(!/^[a-f0-9]{64}$/.test(result.token))throw new Error('Invalid session');
  response=localRedirect('/operations');
  response.cookies.set(SESSION_COOKIE,result.token,{httpOnly:true,sameSite:'lax',secure:request.nextUrl.protocol==='https:'||request.headers.get('x-forwarded-proto')==='https',path:'/api/platform',maxAge:7*86400});
 }catch{ /* Never put provider codes, tokens or secret error details in a URL or log. */ }
 response.cookies.set(STATE_COOKIE,'',{httpOnly:true,sameSite:'lax',path:'/api/auth/google',maxAge:0});return response;
}
