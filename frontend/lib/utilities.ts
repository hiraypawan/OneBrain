export function convertUnit(amount:number,from:string,to:string):number {
 if(!Number.isFinite(amount))throw new Error('Use a finite number.');
 const units:Record<string,[string,number]>={m:['length',1],km:['length',1000],cm:['length',.01],mm:['length',.001],in:['length',.0254],ft:['length',.3048],mi:['length',1609.344],kg:['mass',1],g:['mass',.001],lb:['mass',.45359237],oz:['mass',.028349523125],l:['volume',1],ml:['volume',.001],s:['time',1],min:['time',60],h:['time',3600],day:['time',86400]};
 let result:number;
 if(['C','F','K'].includes(from)&&['C','F','K'].includes(to)){
  const c=from==='C'?amount:from==='F'?(amount-32)*5/9:amount-273.15;
  if(c < -273.15000001)throw new Error('Temperature is below absolute zero.');
  result=to==='C'?c:to==='F'?c*9/5+32:c+273.15;
 }else{const a=units[from],b=units[to];if(!a||!b||a[0]!==b[0])throw new Error('Choose units of the same measurement type.');result=amount*a[1]/b[1];}
 if(!Number.isFinite(result))throw new Error('Result is outside the supported range.');return Number(result.toPrecision(12));
}
export function calendarDay(value:string):number{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Use an ISO calendar date.');
 const time=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)throw new Error('Invalid calendar date.');return time;
}
export function dateDifference(from:string,to:string){return (calendarDay(to)-calendarDay(from))/86400000;}
export function addDays(date:string,days:number){if(!Number.isInteger(days)||Math.abs(days)>365000)throw new Error('Use a bounded whole number of days.');const result=new Date(calendarDay(date)+days*86400000);if(!Number.isFinite(result.getTime())||result.getUTCFullYear()<1||result.getUTCFullYear()>9999)throw new Error('Result is outside supported dates.');return result.toISOString().slice(0,10);}
export interface Timer {id:string;label:string;remaining:number;deadline:number|null;done:boolean}
export function timerRemaining(timer:Timer,now=Date.now()){return timer.deadline===null?timer.remaining:Math.max(0,timer.deadline-now);}
export function pauseTimer(timer:Timer,now=Date.now()):Timer{return {...timer,remaining:timerRemaining(timer,now),deadline:null};}
export function resumeTimer(timer:Timer,now=Date.now()):Timer{return {...timer,deadline:now+timer.remaining,done:false};}
