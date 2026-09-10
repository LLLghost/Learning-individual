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
  const broken = terms.filter((entry) => !entry.html || (entry.chapter !== null && !(entry.chapter >= 0 && entry.chapter <= 33)));
  if (broken.length) failures.push(`term base: ${broken.length} entries with empty text or bad chapter`);
}
if (!siteCss.includes('.define-card')) failures.push('site.css: missing definition card styles');
for (let number = 0; number < 34; number += 1) {
  const chapter = cache.get(resolve(root, 'chapters', String(number).padStart(2, '0'), 'index.html'));
  if (!chapter?.includes(`data-chapter-trainer="${number}"`)) failures.push(`chapter ${number}: missing quick trainer`);
  const count = chapter?.match(/data-trainer-question=/g)?.length ?? 0;
  if (count !== 2) failures.push(`chapter ${number}: expected 2 quick questions, got ${count}`);
  // Свободное воспроизведение идёт до мини-тренажёра: узнавание вариантов, увиденное
  // первым, подсказывает формулировки и обесценивает попытку вспомнить.
  if (!chapter?.includes(`data-chapter-recall="${number}"`)) failures.push(`chapter ${number}: missing free-recall block`);
  else if (chapter.indexOf('data-chapter-recall=') > chapter.indexOf('data-chapter-trainer=')) {
    failures.push(`chapter ${number}: free recall must come before the quick trainer`);
  }
  if (/data-recall-topic[^>]*checked/.test(chapter ?? '')) failures.push(`chapter ${number}: recall topics must start unchecked`);
  // Вопрос до чтения стоит во вводной части: после первого нумерованного раздела
  // он перестаёт быть вопросом до чтения и становится обычной самопроверкой.
  const pretest = chapter?.indexOf('class="pretest"') ?? -1;
  if (pretest < 0) failures.push(`chapter ${number}: missing pre-reading question`);
  else {
    const firstSection = chapter.search(new RegExp(`<h2 id="[^"]+">${number}\\.\\d`));
    if (firstSection >= 0 && pretest > firstSection) failures.push(`chapter ${number}: pre-reading question must sit before section ${number}.1`);
  }
  // Верный ответ мини-тренажёра не печатается в разметку открытым номером.
  for (const match of chapter?.matchAll(/data-answer="([^"]*)"/g) ?? []) {
    if (/^\d+$/.test(match[1])) failures.push(`chapter ${number}: quick trainer prints the answer index in the markup`);
  }
}
// Вводная часть «Начало»: пять уроков для читателя без опыта. Она живёт вне
// нумерации глав, поэтому обычные проверки глав её не касаются — и без
// отдельных правил её падение осталось бы незамеченным.
const LESSON_COUNT = 5;
for (let number = 1; number <= LESSON_COUNT; number += 1) {
  const file = resolve(root, 'start', String(number).padStart(2, '0'), 'index.html');
  const lesson = cache.get(file);
  if (!lesson) { failures.push(`lesson ${number}: page is missing`); continue; }
  const headings = lesson.match(/<h1[^>]*>/g)?.length ?? 0;
  const expected = number === 1 ? 2 : 1;
  if (headings !== expected) failures.push(`lesson ${number}: expected ${expected} h1, got ${headings}`);
  // Урок без разбора — это чтение без проверки: свёрнутый блок «Проверьте себя»
  // единственное место, где читатель может убедиться, что понял.
  if (!lesson.includes('<summary>Проверьте себя</summary>')) failures.push(`lesson ${number}: missing the self-check block`);
}
// Последний урок обязан вести в главу 00: вводная часть кончается там, где
// начинается курс, и тупика в конце быть не должно.
const lastLesson = cache.get(resolve(root, 'start', '05', 'index.html')) ?? '';
if (!/<nav class="pager"[^>]*>[\s\S]*?href="[^"]*\/chapters\/00\/"[\s\S]*?<\/nav>/.test(lastLesson)) {
  failures.push('lesson 5: the pager must lead on to chapter 00');
}
// Вход в неё виден с главной и из программы, иначе часть существует, но её не находят.
for (const [name, file] of [['home', resolve(root, 'index.html')], ['curriculum', resolve(root, 'curriculum', 'index.html')]]) {
  if (!cache.get(file)?.includes('/start/01/')) failures.push(`${name}: no entry point into the introductory part`);
}
// Заголовок части забирает первый урок: на странице «О курсе» ему делать нечего.
if (cache.get(resolve(root, 'about', 'index.html'))?.includes('id="start-part"')) {
  failures.push('about: the introductory part heading leaked onto the about page');
}
// Практикум нумеруется по академическим модулям U00–U36, а главы — отдельно.
// Ссылка «Теория» с работы L<N> обязана вести в ту главу, внутри которой физически
// находится заголовок модуля U<N>, иначе связка практикума и теории разъезжается.
const MODULE_COUNT = 37;
const chapterHtml = Array.from({ length: 34 }, (_, number) => cache.get(resolve(root, 'chapters', String(number).padStart(2, '0'), 'index.html')));
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
for (let number = 1; number < 34; number += 1) {
  const html = chapterHtml[number];
  if (!html?.includes('Типичная ошибка')) failures.push(`chapter ${number}: missing misconception block`);
}
// Разобранный пример объявлен во введении как схема из пяти шагов. Глава 33 устроена
// иначе (последовательность аварий), у главы 00 разбора нет — остальные обязаны схему держать.
const WORKED_EXAMPLE_STEPS = ['Ситуация', 'Стратегия', 'Действия', 'Интерпретация', 'Вывод'];
for (let number = 1; number < 33; number += 1) {
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
let data = null;
const dataMatch = assessment?.match(/<script type="application\/json" id="study-data">(.*?)<\/script>/s);
if (!dataMatch) failures.push('assessment: missing study-data');
else {
  data = JSON.parse(dataMatch[1]);
  bankSize = { items: data.items?.length ?? 0, cases: data.cases?.length ?? 0 };
  if (data.items?.length !== 111) failures.push(`assessment: expected 111 items, got ${data.items?.length}`);
  if (data.cases?.length !== 37) failures.push(`assessment: expected 37 cases, got ${data.cases?.length}`);
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

// Справочник A: разделы A.1–A.24 на месте, и у каждой команды, которая меняет
// состояние, стоит пометка «Осторожно». Справочник читают в спешке и наискось —
// команда без предупреждения там опаснее, чем её отсутствие.
const appendixA = body.slice(body.indexOf('id="b33-s044"'), body.indexOf('id="b33-s053"'));
const sectionNumbers = [...appendixA.matchAll(/<h2[^>]*>A\.(\d+)\./g)].map((match) => Number(match[1]));
for (let number = 1; number <= 24; number += 1) {
  if (!sectionNumbers.includes(number)) failures.push(`course.html: appendix A is missing section A.${number}`);
}
for (const command of ['--delete', 'sed -i', '-w /tmp/capture.pcap', 'chmod -R 777', 'strace -f -p', 'ssh -N -R']) {
  const at = appendixA.indexOf(command);
  if (at < 0) { failures.push(`appendix A: lost the "${command}" entry`); continue; }
  // Предупреждение может стоять и до команды, и после неё — важно, что оно
  // есть в том же разделе, который читатель видит целиком.
  const from = appendixA.lastIndexOf('<h2', at);
  const to = appendixA.indexOf('<h2', at);
  const section = appendixA.slice(from < 0 ? 0 : from, to < 0 ? undefined : to);
  if (!section.includes('Осторожно')) failures.push(`appendix A: "${command}" changes state but its section carries no warning`);
}
// Работы практикума читает один человек за одним стендом. Пять из них
// остались от аудиторного формата и описывали двоих: «учащийся по описанному
// сценарию отключает путь; студент фиксирует деградацию» — читателю в этом
// месте непонятно, кто он и что делать. Проверяем только сами работы:
// в экзаменационных рубриках ниже «студент» — законное слово.
{
  const works = body.slice(body.indexOf('id="lab00"'), body.indexOf('id="collector-code"'));
  const classroom = [...works.matchAll(/(?:^|[^а-яё])(учащ[а-яё]+|студент[а-яё]*)/gi)].map((match) => match[1]);
  if (classroom.length) {
    failures.push(`labs: the works still speak of ${[...new Set(classroom)].join(', ')} — they are done alone`);
  }
}
// Мост «глава → модуль». При двойной нумерации (глава 15 содержит U15–U17,
// глава 25 — U28) строка «Академическое продолжение этой главы» — единственная
// подсказка, где искать углубление. Она отсутствовала в десяти главах из
// тридцати трёх, а глава 2 обещала U03, который лежит в главе 3: ссылка вела
// вперёд, в чужой текст. Сверяем обещание с тем, что физически лежит в главе.
{
  const heads = [...body.matchAll(/<h1 id="b(\d\d)">/g)];
  const moduleMarks = [...body.matchAll(/id="ch(\d\d)"/g)];
  heads.forEach((head, index) => {
    const from = head.index;
    const to = heads[index + 1]?.index ?? body.length;
    const inside = moduleMarks.filter((mark) => mark.index > from && mark.index < to).map((mark) => mark[1]);
    const bridge = body.slice(from, Math.min(to, from + 900)).match(/Академическое продолжение этой главы:<\/strong>([\s\S]*?)<\/p>/);
    const named = bridge ? [...bridge[1].matchAll(/#ch(\d\d)/g)].map((match) => match[1]) : [];
    if (named.join(',') !== inside.join(',')) {
      failures.push(`chapter ${head[1]}: the module bridge names [${named.join(', ') || '—'}] but the chapter holds [${inside.join(', ') || '—'}]`);
    }
  });
}
// Обращение к читателю. Книга собиралась из разных источников, и половина
// текста говорила «ты», половина «вы» — иногда через абзац. Местоимения были
// только верхушкой: команды читателю («создай», «сравни», «переходи дальше»)
// и глаголы второго лица («пока не можешь ответить») жили в тексте ещё
// пятьюстами вхождениями. Прямая речь в кавычках («какое решение ты принял?» —
// вопрос к ядру; задача вида «сервер не работает — найди причину») под правило
// не подпадает, поэтому кавычки вырезаются до проверки.
{
  const prose = body
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<code[\s\S]*?<\/code>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/«[^»]*»/g, ' ');
  const singular = [...prose.matchAll(/(?<![а-яё])(ты|тебя|тебе|тобой|твой|твоя|твоё|твои|твоих|твоей|твоего|твоим)(?![а-яё])/gi)];
  if (singular.length) {
    failures.push(`course.html: the reader is addressed as «ты» in ${singular.length} places, the book says «вы»`);
  }
  const present = [...prose.matchAll(/(?<![А-Яа-яЁё])[А-Яа-яЁё]{2,}(?:ешь|ишь)(?![а-яё])/gi)].map((match) => match[0]);
  if (present.length) {
    failures.push(`course.html: second-person singular verbs in prose: ${[...new Set(present)].slice(0, 5).join(', ')}`);
  }
  // Формы множественного числа берутся из самой книги: если «создайте» в ней
  // есть, то «создай» — та же команда, сказанная на «ты».
  const plural = new Set([...prose.matchAll(/(?<![А-Яа-яЁё])([А-Яа-яЁё]{3,}(?:йте|ите|ьте))(?![а-яё])/gi)].map((match) => match[1].toLowerCase()));
  const singles = new Set([...plural].map((word) => word.slice(0, -2)));
  const orders = [...prose.matchAll(/(?<![А-Яа-яЁё])([А-Яа-яЁё]{3,})(?![а-яё])/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((word) => singles.has(word));
  if (orders.length) {
    failures.push(`course.html: singular imperatives in prose: ${[...new Set(orders)].slice(0, 5).join(', ')}`);
  }
  // Команды вида «размечай», «учитывай», «упакуй» парного правила не имеют:
  // множественной формы этих глаголов в книге не было ни разу, поэтому они
  // пережили две вычитки подряд. Окончание -ай/-яй/-уй/-юй само по себе почти
  // всегда глагол — существительных с ним считанные штуки, и они перечислены.
  const NOUNS = new Set(['случай', 'край', 'обычай', 'урожай', 'сарай', 'лишай', 'рай', 'бой', 'слой', 'строй', 'настрой']);
  const informal = [...prose.matchAll(/(?<![А-Яа-яЁё])([А-ЯЁа-яё]{4,}(?:ай|яй|уй|юй))(?![а-яё])/g)]
    .map((match) => match[1].toLowerCase())
    .filter((word) => !NOUNS.has(word));
  if (informal.length) {
    failures.push(`course.html: informal imperatives in prose: ${[...new Set(informal)].slice(0, 5).join(', ')}`);
  }
}
// База справочника отставала от текста: в ней были pstore и Machine Check, но
// не было VM (146 употреблений), GiB, CPU, RTO — то есть как раз тех слов,
// которые читатель встречает первыми и выделяет чаще всего. Правило требует,
// чтобы всякое латинское слово, встречающееся в прозе не реже десяти раз,
// имело определение. Нормализация здесь та же, что в панели «Определение».
{
  const terms = JSON.parse(siteJs.match(/const TERMS=(\[[\s\S]*?\]);\r?\nconst defineCard/)?.[1] ?? '[]');
  const normalize = (value) => String(value).toLowerCase().replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я/._+-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const keys = new Set();
  for (const entry of terms) {
    for (const variant of [entry.term, ...(entry.aliases ?? [])]) {
      const key = normalize(variant);
      keys.add(key);
      // Часть составного термина считается только с трёх букв: иначе «vm» из
      // «Шаблон VM» выдавало бы себя за определение виртуальной машины.
      for (const part of key.split(' ')) if (part.length > 2) keys.add(part);
    }
  }
  // Имена продуктов, служебные обозначения и слова из списка источников:
  // определять их незачем, а встречаются они часто.
  const notTerms = new Set(['bash', 'unix', 'documentation', 'storage', 'nbsp', 'rfc', 'a1', 'shell']);
  const plain = body
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<code[\s\S]*?<\/code>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  const counted = new Map();
  for (const match of plain.matchAll(/(?<![A-Za-z0-9_/.-])[A-Za-z][A-Za-z0-9+]{1,13}(?![A-Za-z0-9_/+])/g)) {
    const word = match[0].toLowerCase();
    counted.set(word, (counted.get(word) ?? 0) + 1);
  }
  const orphans = [...counted]
    .filter(([word, times]) => times >= 10 && !keys.has(word) && !notTerms.has(word) && !/^[ult]\d\d?$/.test(word))
    .sort((left, right) => right[1] - left[1]);
  if (orphans.length) {
    const list = orphans.slice(0, 6).map(([word, times]) => word + ' (' + times + ')').join(', ');
    failures.push(`term base: no definition for ${list}`);
  }
}
// Слова, для которых в книге есть принятый русский перевод. Пока инструмент
// вычитки не видел последнюю шестую часть файла, она жила по своим правилам:
// «next hop» вместо «следующий узел», «riser» вместо «райзер», «enumeration»
// вместо «перечисление» — в тех же главах, где рядом стоял русский вариант.
// Имена объектов и параметров (Endpoints, capture_output) переводу не подлежат
// и вынесены в исключения.
{
  const keep = ['Endpoints', 'EndpointSlice', 'capture_output', 'Extensible Firmware Interface',
    'Boot:Driver:Firmware', 'upstream-документация', 'Readiness probe'];
  let prose = body
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<code[\s\S]*?<\/code>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (const phrase of keep) prose = prose.split(phrase).join(' ');
  const settled = {
    'next hop': 'следующий узел', enumeration: 'перечисление', endpoint: 'оконечное устройство',
    riser: 'райзер', expander: 'экспандер', capture: 'перехват', production: 'рабочая система',
    benchmark: 'замер', durability: 'долговечность', toolchain: 'набор инструментов сборки',
    canary: 'канареечная партия', 'control plane': 'плоскость управления',
    userspace: 'пользовательское пространство', firmware: 'прошивка',
    'longest-prefix': 'самое длинное совпадение префикса', upstream: 'вышестоящий канал',
    backend: 'нижележащее хранилище', readiness: 'готовность', failover: 'переключение на резерв',
    detection: 'обнаружение', validation: 'проверка', regression: 'регрессия', rollout: 'развёртывание',
  };
  for (const [english, russian] of Object.entries(settled)) {
    const found = prose.match(new RegExp(`(?<![A-Za-z._/-])${english}(?![A-Za-z._/-])`, 'gi'));
    if (found) failures.push(`course.html: «${english}» left in prose ${found.length} times, the book says «${russian}»`);
  }
  // Банк заданий читают теми же глазами, что и главы, но правится он отдельным
  // инструментом — и отставал от книги: «Regression связывают … Stop condition:
  // остановить rollout» в одном разборе с русским текстом вокруг.
  if (data?.items && data?.cases) {
    const strings = [
      ...data.items.flatMap((item) => [item.stem, item.explanation, ...(item.options ?? []), ...(item.reason?.options ?? [])]),
      ...data.cases.flatMap((scenario) => [scenario.title, scenario.initial, scenario.evidence,
        ...scenario.stages.flatMap((stage) => [stage.label, ...stage.options])]),
    ];
    let bank = strings.filter(Boolean).join(' \n ');
    // Вывод команды, имя тома UEFI и имена стендов — не перевод, а данные.
    for (const phrase of ['lspci: endpoint', 'firmware volume', 'dev, staging, production',
      'staging квалифицировал digest A, production получил B']) bank = bank.split(phrase).join(' ');
    for (const [english, russian] of Object.entries(settled)) {
      const found = bank.match(new RegExp(`(?<![A-Za-z._/-])${english}(?![A-Za-z._/-])`, 'gi'));
      if (found) failures.push(`study-data: «${english}» left in ${found.length} strings, the book says «${russian}»`);
    }
  }
}
// Недельный план — единственное место, где курс разложен по времени. Он уже
// разошёлся с книгой один раз: таблица осталась на 28 позициях старой
// нумерации, когда модулей стало 37, и девять модулей просто выпали из плана.
// Ни сборка, ни ссылки этого не замечают — таблица остаётся рабочей.
{
  const planStart = body.indexOf('id="program"');
  const planEnd = body.indexOf('</table>', planStart);
  const plan = planStart < 0 || planEnd < 0 ? '' : body.slice(planStart, planEnd);
  const listed = [...plan.matchAll(/href="#ch(\d\d)"/g)].map((match) => match[1]);
  for (let number = 0; number <= 36; number += 1) {
    const times = listed.filter((value) => value === String(number).padStart(2, '0')).length;
    if (times !== 1) failures.push(`course.html: the weekly plan lists module U${String(number).padStart(2, '0')} ${times} times, expected once`);
  }
}
// Остатки markdown: список, написанный дефисами или цифрами внутри абзаца,
// браузер схлопывает в одну строку — читатель видит «причины: - права; - порт;»
// вместо перечня. В самой разметке это незаметно, поэтому проверяем отдельно.
const collapsedLists = [...body.replace(/<pre[\s\S]*?<\/pre>/g, ' ').matchAll(/<p>((?:(?!<\/?p[ >])[\s\S])*?)<\/p>/g)]
  .filter((match) => /(?:^|\n)\s*(?:-|\d+\.)\s+\S/.test(match[1]));
if (collapsedLists.length) {
  failures.push(`course.html: ${collapsedLists.length} paragraphs hold a markdown list that collapses into one line`);
}

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

// Разобранные примеры нумеруются номером своего U-модуля: в U18 это E18.x.
// Вставка нового модуля сдвигает шкалу, и метки в соседних модулях легко
// отстают — тогда один и тот же код E оказывается сразу в двух местах.
const moduleSpans = [...body.matchAll(/<h2 id="ch(\d\d)">/g)]
  .map((match, index, list) => ({
    module: Number(match[1]),
    start: match.index,
    end: index + 1 < list.length ? list[index + 1].index : body.length,
  }));
for (const span of moduleSpans) {
  for (const label of body.slice(span.start, span.end).matchAll(/\bE(\d+)\.\d+/g)) {
    if (Number(label[1]) !== span.module) {
      failures.push(`course.html: ${label[0]} inside module U${String(span.module).padStart(2, '0')}`);
      break;
    }
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
  if (rows !== 34) failures.push(`route: checklist has ${rows} rows for 34 chapters`);
  for (const marker of ['data-route-calendar', 'data-backup-save', 'data-backup-load']) {
    if (!routePage.includes(marker)) failures.push(`route: missing ${marker}`);
  }
  if (/<input(?![^>]*type="file")[^>]*data-route/.test(routePage)) failures.push('route: checklist must not accept manual input');
}
for (const [file, html] of cache) {
  if (!html.includes('href="/route/"') && !html.includes(`href="${BASE}/route/"`)) failures.push(`${file}: missing route link in navigation`);
}
// Сборка не разбирает клиентский код, поэтому синтаксическая ошибка в кабинете
// доходит до страницы незамеченной: сломанный скрипт просто не выполняется.
const cabinet = assessment?.match(/<script>\n\(\(\)=>\{[\s\S]*?<\/script>/)?.[0];
if (!cabinet) failures.push('assessment: cabinet script not found');
else {
  try { new Function(cabinet.slice('<script>'.length, -'</script>'.length)); }
  catch (error) { failures.push(`assessment: cabinet script does not parse — ${error.message}`); }
}

// Второй ярус: у каждого задания на механизм спрашивают рассуждение, и его
// формулировки не должны повторять слова верного варианта первого яруса —
// иначе выбор рассуждения подсказывает ответ.
if (data?.items) {
  const stop = new Set(['этот','этом','этого','который','которая','которые','поэтому','значит','может','можно','нужно','только','всегда','после','через','между','потому','самое','нельзя','должен','должна','должно','также','более','менее','если','когда','чтобы']);
  const words = (text) => new Set(String(text).toLowerCase().replace(/[^a-zа-яё0-9\s-]/gi, ' ').split(/\s+/).filter((word) => word.length >= 6 && !stop.has(word)));
  for (const item of data.items.filter((entry) => entry.kind === 'concept')) {
    const tier = item.reason;
    if (!tier || !Array.isArray(tier.options) || tier.options.length !== 3 || !Number.isInteger(tier.answer) || tier.answer < 0 || tier.answer > 2) {
      failures.push(`item ${item.id}: concept item without a three-option reason tier`);
      continue;
    }
    const right = words(item.options[item.answer]);
    const overlap = tier.options.map((text) => [...words(text)].filter((word) => right.has(word)).length);
    const others = overlap.filter((_, index) => index !== tier.answer);
    if (others.every((value) => overlap[tier.answer] > value + 2)) {
      failures.push(`item ${item.id}: reason tier leaks the correct answer through shared wording`);
    }
  }
}

// Позиция верного варианта. Банк собирался по заданию за раз, и верный ответ
// каждый раз записывался первым: в какой-то момент все 74 задания, все 74
// вторых яруса и все 148 шагов сценариев проходились выбором первого варианта,
// то есть кабинет мерил не понимание, а привычку. В разметке это не видно
// никак — только в распределении, поэтому оно и закреплено здесь.
if (data?.items && data?.cases) {
  const families = [
    ['items', data.items.filter((item) => Array.isArray(item.options)).map((item) => [item.answer, item.options.length])],
    ['reason tiers', data.items.filter((item) => item.reason).map((item) => [item.reason.answer, item.reason.options.length])],
    ['scenario stages', data.cases.flatMap((scenario) => scenario.stages.map((stage) => [stage.answer, stage.options.length]))],
  ];
  for (const [name, answers] of families) {
    const width = Math.max(...answers.map(([, length]) => length));
    for (let position = 0; position < width; position += 1) {
      const share = answers.filter(([answer]) => answer === position).length / answers.length;
      if (share > 0.5) {
        failures.push(`${name}: choosing option ${position + 1} every time passes ${Math.round(share * 100)}% of them`);
      }
      if (share === 0) failures.push(`${name}: option ${position + 1} is never the correct one`);
    }
  }
}

// Кабинет считает модули по одной константе. Пока их было несколько, копии
// расходились при каждом расширении курса: вариант собирался на 37 вопросов,
// записывался как 31 и отбрасывался проверкой на 28 — попытка исчезала при
// перезагрузке, а «маршрут пройден» срабатывал на 31 модуле из 37.
if (assessment) {
  if (!assessment.includes(`const MODULES=${MODULE_COUNT},`)) {
    failures.push(`assessment: cabinet must declare MODULES=${MODULE_COUNT}`);
  }
  // Попытка хранит собственный знаменатель, поэтому запись и её проверка не
  // могут разойтись; число модулей в расчётах берётся только из константы.
  if (!assessment.includes('total:MODULES')) failures.push('assessment: exam attempt must record total:MODULES');
  if (!assessment.includes('h.correct<=h.total')) failures.push('assessment: attempt history must validate against its own total');
  const literals = assessment.match(/(?:length|size|total|max)\s*[:=]+\s*(\d+)|correctCount>=(\d+)|done===(\d+)/g) ?? [];
  const stale = literals.filter((hit) => /\b(2[4-9]|3[0-6])\b/.test(hit) && !hit.includes('length:7'));
  if (stale.length) failures.push(`assessment: hand-written module counts left in the cabinet: ${[...new Set(stale)].join(', ')}`);
}
// Резервная копия обязана увозить всё локальное состояние: ключ, забытый здесь,
// теряется молча — при переносе в другой браузер исчезает только часть работы.
const backupKeys = siteJs.match(/BACKUP_KEYS=\[([^\]]*)\]/)?.[1] ?? '';
for (const key of ['selfstudy-v6', 'chapter-trainers-v1', 'recall-v1', 'timeline-v1', 'reader-v1', 'reading-v1', 'quiz-a1-v1']) {
  if (!backupKeys.includes(key)) failures.push(`site.js: backup does not cover server-infrastructure-${key}`);
}
// Вёрстка для телефона: правила, без которых страница перестаёт помещаться в
// экран. Браузер тогда расширяет область просмотра под самый широкий элемент и
// уменьшает масштаб — текст мельчает на всех страницах сразу, а заметить это по
// сборке нельзя. Проверять раскладку целиком здесь нечем, поэтому закрепляем
// сами правила: их удаление и было причиной каждого из найденных случаев.
const mobileRules = [
  ['.hidden-input{display:none}', 'системное поле выбора файла скрыто на всех страницах, а не только в кабинете'],
  ['.prose table{display:block;overflow-x:auto', 'широкая таблица прокручивается внутри себя'],
  ['.route-table td[data-route-cell=labs]::before', 'чек-лист маршрута разворачивается в карточки'],
  ['.search-toggle,.theme-toggle,.notes-toggle{min-width:44px;min-height:44px', 'кнопки панели — цели для пальца'],
  ['.hero-stats{grid-template-columns:1fr}', 'числа на титуле в одну колонку на узком экране'],
  ['.section-head,.progress-card,.chapter-trainer>header,.chapter-trainer>footer,.route-head{flex-direction:column',
    'пары «заголовок слева — ссылка справа» идут в столбец на телефоне'],
  ['.file-label{display:inline-flex', 'метка выбора файла не строчная — иначе её отступы налезают на соседние строки'],
  ['.study-app .controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))',
    'колонки разделов кабинета сжимаются: у простого 1fr нижняя граница — самое длинное слово, и на 280–320px строка не помещалась'],
  ['.study-app .status-box{display:grid', 'блок состояния кабинета оформлен отдельно от вводного абзаца'],
];
for (const [rule, why] of mobileRules) {
  if (!siteCss.includes(rule)) failures.push(`site.css: mobile rule lost — ${why} (${rule})`);
}
// Ширина страницы на большом экране. Три правила держат раскладку вместе;
// каждое из них уже однажды разъезжалось.
const layoutRules = [
  ['.page-layout{max-width:var(--page)', 'ширина страницы задана переменной'],
  ['padding:0 max(24px,calc((100vw - var(--page))/2))', 'верхняя панель считает поля по той же переменной, иначе логотип уезжает от текста'],
  ['.prose{width:min(100%,900px,var(--reading-measure))}',
    'мера строки — верхняя граница, а не размер: через max-width текст не замечал, что колонка уже, и уезжал под рейл разделов'],
];
for (const [rule, why] of layoutRules) {
  if (!siteCss.includes(rule)) failures.push(`site.css: layout rule lost — ${why} (${rule})`);
}
// Рейл разделов встаёт сбоку только когда рядом помещается полная строка:
// 300 боковая + 152 поля + 250 рейл + 48 зазор + ~750 текста.
const railBreakpoint = siteCss.match(/@media\s*\(min-width:\s*(\d+)px\)[^@]*\.page-main:has\(\.section-rail\)\{display:grid/);
if (!railBreakpoint) failures.push('site.css: side rail grid rule not found');
else if (Number(railBreakpoint[1]) < 1500) {
  failures.push(`site.css: side rail appears at ${railBreakpoint[1]}px — too early, it eats the reading width`);
}
// Слово «Разделы» остаётся в разметке: значок ☰ не даёт кнопке названия.
for (const [file, html] of cache) {
  if (!html.includes('<summary><span class="menu-label">Разделы</span></summary>')) {
    failures.push(`${file}: mobile menu button lost its accessible name`);
    break;
  }
}
// Строение страницы: заголовок каждого уровня стоит на своём месте. Проверки
// закрывают три случая, которые уже случались и на сборке никак не сказывались.
const railText = (html) => {
  const open = html.indexOf('data-section-rail');
  return open < 0 ? '' : html.slice(open, html.indexOf('</nav>', open));
};
for (const [file, html] of cache) {
  const opening = html.match(/<article class="[^"]*\bprose\b[^"]*">/);
  if (!opening) continue;
  const article = html.slice(opening.index + opening[0].length, html.indexOf('</article>', opening.index));
  const main = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
  const outline = main.replace(/<aside[\s\S]*?<\/aside>/g, '').replace(/<nav[\s\S]*?<\/nav>/g, '');
  // 1. Страница не кончается заголовком: так «Часть 0» висела в конце «О курсе»
  //    без единой строки под собой.
  const blocks = [...article.matchAll(/<(h[1-4]|p|ul|ol|table|pre|blockquote|details|div)[\s>]/g)].map((match) => match[1]);
  if (/^h[1-4]$/.test(blocks.at(-1) ?? '')) failures.push(`${file}: page ends with a heading and no text under it`);
  // 2. Уровни не перепрыгивают ступень: h1 → h3 ломает оглавление для чтения
  //    с экрана и оставляет раздел вне навигации по странице.
  let previous = 0;
  for (const match of outline.matchAll(/<h([1-4])[^>]*>/g)) {
    const level = Number(match[1]);
    if (previous && level > previous + 1) { failures.push(`${file}: heading level jumps h${previous} → h${level}`); break; }
    previous = level;
  }
  // 3. Навигация по разделам повторяет заголовки h2 страницы — и по составу,
  //    и по порядку: расхождение означает ссылку в никуда или потерянный раздел.
  const rail = railText(html);
  if (rail) {
    const listed = [...rail.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]).join('|');
    const present = [...main.matchAll(/<h2 id="([^"]+)"/g)].map((match) => match[1]).join('|');
    if (listed !== present) failures.push(`${file}: section rail does not match the page headings`);
  }
}
// Автоматические переносы в заголовках рвут обычные слова ради плотности
// строки, а не по нужде: «Как устро-ен учебник».
if (!/\.prose h3\{overflow-wrap:break-word;hyphens:manual\}/.test(siteCss)) {
  failures.push('site.css: headings must not hyphenate automatically');
}
// Шкала времени только дополняется: код не должен уметь переписать дату.
if (!siteJs.includes('stampTimeline') || !siteJs.includes("if(line.events[key])return")) {
  failures.push('site.js: timeline must be append-only');
}
if (htmlFiles.length !== 84) failures.push(`expected 84 routes, got ${htmlFiles.length}`);
if (failures.length) throw new Error(`Site validation failed:\n${failures.slice(0, 30).join('\n')}`);
console.log(`Validated ${htmlFiles.length} routes: links, anchors, ${bankSize.items} items, ${bankSize.cases} scenarios.`);
