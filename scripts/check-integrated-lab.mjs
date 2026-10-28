import assert from 'node:assert/strict';

const SHA=/^[a-f0-9]{64}$/;
const FAULTS=['stopped-process','network-filter','wrong-dns-record','data-permission','lost-data','corrupt-content-with-http-200'];

export function validateIntegratedLab(report, expected) {
  assert.equal(report.schema,'mayak-integrated-lab-v1','Integrated report schema');
  assert.equal(report.status,'passed','Integrated run is incomplete');
  assert.equal(report.stage,'complete','Integrated run did not finish');
  for(const key of ['sourceSha256','collectorSha256','checkerSha256','practiceSha256','practiceRunnerSha256']) {
    assert.match(report.metadata[key],SHA,`Missing integrated version: ${key}`);
    assert.equal(report.metadata[key],expected[key],`Integrated code/content mismatch: ${key}`);
  }
  assert.match(report.metadata.commit,/^[a-f0-9]{40}$/,'Integrated commit');
  assert.equal(report.variants.length,2,'Two independent variants are required');
  for(const [index,variant] of report.variants.entries()) {
    assert.equal(variant.variant,index);
    assert.equal(variant.status,'passed',`Variant ${index}`);
    assert.match(variant.dataSha256,SHA);
    assert.equal(Object.keys(variant.machineIds).length,3);
    assert.equal(new Set(Object.values(variant.machineIds)).size,3,'Independent guest identities');
    for(const key of ['idempotentApply','untrustedCaRefused','wrongTlsNameRefused','unauthorizedClientRefused','temporaryRestoredVmRemoved']) assert.equal(variant[key],true,`${index}: ${key}`);
    assert.equal(variant.initialProbe.passed,true);
    assert.equal(variant.initialProbe.sha256,variant.dataSha256);
    assert.deepEqual(variant.faults.map(fault=>fault.name),FAULTS,`${index}: incomplete fault coverage`);
    for(const fault of variant.faults) {
      assert.equal(fault.refusal.passed,false,`${index}/${fault.name}: fault was not detected`);
      assert.equal(fault.recovered,true,`${index}/${fault.name}: recovery not verified`);
    }
    assert.equal(variant.faults[0].monitorUnitObservedFailure,true,'Monitoring must observe a real failure');
    assert.equal(variant.faults.at(-1).refusal.status,200,'Corrupt content must be rejected even with HTTP 200');
    assert.match(variant.dataBackup.archiveSha256,SHA);
    assert.equal(variant.externalBackup.sha256,variant.dataBackup.archiveSha256,'Off-host roundtrip bytes changed');
    assert.ok(variant.externalBackup.bytes>0);
    assert.notEqual(variant.bootPersistence.before,variant.bootPersistence.after,'Server did not reboot');
    assert.equal(variant.bootPersistence.probe.passed,true);
    assert.equal(Object.keys(variant.peerBootPersistence).length,2);
    for(const boot of Object.values(variant.peerBootPersistence)) assert.notEqual(boot.before,boot.after);
    const restore=variant.wholeVmRestore;
    assert.equal(restore.sourceVM,report.metadata.guestVM);
    assert.notEqual(restore.sourceVM,restore.restoredVM,'Restore must use a separate VM');
    assert.match(restore.archiveSha256,SHA);
    assert.ok(restore.seconds>0);
    assert.equal(restore.probe.passed,true);
    assert.equal(restore.probe.sha256,variant.dataSha256,'Restored VM returned different data');
    assert.equal(variant.finalProbe.passed,true);
    assert.equal(variant.finalProbe.sha256,variant.dataSha256);
    assert.match(variant.configurationCommit,/^[a-f0-9]{40}$/);
  }
  assert.notEqual(report.variants[0].dataSha256,report.variants[1].dataSha256,'Variants must use different control data');
  assert.equal(report.variants[1].configurationParent,report.variants[0].configurationCommit,'Configuration history was not preserved');
  return {variants:2,faults:12,dataRestores:4,wholeVmRestores:2,externalRoundtrips:2,nodeReboots:6};
}
