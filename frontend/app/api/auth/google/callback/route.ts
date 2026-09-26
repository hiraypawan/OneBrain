import { SESSION_HINT } from '@/lib/session-hint';
import { NextRequest } from 'next/server';
import { authRequest,localRedirect,STATE_COOKIE,SESSION_COOKIE } from '@/lib/google-auth-server';
import { NEXT_COOKIE,safeReturnPath } from '@/lib/auth-return';
export const dynamic='force-dynamic';
class Fail extends Error{constructor(readonly code:string){super(code);}}
export async function GET(request:NextRequest){
 const next=safeReturnPath(request.cookies.get(NEXT_COOKIE)?.value),suffix=next!=='/'?`&next=${encodeURIComponent(next)}`:'';
 let response:ReturnType<typeof localRedirect>;
 const cookie=request.cookies.get(STATE_COOKIE)?.value,[state,browserToken]=cookie?.split('.')||[];
 try{
  if(request.nextUrl.searchParams.has('error'))throw new Fail('cancelled');
  if(!state||!browserToken||request.nextUrl.searchParams.get('state')!==state)throw new Fail('expired');
  const code=request.nextUrl.searchParams.get('code');if(!code)throw new Fail('google');
  const result=await authRequest('finish',{state,browserToken,code},request.headers.get('CF-Connecting-IP')||undefined);if(!/^[a-f0-9]{64}$/.test(result.token))throw new Fail('google');
  const secure=request.nextUrl.protocol==='https:'||request.headers.get('x-forwarded-proto')==='https';
  response=localRedirect(next);
  response.cookies.set(SESSION_HINT,'1',{sameSite:'lax',secure,path:'/',maxAge:7*86400});
  response.cookies.set(SESSION_COOKIE,result.token,{httpOnly:true,sameSite:'lax',secure,path:'/api/platform',maxAge:7*86400});
 }catch(e){ /* Never put provider codes, tokens or secret error details in a URL or log. */
  const code=e instanceof Fail?e.code:'google';response=localRedirect(`/auth/login?error=${code}${suffix}`);
 }
 response.cookies.set(STATE_COOKIE,'',{httpOnly:true,sameSite:'lax',path:'/api/auth/google',maxAge:0});
 response.cookies.set(NEXT_COOKIE,'',{httpOnly:true,sameSite:'lax',path:'/api/auth/google',maxAge:0});
 return response;
}
