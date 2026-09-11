export function prepareVoiceInput(text:string,settings:{wakePhrase?:boolean;speechAliases?:Record<string,string>}):string|null{
 let input=text.trim();
 if(settings.wakePhrase && !/^(stop|stop listening|pause|pause session|pause listening)$/i.test(input)){
  const match=input.match(/^(?:hey\s+)?one\s*brain[\s,.:]+([\s\S]+)$/i);if(!match)return null;input=match[1];
 }
 const aliases=settings.speechAliases;
 if(aliases&&typeof aliases==='object'&&!Array.isArray(aliases))for(const [heard,canonical]of Object.entries(aliases).slice(0,20).sort((a,b)=>b[0].length-a[0].length)){
  if(!heard.trim()||heard.length>80||typeof canonical!=='string'||canonical.length>120)continue;
  const safe=heard.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  input=input.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${safe}(?=$|[^\\p{L}\\p{N}])`,'giu'),(_match,prefix)=>prefix+canonical);
 }
 return input;
}
