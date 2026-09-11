export interface Space {id:string;name:string;role:'owner'|'admin'|'editor'|'viewer'}
export interface SharedRecord {id:string;kind:string;title:string;revision:number;data:Record<string,any>;created_at:number;updated_at:number}
export interface Connection {id:string;name:string;provider:string;status:string;config:Record<string,any>}
export interface Job {id:string;action:string;payload:Record<string,any>;plan:{name:string;firstRun:number;maxRuns:number;everyMinutes:number;whenRecordDone?:string};plan_hash:string;connection_id:string|null;revision:number;status:string;runs:number;next_run:number;last_error?:string}
export class PlatformRequestError extends Error {
  constructor(message:string, readonly status:number) { super(message); this.name='PlatformRequestError'; }
}
let publicCaps: { until: number; value: unknown } | undefined;
let cooldownUntil = 0;
export async function platformApi(path:string,method='GET',body?:unknown){
  if (method==='GET' && path==='/capabilities' && publicCaps && publicCaps.until>Date.now()) return publicCaps.value as any;
  const revocation = path==='/logout' || path==='/logout-all';
  if (!revocation && cooldownUntil>Date.now()) throw new PlatformRequestError('Server capacity is temporarily busy. Wait before retrying; device-local capture still works.',503);
  const response=await fetch('/api/platform'+path,{method,cache:'no-store',signal:AbortSignal.timeout(method === 'GET' ? 12000 : 65000),headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  if (response.status===429 || (response.status===503 && response.headers.has('Retry-After'))) {
    const seconds=Number(response.headers.get('Retry-After'));
    cooldownUntil=Date.now()+Math.max(1000,Math.min(60000,(Number.isFinite(seconds)&&seconds>0?seconds:5)*1000));
  }
  if(!response.ok)throw new PlatformRequestError(data.error||`Request failed (${response.status}).`,response.status);
  if (path==='/capabilities') publicCaps={until:Date.now()+60000,value:data};
  return data;
}

export const ACTION_EXAMPLES:Record<string,any>={
 'local.notify':{title:'Review the client proposal',body:'Open the project context before following up.'},
 'telegram.send':{chatId:'',text:''},'slack.send':{channel:'',text:''},
 'calendar.create':{calendarId:'primary',summary:'',description:'',start:'',end:''},
 'sheets.append':{spreadsheetId:'',range:'Sheet1!A:C',rows:[['Date','Client','Next step']]},
 'gmail.draft':{to:'',subject:'',body:''},'gmail.send':{to:'',subject:'',body:''},
 'todoist.create':{content:'',projectId:''},'notion.create':{parentId:'',title:'',body:''},
 'hubspot.contact':{email:'',firstName:'',lastName:''},
 'home-assistant.service':{domain:'light',service:'turn_on',entityId:'light.example',data:{}},
 'webhook.post':{body:{message:''}},'mcp.call':{name:'',arguments:{}},
};
