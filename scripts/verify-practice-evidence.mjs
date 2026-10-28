import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readPracticeReport} from '../content/course/ui/practice-report.js';
import {validateIntegratedLab} from './check-integrated-lab.mjs';

const json=async path=>JSON.parse(await readFile(path,'utf8'));
export async function verifyPracticeEvidence(folder) {
  const course=await json('build/assets/course-data.json');
  const plans=await json(resolve(folder,'attempts.json'));
  const cycles=await json(resolve(folder,'guest-cycles.json'));
  assert.equal(cycles.runnerSha256,course.practiceRunnerSha256);
  assert.equal(cycles.results.length,45);
  for(const row of cycles.results) {
    assert.equal(row.status,'passed');assert.equal(row.variants.length,2);
    for(const [index,variant] of row.variants.entries()) {
      assert.equal(variant.variant,index);assert.equal(variant.passed,true);
      assert.equal(variant.attempt,plans[row.lesson][index].attempt);
      assert.deepEqual(variant.phases.map(phase=>phase.action),['prepare','check','solve','check','restore','restore']);
      assert.notEqual(variant.phases[1].code,0);
      assert.ok(variant.phases.filter((_,i)=>i!==1).every(phase=>phase.code===0));
    }
  }
  const archive=resolve(folder,'guest-reports.tgz');
  const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8',maxBuffer:2e6}).split(/\r?\n/).filter(name=>name.endsWith('.json'));
  const reports=new Map();
  for(const name of names) {
    const body=execFileSync('tar',['-xOzf',archive,'--',name],{encoding:'utf8',maxBuffer:2e6});
    reports.set(name.replace(/^\.\//,''),JSON.parse(body));
  }
  let accepted=0,refused=0,revoked=0;
  for(const [lesson,spec] of Object.entries(course.practiceLabs)) {
    for(const variant of [0,1]) {
      const plan=plans[lesson][variant];
      assert.equal(plan.variant,variant);
      const expected={lesson,...plan,runnerSha256:spec.runnerSha256??course.practiceRunnerSha256};
      const envelope=lesson==='vm-backup'?await json(resolve(folder,`vm-backup-${variant}.json`)):reports.get(`${lesson}-${variant}.json`);
      const positive=await readPracticeReport(envelope,expected);
      assert.equal(positive.verified,true,`${lesson}/${variant}: report not fresh/passed`);accepted++;
      if(lesson!=='vm-backup') {
        const negative=await readPracticeReport(reports.get(`${lesson}-${variant}-negative.json`),expected);
        assert.equal(negative.fresh,true);
        assert.equal(negative.verified,false,`${lesson}/${variant}: unsolved task accepted`);refused++;
      }
      if(['process','systemd','container-network'].includes(lesson)) {
        const changed=await readPracticeReport(reports.get(`${lesson}-${variant}-after-change.json`),expected);
        assert.equal(changed.fresh,true);assert.equal(changed.verified,false);revoked++;
      }
    }
  }
  assert.equal(accepted,92);assert.equal(refused,90);assert.equal(revoked,6);
  const browser=await json(resolve(folder,'browser-reports.json'));
  assert.equal(browser.length,92);
  assert.ok(browser.every(row=>row.accepted&&row.newAttemptRevokes&&row.oldReportHistorical));
  assert.equal(browser.filter(row=>row.changedSystemRefused&&row.oldSuccessReplayRefused).length,6);
  const native=await json(resolve(folder,'backup-acceptance.json'));
  assert.equal(native.results.length,2);
  for(const run of native.results) {
    assert.equal(run.status,'passed');
    assert.equal(run.phases.length,9);
    assert.notEqual(run.phases[1].code,0,'Unsolved native backup accepted');
    assert.ok(run.phases.filter((_,index)=>index!==1).every(phase=>phase.code===0));
    assert.match(run.archiveSha256,/^[a-f0-9]{64}$/);
  }
  const legacyBrowser=await json(resolve(folder,'legacy-browser.json'));
  assert.equal(legacyBrowser.length,18);
  assert.ok(legacyBrowser.every(row=>row.negativeRefused&&row.reportAccepted),'Legacy report import/refusal failed');
  const legacy=await json(resolve(folder,'legacy-cycles.json'));
  assert.equal(legacy.collectorSha256,course.collectorSha256);
  assert.equal(legacy.results.length,9);
  for(const row of legacy.results) {
    assert.equal(row.variants.length,2);
    for(const [index,variant] of row.variants.entries()) {
      assert.equal(variant.variant,index);assert.equal(variant.status,'collected');
      assert.equal(variant.phases.at(-1).code,0,'Legacy cleanup failed');
      assert.equal(legacyBrowser.filter(result=>result.lab===row.lab&&result.variant===index&&result.reportAccepted&&result.negativeRefused).length,1);
    }
  }
  const integrated=await json(resolve(folder,'integrated-lab.json'));
  const integration=validateIntegratedLab(integrated,course);
  for(const variant of integrated.variants) {
    const bytes=await readFile(resolve(folder,`external-backups/data-${variant.variant}.tar`));
    assert.equal(bytes.length,variant.externalBackup.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),variant.externalBackup.sha256,'External archive bytes differ from actual roundtrip');
  }
  console.log(`Fresh practice evidence: ${accepted} passed reports, ${refused} unsolved refusals, ${revoked} changed-system refusals; 92 browser imports.`);
  console.log(`Integrated laboratory: ${integration.variants} variants, ${integration.faults} faults, ${integration.wholeVmRestores} full-VM restores, ${integration.externalRoundtrips} off-host roundtrips.`);
}
