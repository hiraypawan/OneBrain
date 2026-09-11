// Development only. Production uses the Worker's scheduled() event and configured cron trigger.
let running=false;
async function tick(){if(running)return;running=true;try{const r=await fetch('http://127.0.0.1:8787/__scheduled?cron=*/5+*+*+*+*',{signal:AbortSignal.timeout(60000)});console.log(new Date().toISOString(),r.ok?'Local scheduler tick completed':`Scheduler returned ${r.status}`);}catch{console.log('Local scheduler unavailable; durable jobs remain in D1.');}finally{running=false;}}
void tick();setInterval(tick,300000);
