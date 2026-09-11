import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimate} from './capacity-budget.mjs';
test('10,000 mostly local daily users fit ONLY the stated assumptions',()=>{const x=estimate();assert.equal(x.fits,true);assert.equal(x.budgets.workerRequests.estimated,31288);assert.equal(x.budgets.d1RowsWritten.estimated,66400);assert.equal(x.budgets.singleDatabaseBytes.estimated,200000000);});
test('10,000 cloud-active users exhaust budgets rather than magically becoming free',()=>{const x=estimate({cloudFraction:1});assert.equal(x.fits,false);assert.equal(x.budgets.d1RowsRead.fits,false);assert.equal(x.budgets.d1RowsWritten.fits,false);assert.equal(x.budgets.singleDatabaseBytes.fits,false);});
test('all account traffic and mutation index costs are included',()=>{assert.equal(estimate({otherRequests:60000}).fits,false);assert.equal(estimate({writeRowsPerMutation:40}).budgets.d1RowsWritten.fits,false);});
test('scheduler backlog is not represented as delivered work',()=>{const x=estimate({scheduledJobs:1000});assert.equal(x.scheduler.maxCandidatesPerDay,576);assert.equal(x.scheduler.fits,false);assert.equal(x.fits,false);});
test('rejects non-finite, negative and misspelled assumptions',()=>{for(const x of [{dailyUsers:Infinity},{cloudFraction:2},{headroom:1},{cronMinutes:0},{jobBatch:0},{otherRequests:-1},{users:2}])assert.throws(()=>estimate(x));});
