import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(process.cwd(), 'build');
// Тот же базовый путь, с которым собирался сайт: ссылки на страницах начинаются
// с него, а файлы по-прежнему лежат в корне build.
const BASE = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');
const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
};
const htmlFiles = await walk(root);
const cache = new Map();
for (const file of htmlFiles) cache.set(file, await readFile(file, 'utf8'));
const failures = [];
const targetFile = (current, pathname) => {
  if (!pathname) return current;
  const decoded = decodeURIComponent(pathname);
  if (BASE && decoded === BASE) return resolve(root, 'index.html');
  if (decoded.startsWith('/')) {
    if (BASE && !decoded.startsWith(`${BASE}/`)) return resolve(root, 'missing-base-prefix');
    const rooted = BASE ? decoded.slice(BASE.length) : decoded;
    return resolve(root, rooted.slice(1), rooted.endsWith('/') ? 'index.html' : '');
  }
  return resolve(dirname(current), decoded, decoded.endsWith('/') ? 'index.html' : '');
};

for (const [file, html] of cache) {
  if (!html.includes('data-notes-toggle') || !html.includes('data-notes-panel')) failures.push(`${file}: missing reader notebook controls`);
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (/^(?:https?:|mailto:|javascript:)/.test(href)) continue;
    const [pathAndQuery, anchor] = href.split('#');
    const pathname = pathAndQuery.split('?')[0];
    const target = targetFile(file, pathname);
    try {
      if (!(await stat(target)).isFile()) failures.push(`${file}: missing ${href}`);
      else if (anchor) {
        const targetHtml = cache.get(target) ?? await readFile(target, 'utf8');
        if (!targetHtml.includes(`id="${anchor}"`)) failures.push(`${file}: missing anchor ${href}`);
      }
    } catch { failures.push(`${file}: missing ${href}`); }
  }
}

