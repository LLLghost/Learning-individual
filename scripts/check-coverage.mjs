import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const source = await readFile(resolve(root, 'public/course.html'), 'utf8');
const map = JSON.parse(await readFile(resolve(root, 'quality/coverage-map.json'), 'utf8'));
const scriptJson = (id) => JSON.parse(source.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))?.[1] ?? 'null');
const bank = scriptJson('study-data');
const quick = scriptJson('chapter-quick-data');
const lessons = scriptJson('lesson-quick-data');
const labs = scriptJson('lab-data');
const expected = new Map();
const add = (id, kind, module, chapter) => {
  if (expected.has(id)) throw new Error(`Duplicate assessment ID: ${id}`);
  expected.set(id, { kind, module, chapter });
};
for (const item of bank.items) add(item.id, 'item', item.module);
for (const scenario of bank.cases) scenario.stages.forEach((_, index) => add(`${scenario.id}:${index}`, 'stage', scenario.module));
for (const lab of labs.labs) add(`${lab.id}#why`, 'lab', lab.module);
for (const [chapter, slots] of Object.entries(quick)) for (const pool of slots) for (const item of pool) add(item.id, 'quick', null, Number(chapter));
for (const [lesson, slots] of Object.entries(lessons)) for (const pool of slots) for (const item of pool) add(item.id, 'lesson', null, `s${lesson}`);

const failures = [];
const seen = new Set();
const pageCache = new Map();
const plain = (value) => value
  .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
  .replace(/&(?:nbsp|amp|lt|gt|quot);/g, (entity) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' })[entity])
  .replace(/\s+/g, ' ').trim();
const pageFor = async (chapter) => {
  const key = String(chapter);
  if (!pageCache.has(key)) {
    const path = key.startsWith('s')
      ? `build/start/${key.slice(1).padStart(2, '0')}/index.html`
      : `build/chapters/${key.padStart(2, '0')}/index.html`;
    pageCache.set(key, await readFile(resolve(root, path), 'utf8'));
  }
  return pageCache.get(key);
};
for (const entry of map.entries) {
  const spec = expected.get(entry.id);
  if (!spec) { failures.push(`${entry.id}: no assessment with this ID`); continue; }
  if (seen.has(entry.id)) { failures.push(`${entry.id}: duplicate coverage entry`); continue; }
  seen.add(entry.id);
  if (entry.kind !== spec.kind || (spec.module != null && entry.module !== spec.module) || (spec.chapter != null && entry.chapter !== spec.chapter)) {
    failures.push(`${entry.id}: coverage identity differs from assessment`);
  }
  const page = await pageFor(entry.chapter);
  const anchor = `id="${entry.source}"`;
  const position = page.indexOf(anchor);
  if (position < 0) { failures.push(`${entry.id}: section ${entry.source} is absent in chapter ${entry.chapter}`); continue; }
  if (entry.reviewed === true) {
    const after = page.slice(position + anchor.length);
    const nextHeading = after.search(/<h[23]\b/);
    const section = nextHeading < 0 ? after : after.slice(0, nextHeading);
    if (!entry.evidence || !plain(section).includes(plain(entry.evidence))) {
      failures.push(`${entry.id}: reviewed evidence is absent in section ${entry.source}`);
    }
  }
  if (spec.module != null) {
    const moduleAnchor = `id="ch${String(spec.module).padStart(2, '0')}"`;
    const moduleStart = page.indexOf(moduleAnchor);
    const next = moduleStart < 0 ? -1 : page.indexOf('<h2 ', moduleStart + moduleAnchor.length);
    if (moduleStart < 0 || position < moduleStart || (next >= 0 && position >= next)) {
      failures.push(`${entry.id}: section ${entry.source} is outside U${String(spec.module).padStart(2, '0')}`);
    }
  }
}
for (const id of expected.keys()) if (!seen.has(id)) failures.push(`${id}: no source section`);
if (map.schema !== 'course-coverage-v1') failures.push('unknown coverage-map schema');
const pending = map.entries.filter((entry) => entry.reviewed !== true);
if (process.argv.includes('--strict') && pending.length) failures.push(`${pending.length} links await editorial confirmation`);
if (failures.length) throw new Error(`Coverage check failed:\n${failures.slice(0, 30).join('\n')}`);
console.log(`Coverage: ${seen.size}/${expected.size} assessment points have existing chapter sections; editorial pending: ${pending.length}.`);
