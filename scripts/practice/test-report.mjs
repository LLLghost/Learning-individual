import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readPracticeReport} from '../../content/course/ui/practice-report.js';
const now=Date.now(),runner='a'.repeat(64),attempt='b'.repeat(32);
const expected={lesson:'process',runnerSha256:runner,attempt,variant:0,startedAt:now-3000};
const sample={schema:'mayak-practice-report-v1',lesson:'process',attempt,variant:0,started:(now-2000)/1000,checked:now/1000,runnerSha256:runner,catalogSha256:'c'.repeat(64),guest:'d'.repeat(64),environment:{kernel:'test-kernel',host:'fixture'},passed:true,observations:'measured PID',error:''};
const envelope=data=>{const payload=JSON.stringify(data);return {schema:'mayak-practice-envelope-v1',payload,sha256:createHash('sha256').update(payload).digest('hex')};};
let count=0;
assert.equal((await readPracticeReport(envelope(sample),expected)).verified,true);count++;
for(const change of [{runnerSha256:'e'.repeat(64)},{attempt:'f'.repeat(32)},{variant:1}]){
 const r=await readPracticeReport(envelope({...sample,...change}),expected);assert.equal(r.fresh,false);assert.equal(r.verified,false);count++;
}
assert.equal((await readPracticeReport(envelope({...sample,passed:false}),expected)).verified,false);count++;
for(const offset of [-600000,600000]){
 const r=await readPracticeReport(envelope({...sample,started:(now+offset-1000)/1000,checked:(now+offset)/1000}),expected);assert.equal(r.verified,true);assert.equal(r.clockWarning,true);count++;
}
for(const change of [{lesson:'permissions'},{guest:'not-an-id'},{variant:3},{passed:'true'},{checked:0}]){
 await assert.rejects(readPracticeReport(envelope({...sample,...change}),expected));count++;
}
const corrupted=envelope(sample);corrupted.payload=corrupted.payload.replace('measured PID','invented PID');
await assert.rejects(readPracticeReport(corrupted,expected),/Контрольная сумма/);count++;
console.log(`Reports: ${count} acceptance, refusal and stale-attempt scenarios passed. Checksums are not attestations.`);
