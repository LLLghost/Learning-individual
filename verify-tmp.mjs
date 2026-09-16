// Вердикт считаем той же labRows, что стоит в кабинете.
import { readFile } from 'node:fs/promises';
const page = await readFile('build/assessment/index.html', 'utf8');
const labs = JSON.parse(page.match(/id="lab-data">([\s\S]*?)<\/script>/)[1]).labs;
const hash = page.match(/const labHash=[^\n]*\n/)[0];
const ops = page.match(/const labExpected=[\s\S]*?const labRows=[\s\S]*?\n\};\n/)[0];
const { labRows } = new Function(`${hash}${ops}; return { labRows };`)();
const lab = labs.find((l) => l.id === 'L16B');
const base = {
  schema: 'course-lab-report', version: JSON.parse(page.match(/id="lab-data">([\s\S]*?)<\/script>/)[1]).version,
  lab: 'L16B', module: 'U16', kind: 'collect', seed: 'x', variant: 0,
  facts: {
    health: 'ONLINE', scrub_finished: true, scrub_is_new: true, errors_zero: true,
    snapshot_present: true, received_present: true, pools_differ: true,
    restored_readable: true, restored_on_target: true, restored_pool: 'backup',
    source_sha256: 'a1b2c3', restored_sha256: 'a1b2c3',
  },
  claim: { snapshot: 'tank/app@before', received: 'backup/app@before', restored_file: '/backup/app/control.bin' },
};
const show = (name, patch) => {
  const report = structuredClone(base);
  Object.assign(report.facts, patch);
  const rows = labRows(report, lab);
  const failed = rows.filter((r) => !r.ok);
  console.log(`${failed.length === 0 ? 'ЗАЧЁТ ' : 'не зачёт'} ${name}${failed.length ? ' — не прошло: ' + failed.map((r) => r.name).join('; ') : ''}`);
  return failed.length === 0;
};
let bad = 0;
if (!show('работа выполнена целиком', {})) bad += 1;
for (const [name, patch] of [
  ['снимок не передан', { received_present: false }],
  ['файл не восстановлен', { restored_readable: false, restored_on_target: false, restored_sha256: null }],
  ['указан исходный файл', { restored_on_target: false, restored_pool: 'tank' }],
  ['содержимое файла изменено', { restored_sha256: 'deadbeef' }],
  ['исходный и целевой пул совпали', { pools_differ: false }],
  ['scrub старый', { scrub_is_new: false }],
  ['обе суммы отсутствуют', { source_sha256: null, restored_sha256: null }],
  ['обе суммы — пустые строки', { source_sha256: '', restored_sha256: '' }],
  ['пул не в порядке', { health: 'DEGRADED' }],
]) if (show(name, patch)) bad += 1;
// И по очереди каждый обязательный факт.
const blind = [];
for (const field of Object.keys(base.facts)) {
  const report = structuredClone(base);
  const was = report.facts[field];
  report.facts[field] = typeof was === 'boolean' ? !was : (was === 'ONLINE' ? 'FAULTED' : 'иное');
  if (labRows(report, lab).every((r) => r.ok)) blind.push(field);
}
console.log(blind.length ? 'факты без проверки: ' + blind.join(', ') : 'каждый факт влияет на вердикт');
console.log(bad ? `ОШИБОК: ${bad}` : 'все сценарии отработали как ожидалось');
