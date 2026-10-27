import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const explicitFolder = process.argv[2];
const live = JSON.parse(await readFile('quality/live-acceptance.json', 'utf8'));
if (!explicitFolder && (live.status !== 'accepted' || !live.evidenceDirectory)) {
  throw Error('No current accepted live evidence directory. Historical reports require an explicit folder.');
}
const folder = resolve(explicitFolder ?? live.evidenceDirectory);
const bank = JSON.parse(await readFile('content/course/assessments.json', 'utf8'));
const { labValid, labRows } = await import(pathToFileURL(resolve('build/assets/checker.js')).href);
const labs = bank.labs.filter(lab => lab.kind !== 'dataset');
let reports = 0;
for (const lab of labs) {
  for (const variant of (explicitFolder ? [null] : [0, 1])) {
    const file = variant === null ? `${lab.id}.json` : `legacy/${lab.id}/${variant}.json`;
    const report = JSON.parse(await readFile(resolve(folder, file), 'utf8'));
    const rows = labRows(report, lab);
    let negative = 0;
    lab.checks.forEach((check, index) => {
      const altered = structuredClone(report);
      if (check.field) altered.claim[check.field] = '__wrong__';
      else if (check.fact) altered.facts[check.fact] = null;
      if (labRows(altered, lab)[index]?.ok === false) negative++;
    });
    const valid = report.lab === lab.id && labValid(report)
      && (explicitFolder || report.collector_sha256 === live.collectorSha256);
    const passed = rows.filter(row => row.ok).length;
    console.log(`${lab.id}/${variant ?? 'historical'}: ${passed}/${rows.length} accepted; ${negative}/${lab.checks.length} alterations rejected; format/source ${valid ? 'OK' : 'FAIL'}`);
    if (!valid || passed !== rows.length || negative !== lab.checks.length) process.exitCode = 1;
    reports++;
  }
}
console.log(`Verified ${reports} ${explicitFolder ? 'explicit-folder (possibly historical)' : 'current live'} reports with the published checker. Browser import is recorded separately.`);