const assessment = cache.get(resolve(root, 'assessment', 'index.html'));
const siteJs = await readFile(resolve(root, 'assets', 'site.js'), 'utf8');
const siteCss = await readFile(resolve(root, 'assets', 'site.css'), 'utf8');
if (!siteJs.includes('server-infrastructure-reader-v1') || !siteJs.includes('data-highlight-color')) failures.push('site.js: missing reader notebook behavior');
if (!siteCss.includes('.notes-panel') || !siteCss.includes('.reader-highlight')) failures.push('site.css: missing reader notebook styles');
if (!siteJs.includes('recordQuickCheck') || !siteCss.includes('.chapter-trainer')) failures.push('assets: missing chapter trainer behavior or styles');
// Полнотекстовый поиск: индекс собран по всем маршрутам и доступен с каждой страницы.
if (!siteJs.includes('loadSearchIndex') || !siteCss.includes('.search-panel')) failures.push('assets: missing full-text search behavior or styles');
try {
  const searchIndex = JSON.parse(await readFile(resolve(root, 'assets', 'search.json'), 'utf8'));
  const indexedRoutes = new Set(searchIndex.map((entry) => entry.u));
  if (searchIndex.length < 400) failures.push(`search index: only ${searchIndex.length} sections`);
  if (indexedRoutes.size !== htmlFiles.length) failures.push(`search index: covers ${indexedRoutes.size} of ${htmlFiles.length} routes`);
  const malformed = searchIndex.filter((entry) => !entry.u || !entry.h || !entry.x);
  if (malformed.length) failures.push(`search index: ${malformed.length} sections without url, heading or text`);
  for (const entry of searchIndex) {
    if (entry.a && !cache.get(resolve(root, entry.u.slice(1), 'index.html'))?.includes(`id="${entry.a}"`)) {
      failures.push(`search index: dangling anchor ${entry.u}#${entry.a}`);
      break;
    }
  }
} catch { failures.push('assets: missing or invalid search.json'); }
for (const [file, html] of cache) {
  if (!html.includes('data-search-open')) failures.push(`${file}: missing site search entry point`);
}
// Справочник терминов: база должна быть встроена в site.js и содержать глоссарий целиком.
const termsMatch = siteJs.match(/const TERMS=(\[[\s\S]*?\]);\r?\nconst defineCard/);
if (!termsMatch) failures.push('site.js: missing term reference base');
else {
  const terms = JSON.parse(termsMatch[1]);
  if (terms.length < 200) failures.push(`site.js: term base too small (${terms.length})`);
  for (const required of ['NUMA', 'iowait', 'Multipath', 'Readiness probe', 'Page cache']) {
    if (!terms.some((entry) => entry.term === required)) failures.push(`term base: missing "${required}"`);
  }
  const broken = terms.filter((entry) => !entry.html || (entry.chapter !== null && !(entry.chapter >= 0 && entry.chapter <= 27)));
  if (broken.length) failures.push(`term base: ${broken.length} entries with empty text or bad chapter`);
}
if (!siteCss.includes('.define-card')) failures.push('site.css: missing definition card styles');
for (let number = 0; number < 28; number += 1) {
  const chapter = cache.get(resolve(root, 'chapters', String(number).padStart(2, '0'), 'index.html'));
  if (!chapter?.includes(`data-chapter-trainer="${number}"`)) failures.push(`chapter ${number}: missing quick trainer`);
  const count = chapter?.match(/data-trainer-question=/g)?.length ?? 0;
  if (count !== 2) failures.push(`chapter ${number}: expected 2 quick questions, got ${count}`);
  // Верный ответ мини-тренажёра не печатается в разметку открытым номером.
  for (const match of chapter?.matchAll(/data-answer="([^"]*)"/g) ?? []) {
    if (/^\d+$/.test(match[1])) failures.push(`chapter ${number}: quick trainer prints the answer index in the markup`);
  }
}
// Практикум нумеруется по академическим модулям U00–U30, а главы — отдельно.
// Ссылка «Теория» с работы L<N> обязана вести в ту главу, внутри которой физически
// находится заголовок модуля U<N>, иначе связка практикума и теории разъезжается.
const MODULE_COUNT = 31;
const chapterHtml = Array.from({ length: 28 }, (_, number) => cache.get(resolve(root, 'chapters', String(number).padStart(2, '0'), 'index.html')));
const linkedModules = new Set();
for (let number = 0; number < MODULE_COUNT; number += 1) {
  const padded = String(number).padStart(2, '0');
  const owner = chapterHtml.findIndex((html) => html?.includes(`id="ch${padded}"`));
  if (owner < 0) { failures.push(`module ch${padded}: not found in any chapter page`); continue; }
  const lab = cache.get(resolve(root, 'labs', padded, 'index.html'));
  const expected = `<a href="${BASE}/chapters/${String(owner).padStart(2, '0')}/">Теория: глава ${String(owner).padStart(2, '0')}</a>`;
  if (!lab?.includes(expected)) failures.push(`lab ${padded}: theory link must point to chapter ${String(owner).padStart(2, '0')} (module U${padded} lives there)`);
}
for (const html of chapterHtml) {
  if (!html?.includes('class="chapter-practice"')) failures.push('chapter: missing practicum bridge');
  for (const match of html?.matchAll(/href="[^"]*\/assessment\/\?module=(\d+)"/g) ?? []) linkedModules.add(Number(match[1]));
  for (const match of html?.matchAll(/href="[^"]*\/labs\/(\d+)\//g) ?? []) linkedModules.add(Number(match[1]));
}
for (let number = 0; number < MODULE_COUNT; number += 1) {
  if (!linkedModules.has(number)) failures.push(`module ${number}: unreachable from any chapter page`);
}
// Каждая глава, кроме нулевой, разбирает одно типичное заблуждение.
for (let number = 1; number < 28; number += 1) {
  const html = chapterHtml[number];
  if (!html?.includes('Типичная ошибка')) failures.push(`chapter ${number}: missing misconception block`);
}
// Разобранный пример объявлен во введении как схема из пяти шагов. Глава 27 устроена
// иначе (последовательность аварий), у главы 00 разбора нет — остальные обязаны схему держать.
const WORKED_EXAMPLE_STEPS = ['Ситуация', 'Стратегия', 'Действия', 'Интерпретация', 'Вывод'];
for (let number = 1; number < 27; number += 1) {
  const html = chapterHtml[number] ?? '';
  const headings = Array.from(html.matchAll(/<h([23])[^>]*>(.*?)<\/h\1>/gs))
    .map((match) => ({ level: Number(match[1]), text: match[2].replace(/<[^>]+>/g, '').trim() }));
  const start = headings.findIndex((heading) => heading.level === 2 && heading.text.includes('Разобранный пример'));
  if (start < 0) { failures.push(`chapter ${number}: missing worked example`); continue; }
  let end = start + 1;
  while (end < headings.length && headings[end].level === 3) end += 1;
  const steps = headings.slice(start + 1, end).map((heading) => heading.text);
  const missing = WORKED_EXAMPLE_STEPS.filter((step) => !steps.includes(step));
  if (missing.length) failures.push(`chapter ${number}: worked example lacks ${missing.join(', ')}`);
}

const chapter00 = cache.get(resolve(root, 'chapters', '00', 'index.html'));
const chapter01 = cache.get(resolve(root, 'chapters', '01', 'index.html'));
if (chapter00?.includes('id="b00-s060"')) failures.push('chapter 00: next part introduction leaked into chapter 00');
if (!chapter01?.includes('id="b00-s060"')) failures.push('chapter 01: missing Part I introduction');
let bankSize = { items: 0, cases: 0 };
const dataMatch = assessment?.match(/<script type="application\/json" id="study-data">(.*?)<\/script>/s);
if (!dataMatch) failures.push('assessment: missing study-data');
else {
  const data = JSON.parse(dataMatch[1]);
  bankSize = { items: data.items?.length ?? 0, cases: data.cases?.length ?? 0 };
  if (data.items?.length !== 93) failures.push(`assessment: expected 93 items, got ${data.items?.length}`);
  if (data.cases?.length !== 31) failures.push(`assessment: expected 31 cases, got ${data.cases?.length}`);
  // Тип задания обязан соответствовать его форме: «Расчёт» без числовых полей —
  // обычный вопрос с выбором, и обещание расчёта в таком задании ложно.
  for (const item of data.items ?? []) {
    if (item.kind === 'calculation' && !item.fields?.length) failures.push(`item ${item.id}: kind "calculation" without numeric fields`);
    if (item.kind === 'concept' && !item.options?.length) failures.push(`item ${item.id}: kind "concept" without options`);
  }
}
// --- единообразие исходника учебника ---
// Оглавление, нумерация разделов и типографика ломаются незаметно: сайт
// собирается, ссылки работают, а читатель видит два разных названия одного
// раздела или «11.9» дважды. Проверяем это на исходном документе.
const course = await readFile(resolve(process.cwd(), 'public', 'course.html'), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const mainStart = course.indexOf('<main');
const mainEnd = course.lastIndexOf('</main>');
const body = course.slice(mainStart, mainEnd);

const ids = [...course.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) failures.push(`course.html: duplicate ids ${duplicateIds.slice(0, 5).join(', ')}`);

const outline = [...body.matchAll(/<h([12])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)]
  .map((match) => ({ level: match[1], id: match[2], text: plain(match[3]) }));
const tocStart = course.indexOf('<ul id="toc">');
const tocHtml = course.slice(tocStart, course.indexOf('</ul>', tocStart));
const toc = [...tocHtml.matchAll(/<li class="level-(\d)"><a href="#([^"]+)">([\s\S]*?)<\/a><\/li>/g)]
  .map((match) => ({ level: match[1], id: match[2], text: plain(match[3]) }));
if (toc.length !== outline.length) failures.push(`course.html: table of contents has ${toc.length} items for ${outline.length} headings`);
else {
  for (const [index, entry] of toc.entries()) {
    const heading = outline[index];
    if (entry.id !== heading.id) { failures.push(`course.html: toc item ${index} points at ${entry.id}, heading is ${heading.id}`); break; }
    if (entry.level !== heading.level) failures.push(`course.html: toc level mismatch at ${entry.id}`);
    if (entry.text !== heading.text) failures.push(`course.html: toc text differs from heading ${entry.id}`);
  }
}

let currentChapter = null;
let expectedSection = 1;
for (const heading of outline) {
  if (heading.level === '1') {
    currentChapter = /^b(\d\d)$/.test(heading.id) ? Number(heading.id.slice(1)) : null;
    expectedSection = 1;
    continue;
  }
  const numbered = heading.text.match(/^(\d+)\.(\d+)([A-Z]?)\./);
  if (!numbered || currentChapter === null) continue;
  if (Number(numbered[1]) !== currentChapter) failures.push(`course.html: ${heading.id} numbered ${numbered[1]}.x inside chapter ${currentChapter}`);
  else if (!numbered[3]) {
    if (Number(numbered[2]) !== expectedSection) failures.push(`course.html: ${heading.id} is ${numbered[1]}.${numbered[2]} after ${numbered[1]}.${expectedSection - 1}`);
    expectedSection = Number(numbered[2]) + 1;
  }
}

const prose = body
  .replace(/<(pre|code|kbd|samp|script|style)\b[\s\S]*?<\/\1>/g, ' ')
  .replace(/<[^>]+>/g, ' ');
const proseRules = [
  ['straight quotation marks', /["“”]/],
  ['three dots instead of an ellipsis', /\.\.\./],
  ['hyphen used as a dash', /[а-яА-Я0-9)]\s-\s/],
  ['"алерт" instead of "оповещение"', /алерт/i],
  ['"латентность" instead of "задержка"', /латентност/i],
  ['"оверхед" instead of "накладные расходы"', /оверхед/i],
];
for (const [name, pattern] of proseRules) {
  const hit = prose.match(pattern);
  if (hit) failures.push(`course.html: ${name} — ...${prose.slice(Math.max(0, hit.index - 40), hit.index + 40).trim()}...`);
}

// Страница маршрута: чек-лист собран по всем главам, а отметки выводятся из
// прогресса — интерфейса, который проставляет дату вручную, быть не должно.
const routePage = cache.get(resolve(root, 'route', 'index.html'));
if (!routePage) failures.push('route: page is missing');
else {
  const rows = routePage.match(/data-route-row="\d+"/g)?.length ?? 0;
  if (rows !== 28) failures.push(`route: checklist has ${rows} rows for 28 chapters`);
  for (const marker of ['data-route-calendar', 'data-backup-save', 'data-backup-load']) {
    if (!routePage.includes(marker)) failures.push(`route: missing ${marker}`);
  }
  if (/<input(?![^>]*type="file")[^>]*data-route/.test(routePage)) failures.push('route: checklist must not accept manual input');
}
for (const [file, html] of cache) {
  if (!html.includes('href="/route/"') && !html.includes(`href="${BASE}/route/"`)) failures.push(`${file}: missing route link in navigation`);
}
// Итоговый контроль пересчитывается по числу модулей: расхождение знаменателя
// и порога с числом заданий даёт молча неверный результат.
if (assessment && (assessment.includes('total:28') || assessment.includes("correctCount>=24"))) {
  failures.push('assessment: final exam still scored out of 28');
}
// Шкала времени только дополняется: код не должен уметь переписать дату.
if (!siteJs.includes('stampTimeline') || !siteJs.includes("if(line.events[key])return")) {
  failures.push('site.js: timeline must be append-only');
}
if (htmlFiles.length !== 67) failures.push(`expected 67 routes, got ${htmlFiles.length}`);
if (failures.length) throw new Error(`Site validation failed:\n${failures.slice(0, 30).join('\n')}`);
console.log(`Validated ${htmlFiles.length} routes: links, anchors, ${bankSize.items} items, ${bankSize.cases} scenarios.`);
