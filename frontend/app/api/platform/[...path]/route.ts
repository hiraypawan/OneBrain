import { platformFetch } from '@/lib/platform-server';
import { SESSION_HINT } from '@/lib/session-hint';
import { NextRequest, NextResponse } from 'next/server';
import { readBody, bodyError } from '@/lib/request-body';
export const dynamic = 'force-dynamic';
const COOKIE='onebrain-platform-session';
async function proxy(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
  const path=(await params).path;
  if(path[0]==='auth')return NextResponse.json({error:'Use the dedicated Google sign-in flow.'},{status:404});
  if(!path.length||path.some(p=>!/^[a-zA-Z0-9_-]+$/.test(p)))return NextResponse.json({error:'Invalid API path.'},{status:400});
  if(!['GET','HEAD'].includes(request.method)){
    const origin=request.headers.get('origin');
    const host=request.headers.get('host');
    let originHost:string|undefined;try{originHost=origin?new URL(origin).host:undefined;}catch{return NextResponse.json({error:'Invalid origin.'},{status:403});}
    if(originHost && originHost!==host)return NextResponse.json({error:'Cross-origin mutations are not allowed.'},{status:403});
    if(!request.headers.get('content-type')?.startsWith('application/json'))return NextResponse.json({error:'Use application/json.'},{status:415});
  }
  if(path.length===1&&['login','register'].includes(path[0]))return NextResponse.json({error:'Password login and signup are disabled. Use Google sign-in.'},{status:410,headers:{'Cache-Control':'no-store'}});
  const session=request.cookies.get(COOKIE)?.value;
  if(!session && !(path.length===1 && path[0] === 'capabilities')) {
    const denied=NextResponse.json({error:'Sign in with Google to access server workspaces.'},{status:401,headers:{'Cache-Control':'no-store'}});
    denied.cookies.set(SESSION_HINT,'',{sameSite:'lax',path:'/',maxAge:0});return denied;
  }
  let body: string | undefined;
  try { body = ['GET','HEAD'].includes(request.method) ? undefined : await readBody(request, 750000); } catch (error) { return bodyError(error); }
  try{
    const result=await platformFetch(`/${path.join('/')}${request.nextUrl.search}`,{method:request.method,headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session}`}:{})},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60000)},request.headers.get('CF-Connecting-IP')||undefined);
    const data=await result.json();
    delete data.token;
    const response=NextResponse.json(data,{status:result.status,headers:{'Cache-Control':'no-store'}});
    if((path[0]==='logout'||path[0]==='logout-all')&&(result.ok||result.status===401))response.cookies.set(COOKIE,'',{httpOnly:true,sameSite:'lax',path:'/api/platform',maxAge:0});
    if (result.status===401 || ((path[0]==='logout'||path[0]==='logout-all')&&result.ok)) response.cookies.set(SESSION_HINT,'',{sameSite:'lax',path:'/',maxAge:0});
    else if (result.ok && (path[0]==='me'||path[0]==='bootstrap')) response.cookies.set(SESSION_HINT,'1',{sameSite:'lax',path:'/',maxAge:7*86400,secure:request.nextUrl.protocol==='https:'||request.headers.get('x-forwarded-proto')==='https'});
    const retry=result.headers.get('Retry-After');if(retry)response.headers.set('Retry-After',retry);
    return response;
  }catch{return NextResponse.json({error:'Server workspace is unreachable or the request timed out. Refresh job status before trying an action again; no completion is claimed.'},{status:503});}
}
export {proxy as GET,proxy as POST,proxy as PUT,proxy as DELETE};
