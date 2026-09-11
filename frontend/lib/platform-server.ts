import {getCloudflareContext} from '@opennextjs/cloudflare';
/** Server-only transport; never imported by client components. No public retry of
 * a failed binding call: that could duplicate a side effect or bypass isolation. */
export async function platformFetch(path:string, init:RequestInit, clientIp?:string) {
  // Workers does not implement redirect:'error'. Manual mode plus an explicit
  // rejection preserves the no-credential-forwarding boundary in both runtimes.
  init={...init,redirect:'manual'};
  const checked=async(response:Response)=>{
    if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error('Unexpected platform redirect; not followed.');}
    return response;
  };
  let service: {fetch(input:Request):Promise<Response>} | undefined;
  try { service=(getCloudflareContext().env as any).PLATFORM_API; }
  catch { /* Plain Next.js/local tests have no Cloudflare request context. */ }
  if(service) {
    const headers=new Headers(init.headers);
    // Cloudflare supplies this at the public frontend edge. Only pass it on the
    // private service hop, so Google auth does not rate-limit the whole proxy.
    if(clientIp)headers.set('CF-Connecting-IP',clientIp);
    return checked(await service.fetch(new Request('https://onebrain.internal/api/platform'+path,{...init,headers})));
  }
  const base=process.env.PLATFORM_API_URL;
  if(!base)throw new Error('Configure the PLATFORM_API service binding, or the server-only PLATFORM_API_URL for local Next.js.');
  return checked(await fetch(base.replace(/\/$/,'')+'/api/platform'+path,init));
}
