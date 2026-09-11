import { platformApi } from './platform';
export interface SharedPreview {requestId:string;spaceId:string;spaceName:string;userId:string;kind:string;title:string;body:string;firstRun:number}
export function sharedIntent(input:string){
 const m=input.trim().match(/^(?:shared (note|task|idea|project)|server (reminder))\s*:\s*([\s\S]+)$/i);
 if(!m)return null;if(m[3].length>6000)throw new Error('Keep shared captures under 6,000 characters.');
 return {kind:(m[1]||m[2]).toLowerCase(),title:m[3].trim().slice(0,120),body:m[3].trim()};
}
export async function previewShared(input:string):Promise<SharedPreview|null>{
 const intent=sharedIntent(input);if(!intent)return null;
 let selected:any;try{selected=JSON.parse(localStorage.getItem('onebrain-shared-voice')||'null');}catch{}
 if(!selected?.spaceId)throw new Error('Choose a server workspace for explicit shared voice commands in Operations first.');
 const [me,list]=await Promise.all([platformApi('/me'),platformApi('/spaces')]);
 const space=list.spaces.find((s:any)=>s.id===selected.spaceId&&s.role!=='viewer');
 if(!space||selected.userId!==me.user.id)throw new Error('Shared workspace access changed. Choose a writable workspace in Operations again.');
 return {...intent,requestId:crypto.randomUUID(),spaceId:space.id,spaceName:space.name,userId:me.user.id,firstRun:Date.now()+300000};
}
export async function saveShared(preview:SharedPreview,isCurrent:()=>boolean=()=>true){
 const me=await platformApi('/me');if(!isCurrent())throw new Error('Shared upload cancelled before dispatch.');if(me.user.id!==preview.userId)throw new Error('Server account changed. Review this shared capture again.');
 if(preview.kind==='reminder'){
  const result=await platformApi(`/spaces/${preview.spaceId}/jobs`,'POST',{requestId:preview.requestId,action:'local.notify',payload:{title:preview.title,body:preview.body},plan:{name:preview.title,firstRun:preview.firstRun,maxRuns:1,everyMinutes:0}});
  return `Reminder draft ${result.id} saved in ${preview.spaceName}. It is not scheduled for execution until an owner or admin reviews and approves it in Operations.`;
 }
 await platformApi(`/spaces/${preview.spaceId}/import`,'POST',{importId:preview.requestId,records:[{id:preview.requestId,kind:preview.kind,title:preview.title,data:{body:preview.body,status:'active',links:[],dependencies:[]}}]});
 return `Saved one shared ${preview.kind} in ${preview.spaceName}. Members of that server workspace can read it. No external app was changed.`;
}
