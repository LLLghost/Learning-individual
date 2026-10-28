import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {validateIntegratedLab} from './check-integrated-lab.mjs';

// An immutable real-run fixture tests the contract, not a claim about today's stand.
const actual=JSON.parse(await readFile('quality/live-labs/2026-10-28/integrated-lab.json','utf8'));
const recordedVersion=actual.metadata;
test('recorded real laboratory run passes for its recorded code version',()=>{
  assert.deepEqual(validateIntegratedLab(actual,recordedVersion),{
    variants:2,faults:12,dataRestores:4,wholeVmRestores:2,externalRoundtrips:2,nodeReboots:6,
  });
});
const corruptions=[
  ['incomplete run',r=>{r.status='running';}],
  ['missing second variant',r=>{r.variants.pop();}],
  ['non-idempotent deployment',r=>{r.variants[0].idempotentApply=false;}],
  ['undetected fault',r=>{r.variants[0].faults[0].refusal.passed=true;}],
  ['unrecovered fault',r=>{r.variants[1].faults[1].recovered=false;}],
  ['monitor never detected failure',r=>{r.variants[0].faults[0].monitorUnitObservedFailure=false;}],
  ['HTTP 200 content case missing',r=>{r.variants[0].faults.at(-1).refusal.status=404;}],
  ['external backup changed',r=>{r.variants[0].externalBackup.sha256='0'.repeat(64);}],
  ['server never rebooted',r=>{r.variants[0].bootPersistence.after=r.variants[0].bootPersistence.before;}],
  ['restored over original VM',r=>{r.variants[0].wholeVmRestore.restoredVM=r.variants[0].wholeVmRestore.sourceVM;}],
  ['wrong restored content',r=>{r.variants[0].wholeVmRestore.probe.sha256='0'.repeat(64);}],
  ['temporary restore left behind',r=>{r.variants[0].temporaryRestoredVmRemoved=false;}],
  ['cloned machine identities',r=>{const ids=Object.keys(r.variants[0].machineIds);r.variants[0].machineIds[ids[1]]=r.variants[0].machineIds[ids[0]];}],
  ['configuration history lost',r=>{r.variants[1].configurationParent='0'.repeat(40);}],
];
for(const [label,mutate] of corruptions)test(`rejects ${label}`,()=>{
  const changed=structuredClone(actual);mutate(changed);
  assert.throws(()=>validateIntegratedLab(changed,recordedVersion));
});
test('a report from another code version cannot qualify current code',()=>{
  assert.throws(()=>validateIntegratedLab(actual,{...recordedVersion,practiceSha256:'0'.repeat(64)}),/mismatch/);
});
