import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
const COOKIE='onebrain-platform-session';
async function proxy(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
  const base=process.env.PLATFORM_API_URL;
  if(!base)return NextResponse.json({error:'Server workspace is not configured. Set the server-only PLATFORM_API_URL; device-local capture still works.'},{status:503});
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
  const body=['GET','HEAD'].includes(request.method)?undefined:await request.text();
  if(body && new TextEncoder().encode(body).length>750000)return NextResponse.json({error:'Request exceeds 750 KB.'},{status:413});
  const session=request.cookies.get(COOKIE)?.value;
  try{
    const result=await fetch(`${base.replace(/\/$/,'')}/api/platform/${path.join('/')}${request.nextUrl.search}`,{method:request.method,headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session}`}:{})},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60000)});
    const data=await result.json();
    const token=data.token;delete data.token;
    const response=NextResponse.json(data,{status:result.status,headers:{'Cache-Control':'no-store'}});
    if(path[0]==='logout'||path[0]==='logout-all')response.cookies.set(COOKIE,'',{httpOnly:true,sameSite:'lax',path:'/api/platform',maxAge:0});
    return response;
  }catch{return NextResponse.json({error:'Server workspace is unreachable or the request timed out. Refresh job status before trying an action again; no completion is claimed.'},{status:503});}
}
export {proxy as GET,proxy as POST,proxy as PUT,proxy as DELETE};
