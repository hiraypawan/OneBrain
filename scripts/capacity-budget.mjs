#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
// Estimates, not reservations, telemetry, a benchmark, or an SLA. Include all
// account workloads; calibrate row costs with D1 result.meta in an isolated test.
export const defaults={
 dailyUsers:10000,cloudFraction:0.2,pageInvocationsPerUser:2,
 identityReadsPerLocalUser:0,identityRowsPerRead:3,readsPerCloudUser:4,writesPerCloudUser:1,invocationsPerApi:1,
 dailyLogins:500,invocationsPerLogin:2,loginRowsRead:20,loginRowsWritten:20,
 readRowsPerApi:220,readRowsPerMutation:200,writeRowsPerMutation:12,
 cronMinutes:5,jobBatch:2,scheduledJobs:200,jobRowsRead:100,jobRowsWritten:12,
 maintenanceRowsRead:30000,maintenanceRowsWritten:30000,
 rowsStoredPerCloudUser:30,bytesPerStoredRow:1500,indexStorageFactor:2,
 otherRequests:0,otherRowsRead:0,otherRowsWritten:0,otherStorageBytes:20000000,headroom:0.2,
};
export function estimate(input={}) {
 const x={...defaults,...input};
 for(const [k,v] of Object.entries(x))if(!(k in defaults)||typeof v!=='number'||!Number.isFinite(v)||v<0)throw new Error(`Invalid assumption: ${k}`);
 if(x.cloudFraction>1||x.headroom>=1||!x.cronMinutes||!x.jobBatch)throw new Error('Fractions must be 0–1 and scheduler intervals/batches positive.');
 const cloudUsers=x.dailyUsers*x.cloudFraction, reads=cloudUsers*x.readsPerCloudUser,writes=cloudUsers*x.writesPerCloudUser,cron=Math.ceil(1440/x.cronMinutes),identityReads=(x.dailyUsers-cloudUsers)*x.identityReadsPerLocalUser;
 const demand={
  workerRequests:x.dailyUsers*x.pageInvocationsPerUser+(reads+writes+identityReads)*x.invocationsPerApi+x.dailyLogins*x.invocationsPerLogin+cron+x.otherRequests,
  d1RowsRead:identityReads*x.identityRowsPerRead+reads*x.readRowsPerApi+writes*x.readRowsPerMutation+x.dailyLogins*x.loginRowsRead+cron*10+x.scheduledJobs*x.jobRowsRead+x.maintenanceRowsRead+x.otherRowsRead,
  d1RowsWritten:writes*x.writeRowsPerMutation+x.dailyLogins*x.loginRowsWritten+x.scheduledJobs*x.jobRowsWritten+x.maintenanceRowsWritten+x.otherRowsWritten,
  singleDatabaseBytes:cloudUsers*x.rowsStoredPerCloudUser*x.bytesPerStoredRow*x.indexStorageFactor+x.otherStorageBytes,
 };
 // This repository binds ONE free database, not all 5 GB of account storage.
 const limits={workerRequests:100000,d1RowsRead:5000000,d1RowsWritten:100000,singleDatabaseBytes:500000000};
 const budgets=Object.fromEntries(Object.entries(limits).map(([k,v])=>[k,{estimated:Math.ceil(demand[k]),limit:v,operatingBudget:Math.floor(v*(1-x.headroom)),fits:demand[k]<=v*(1-x.headroom)}]));
 const scheduler={requested:x.scheduledJobs,maxCandidatesPerDay:cron*x.jobBatch,fits:x.scheduledJobs<=cron*x.jobBatch};
 return {assumptions:x,budgets,scheduler,fits:Object.values(budgets).every(v=>v.fits)&&scheduler.fits,notice:'An assumed daily budget, NOT proof of 10,000 concurrent users. CPU, bursts, D1 queueing, auth rate limits, abusive traffic and other account usage still need measurement.'};
}
// A throughput model, deliberately separate from the daily budget. The query
// duration must be measured on the deployed workload before drawing conclusions.
export function estimateBurst(input={}) {
 const x={concurrentUsers:10000,apiCallsPerUser:2,sqlQueriesPerApi:2.5,meanSqlMs:1,targetSeconds:5,...input};
 const allowed=['concurrentUsers','apiCallsPerUser','sqlQueriesPerApi','meanSqlMs','targetSeconds'];
 for(const [key,value] of Object.entries(x))if(!allowed.includes(key)||typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error(`Invalid burst assumption: ${key}`);
 if(!Number.isSafeInteger(x.concurrentUsers)||!x.meanSqlMs||!x.targetSeconds)throw new Error('Use an integer user count and positive timing assumptions.');
 const sqlQueries=x.concurrentUsers*x.apiCallsPerUser*x.sqlQueriesPerApi;
 const serialDatabaseSeconds=sqlQueries*x.meanSqlMs/1000;
 if(!Number.isFinite(serialDatabaseSeconds))throw new Error('Burst assumptions overflow the model.');
 return {assumptions:x,sqlQueries,serialDatabaseSeconds,requiredSqlQueriesPerSecond:sqlQueries/x.targetSeconds,idealSqlQueriesPerSecond:1000/x.meanSqlMs,fitsSerialTime:serialDatabaseSeconds<=x.targetSeconds,notice:'Hypothetical single-primary SQL service time, NOT measured concurrent users, p95 latency, CPU compliance, or an SLA. Network, Worker overhead, writes and other traffic can make it worse.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const burst=process.argv[2]==='--burst',file=process.argv[burst?3:2],input=file?JSON.parse(readFileSync(file,'utf8')):{};const result=burst?estimateBurst(input):estimate(input);console.log(JSON.stringify(result,null,2));if(!(burst?result.fitsSerialTime:result.fits))process.exitCode=2;}
 catch(e){console.error(e.message);process.exitCode=1;}
}
