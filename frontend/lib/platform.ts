export interface Space {id:string;name:string;role:'owner'|'admin'|'editor'|'viewer'}
export interface SharedRecord {id:string;kind:string;title:string;revision:number;data:Record<string,any>;created_at:number;updated_at:number}
export interface Connection {id:string;name:string;provider:string;status:string;config:Record<string,any>}
export interface Job {id:string;action:string;payload:Record<string,any>;plan:{name:string;firstRun:number;maxRuns:number;everyMinutes:number;whenRecordDone?:string};plan_hash:string;connection_id:string|null;revision:number;status:string;runs:number;next_run:number;last_error?:string}
export async function platformApi(path:string,method='GET',body?:unknown){
  const response=await fetch('/api/platform'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||`Request failed (${response.status}).`);return data;
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
