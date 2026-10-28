import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const [manifest, curriculum, review] = await Promise.all([
  'content/course/manifest.json', 'content/course/infrastructure.json', 'quality/infrastructure-rewrite-review.json',
].map(json));
const sha = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
assert.equal(review.mode, 'author-self-review');
assert.equal(review.humanLearning, false);
assert.equal(review.integrationLiveAccepted, false);
assert.equal(review.curriculumSha256, sha(await readFile('content/course/infrastructure.json', 'utf8')));
assert.equal(review.foundationAssessmentsSha256, sha(await readFile('content/course/editorial/foundation-assessments.json', 'utf8')));
assert.deepEqual(Object.keys(curriculum.units).sort(), manifest.units.map(unit => unit.id).sort());
assert.deepEqual(Object.keys(curriculum.lessons).sort(), manifest.lessons.map(lesson => lesson.id).sort());
for (const unit of manifest.units) {
  const stage = curriculum.units[unit.id];
  assert.ok(stage.result.length > 40 && stage.task.length > 80, unit.id);
  assert.ok(stage.artifacts.length >= 2 && stage.checks.length >= 2, unit.id);
}
for (const lesson of manifest.lessons) {
  const body = await readFile(`content/course/${lesson.file}`, 'utf8');
  assert.equal(review.lessons[lesson.id].sha256, sha(body), `${lesson.id}: infrastructure review is stale`);
  assert.equal((body.match(/data-infrastructure-role/g) ?? []).length, 1, lesson.id);
  assert.equal((body.match(/data-infrastructure-transfer/g) ?? []).length, 1, lesson.id);
  assert.ok(body.includes(`/laboratory/#milestone-${lesson.unit}`), lesson.id);
  assert.equal(curriculum.lessons[lesson.id].length, 3);
  assert.ok(!body.includes('Страница заметок и выделенные ресурсы текущего опыта.'), lesson.id);
}
const plan = await readFile('build/laboratory/index.html', 'utf8');
assert.equal((plan.match(/data-milestone=/g) ?? []).length, manifest.units.length);
const portable = await readFile('public/practical-course.html', 'utf8');
assert.ok(portable.includes('id="milestone-final"'), 'Portable book must contain the full laboratory plan');
console.log(`Infrastructure curriculum: ${manifest.lessons.length} reviewed roles/transfers, ${manifest.units.length} milestones, full plan in printable book. Structural evidence only; integrated live/human acceptance remains separate.`);
