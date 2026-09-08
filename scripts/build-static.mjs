import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'build');
const source = await readFile(resolve(root, 'public', 'course.html'), 'utf8');

const parts = [
  ['Часть 0', 'Учебная лаборатория', [0]],
  ['Часть I', 'Инженерная модель и Linux', [1, 2, 3, 4, 5]],
  ['Часть II', 'Сети', [6, 7, 8]],
  ['Часть III', 'Серверное железо', [9, 10, 11]],
  ['Часть IV', 'Хранение данных', [12, 13, 14, 15, 16]],
  ['Часть V', 'Платформа и наблюдаемость', [17, 18]],
  ['Часть VI', 'Автоматизация', [19, 20, 21]],
  ['Часть VII', 'Контейнеры и DevOps', [22, 23]],
  ['Часть VIII', 'Firmware', [24, 25, 26]],
  ['Часть IX', 'Итоговая инженерная практика', [27]],
];

const pad = (number) => String(number).padStart(2, '0');
const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', mdash: '—', ndash: '–', laquo: '«', raquo: '»', hellip: '…', rarr: '→', larr: '←', times: '×', middot: '·' };
const decode = (text) => text.replace(/&(#\d+|[a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
const escape = (text) => String(text).replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const marker = (id) => {
  const index = source.indexOf(`id="${id}"`);
  if (index < 0) throw new Error(`Missing source marker: ${id}`);
  return source.lastIndexOf('<', index);
};
const section = (id) => {
  const start = marker(id);
  const end = source.indexOf('</section>', start);
  if (end < 0) throw new Error(`Unclosed section: ${id}`);
  return source.slice(start, end + 10);
};
const scriptElement = (id) => {
  const index = marker(id);
  const end = source.indexOf('</script>', index);
  if (end < 0) throw new Error(`Unclosed script: ${id}`);
  return source.slice(index, end + 9);
};
const scriptJson = (id) => {
  const element = scriptElement(id);
  return JSON.parse(element.slice(element.indexOf('>') + 1, element.lastIndexOf('</script>')));
};
const followingScript = (id) => {
  const element = scriptElement(id);
  const from = source.indexOf(element) + element.length;
  const start = source.indexOf('<script>', from);
  const end = source.indexOf('</script>', start);
  return source.slice(start, end + 9);
};

const chapterStarts = Array.from({ length: 28 }, (_, number) => marker(`b${pad(number)}`));
const chapterPageStarts = chapterStarts.map((start, number) => {
  if (number === 0) return start;
  const precedingHeading = source.lastIndexOf('<h1', start - 1);
  return precedingHeading > chapterStarts[number - 1] ? precedingHeading : start;
});
const frontStart = marker('title');
const appendicesStart = marker('b27-s044');
const selftestStart = marker('selftest');
const studyAppStart = marker('study-app');
const assessmentStart = marker('assessment');
const labsStart = marker('labs');
const assessmentReferenceStart = marker('assessment-reference');
const mainEnd = source.lastIndexOf('</main>');
const studyDatabase = scriptJson('study-data');

const chapters = chapterStarts.map((start, number) => {
  const end = number === 27 ? appendicesStart : chapterPageStarts[number + 1];
  const intro = source.slice(chapterPageStarts[number], start);
  const content = source.slice(start, end);
  const titleMatch = content.match(/^<h1[^>]*>(.*?)<\/h1>/s);
  if (!titleMatch) throw new Error(`Missing title for chapter ${number}`);
  return { number, title: strip(titleMatch[1]), intro, content, url: `/chapters/${pad(number)}/` };
});

const labMarkers = Array.from({ length: 28 }, (_, number) => marker(`lab${pad(number)}`));
const labEnd = marker('assessment-reference');
const labs = labMarkers.map((start, number) => {
  const end = number === 27 ? labEnd : labMarkers[number + 1];
  const content = source.slice(start, end);
  const titleMatch = content.match(/^<h3[^>]*>(.*?)<\/h3>/s);
  return { number, title: strip(titleMatch?.[1] ?? `Практикум ${number}`), content, url: `/labs/${pad(number)}/` };
});
labs[0].content = source.slice(labsStart, labMarkers[1]);

const pages = [
  { url: '/about/', content: source.slice(frontStart, chapterStarts[0]) },
  ...chapters.map((item) => ({ url: item.url, content: item.intro + item.content })),
  ...labs.map((item) => ({ url: item.url, content: item.content })),
  { url: '/assessment/', content: source.slice(studyAppStart, labsStart) },
  { url: '/assessment/a1/', content: section('selftest') },
  { url: '/reference/', content: source.slice(appendicesStart, selftestStart) },
  { url: '/reference/archive/', content: source.slice(assessmentReferenceStart, mainEnd) },
];

const idToUrl = new Map();
for (const page of pages) {
  for (const match of page.content.matchAll(/\bid="([^"]+)"/g)) idToUrl.set(match[1], page.url);
}
const rewriteLinks = (html, currentUrl) => html.replace(/href="#([^"]+)"/g, (_, id) => {
  const target = idToUrl.get(id);
  if (!target || target === currentUrl) return `href="#${id}"`;
  return `href="${target}#${id}"`;
});

const curriculumLinks = (active) => parts.map(([label, title, numbers]) => `
  <section class="nav-group"><p>${label} · ${title}</p>${numbers.map((number) => {
    const chapter = chapters[number];
    return `<a ${active === number ? 'aria-current="page"' : ''} href="${chapter.url}"><span>${pad(number)}</span>${escape(chapter.title.replace(/^\d+\.\s*/, ''))}</a>`;
  }).join('')}</section>`).join('');

const globalNav = `
  <a class="brand" href="/"><span>SERVER</span><strong>INFRA</strong></a>
  <nav aria-label="Основная навигация">
    <a href="/curriculum/">Программа</a>
    <a href="/assessment/">Проверка знаний</a>
    <a href="/labs/00/">Практикум</a>
    <a href="/reference/">Справочник</a>
    <a href="/about/">О курсе</a>
  </nav>`;

const readerTools = `
  <aside class="notes-panel" data-notes-panel aria-hidden="true" aria-labelledby="notes-title">
    <header class="notes-head"><div><p class="eyebrow">Личный конспект</p><h2 id="notes-title">Заметки и цитаты</h2></div><button type="button" class="icon-button" data-notes-close aria-label="Закрыть заметки">×</button></header>
    <section class="selection-card" aria-labelledby="selection-title"><h3 id="selection-title">Выбранный фрагмент</h3><p class="selection-preview" data-selection-preview>Выделите слово или фрагмент в учебнике: справочник покажет определение, текст можно скопировать, сохранить или отметить цветом.</p><div class="selection-actions"><button type="button" data-define-selection disabled>Определение</button><button type="button" data-copy-selection disabled>Копировать</button><button type="button" data-save-quote disabled>Сохранить цитату</button></div><div class="highlight-palette" role="group" aria-label="Цвет маркера"><button type="button" class="color-dot yellow" data-highlight-color="yellow" disabled aria-label="Выделить жёлтым"></button><button type="button" class="color-dot green" data-highlight-color="green" disabled aria-label="Выделить зелёным"></button><button type="button" class="color-dot blue" data-highlight-color="blue" disabled aria-label="Выделить синим"></button><button type="button" class="color-dot pink" data-highlight-color="pink" disabled aria-label="Выделить розовым"></button></div><button type="button" class="undo-highlight" data-undo-highlight disabled>↶ Отменить последнее выделение</button></section>
    <section class="note-composer"><label for="reader-note">Новая заметка</label><textarea id="reader-note" data-note-input rows="4" placeholder="Запишите вывод, вопрос или идею…"></textarea><button type="button" class="button primary" data-add-note>Сохранить заметку</button></section>
    <section class="notes-library" aria-labelledby="library-title"><div class="notes-library-head"><h3 id="library-title">Сохранённое <span data-notes-count>0</span></h3><button type="button" class="text-button" data-copy-all disabled>Копировать всё</button></div><div class="notes-list" data-notes-list><p class="notes-empty">Здесь появятся ваши заметки, цитаты и цветные выделения.</p></div></section>
  </aside>
  <button type="button" class="notes-backdrop" data-notes-close aria-label="Закрыть панель заметок" hidden></button>
  <div class="selection-toolbar" data-selection-toolbar hidden role="toolbar" aria-label="Действия с выделенным текстом"><button type="button" data-define-selection title="Показать определение термина">Определение</button><button type="button" data-copy-selection title="Копировать выделенный текст">Копировать</button><button type="button" data-save-quote title="Сохранить цитату">В цитаты</button><button type="button" data-remove-current-highlight hidden>Убрать маркер</button><span aria-hidden="true"></span><button type="button" class="color-dot yellow" data-highlight-color="yellow" aria-label="Выделить жёлтым"></button><button type="button" class="color-dot green" data-highlight-color="green" aria-label="Выделить зелёным"></button><button type="button" class="color-dot blue" data-highlight-color="blue" aria-label="Выделить синим"></button><button type="button" class="color-dot pink" data-highlight-color="pink" aria-label="Выделить розовым"></button></div>
  <div class="define-card" data-define-card hidden role="dialog" aria-label="Определение термина" aria-live="polite"><button type="button" class="define-close" data-define-close aria-label="Закрыть определение">×</button><div data-define-body></div></div>
  <div class="reader-toast" data-reader-toast role="status" aria-live="polite"></div>
  <div class="search-overlay" data-search-overlay hidden role="dialog" aria-modal="true" aria-labelledby="search-title">
    <div class="search-panel">
      <h2 id="search-title" class="visually-hidden">Поиск по учебнику</h2>
      <div class="search-field"><span aria-hidden="true">⌕</span><input type="search" data-search-input placeholder="Найти по всему учебнику: PMTU, initramfs, bifurcation…" autocomplete="off" spellcheck="false" aria-label="Поисковый запрос" aria-controls="search-results"><button type="button" class="icon-button" data-search-close aria-label="Закрыть поиск">×</button></div>
      <p class="search-status" data-search-status role="status">Введите не меньше двух символов.</p>
      <div class="search-results" id="search-results" data-search-results></div>
    </div>
  </div>`;

const pageShell = ({ title, eyebrow, body, sidebar = '', className = '', description = title }) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escape(description)}"><meta name="theme-color" content="#081a24"><script>try{const saved=localStorage.getItem('server-infrastructure-theme');document.documentElement.dataset.theme=saved||((matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light')}catch{document.documentElement.dataset.theme='light'}</script><title>${escape(title)} · Серверная инфраструктура</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css"></head>
<body><header class="topbar">${globalNav}<button class="search-toggle" type="button" data-search-open aria-haspopup="dialog"><span aria-hidden="true">⌕</span><span>Поиск</span><kbd>Ctrl K</kbd></button><button class="theme-toggle" type="button" data-theme-toggle aria-pressed="false"><span aria-hidden="true" data-theme-icon>◐</span><span data-theme-label>Тёмная тема</span></button><button class="notes-toggle" type="button" data-notes-toggle aria-expanded="false"><span aria-hidden="true">✎</span><span>Заметки</span><strong data-notes-badge hidden>0</strong></button><details class="mobile-menu"><summary>Разделы</summary><div>${globalNav}</div></details></header>
<div class="page-layout ${className}">${sidebar ? `<aside class="side-nav">${sidebar}</aside>` : ''}<main class="page-main"><p class="eyebrow">${escape(eyebrow)}</p>${body}</main></div>
${readerTools}<script src="/assets/site.js"></script></body></html>`;

// ---------- Справочная база терминов ----------
// Основа — приложение C (глоссарий) прямо из учебника, чтобы определения не
// разъезжались с текстом; public/reference-terms.json добавляет термины, которых
// в глоссарии нет, и варианты написания для поиска по выделенному фрагменту.
const glossaryEntries = () => {
  const start = marker('b27-s058');
  const end = marker('b27-s059');
  const block = source.slice(start, end);
  const body = block.slice(block.indexOf('<p>', block.indexOf('</p>') + 4));
  return Array.from(body.matchAll(/<strong>(.*?)<\/strong>\s*—\s*([\s\S]*?)(?=<br>|<\/p>)/g)).map((match) => {
    const definition = match[2].replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, '').trim();
    const chapter = match[2].match(/href="#b(\d\d)"/);
    // В глоссарии определение идёт после тире и потому начинается со строчной буквы;
    // в карточке термин вынесен в заголовок, поэтому предложение начинается заново.
    const sentence = definition.replace(/[\s.]*$/, '.').replace(/^([a-zа-я])/, (letter) => letter.toUpperCase());
    return {
      term: strip(match[1]),
      html: sentence,
      chapter: chapter ? Number(chapter[1]) : null,
      aliases: [],
    };
  });
};
const supplementFile = JSON.parse(await readFile(resolve(root, 'public', 'reference-terms.json'), 'utf8'));
const glossaryAliases = supplementFile.aliasesForGlossary ?? {};
// Термин вида WWN/WWID ищется и по каждой половине, если та достаточно длинная,
// чтобы не породить ложных совпадений (CI/CD так не разбирается).
const slashVariants = (term) => {
  const parts = term.split('/').map((part) => part.trim());
  return parts.length > 1 && parts.every((part) => part.length >= 3) ? parts : [];
};
const referenceTerms = [
  ...glossaryEntries().map((entry) => ({ ...entry, aliases: [...slashVariants(entry.term), ...(glossaryAliases[entry.term] ?? [])] })),
  ...supplementFile.terms.map((entry) => ({
    term: entry.t,
    html: escape(entry.d),
    chapter: entry.c ?? null,
    aliases: [...slashVariants(entry.t), ...(entry.a ?? [])],
  })),
];
const unknownAlias = Object.keys(glossaryAliases).find((term) => !referenceTerms.some((entry) => entry.term === term));
if (unknownAlias) throw new Error(`aliasesForGlossary references a missing glossary term: ${unknownAlias}`);
if (referenceTerms.length < 150) throw new Error(`Reference base too small: ${referenceTerms.length}`);

const localToc = (content) => Array.from(content.matchAll(/<h([23])[^>]*id="([^"]+)"[^>]*>(.*?)<\/h\1>/gs))
  .slice(0, 18)
  .map((match) => `<a class="local-${match[1]}" href="#${match[2]}">${escape(strip(match[3]))}</a>`).join('');

// Нумерация академических модулей U00–U27 не совпадает с нумерацией глав: часть глав
// содержит несколько U-модулей, часть — ни одного. Единственный достоверный источник
// соответствия — то, внутри какой главы физически находится заголовок U-модуля.
// Всё остальное (практикум, тренажёры, ссылки «Проверить знания») выводится отсюда,
// поэтому связка не может разъехаться при правке учебника.
const moduleChapter = Array.from({ length: 28 }, (_, module) => {
  const position = marker(`ch${pad(module)}`);
  let chapter = 0;
  chapterStarts.forEach((start, number) => { if (start <= position) chapter = number; });
  return chapter;
});
// Главы без собственного U-модуля опираются на модуль соседней главы той же темы.
const chapterFallbackModule = new Map([[0, 0], [3, 3], [5, 4], [11, 9], [25, 26]]);
const chapterModules = chapterStarts.map((_, chapter) => {
  const own = moduleChapter.flatMap((owner, module) => (owner === chapter ? [module] : []));
  return own.length ? own : [chapterFallbackModule.get(chapter)];
});
const studyModuleByChapter = chapterModules.map((modules) => modules[0]);
const chapterTrainerOverrides = new Map([[0, [
  { id: 'C00-0', stem: 'Зачем в учебном стенде отдельные CLIENT-NET, SERVER-NET и STORAGE-NET?', options: ['Чтобы наблюдать маршрутизацию и отказы между изолированными сегментами', 'Чтобы каждая VM обязательно получила выход в Интернет без маршрутизатора', 'Чтобы заменить резервное копирование VM', 'Чтобы Proxmox автоматически исправлял сетевые ошибки'], answer: 0, explanation: 'Изолированные bridges создают наблюдаемые L2-сегменты. Связь между ними требует маршрутизатора, поэтому путь пакета можно разбирать по слоям.' },
  { id: 'C00-1', stem: 'Что лучше всего позволяет безопасно повторить break/fix-упражнение?', options: ['Известный baseline: template или snapshot плюс зафиксированная конфигурация', 'Случайный reboot всех VM после каждого изменения', 'Единственная копия стенда без документации', 'Одновременная замена нескольких настроек'], answer: 0, explanation: 'Известная исходная точка делает опыт повторяемым и позволяет связать наблюдаемый эффект с конкретным изменением.' },
]]]);

// Номер верного ответа не должен читаться в исходном коде страницы. В разметку попадает
// контрольная сумма пары «идентификатор вопроса + номер варианта»; скрипт сверяет с ней
// выбор читателя и восстанавливает индекс перебором вариантов. Та же функция дословно
// повторена в клиентском скрипте — при правке менять обе.
const ANSWER_SALT = 'sic6';
const answerDigest = (trainerId, index) => {
  let hash = 0x811c9dc5;
  for (const character of `${trainerId}|${index}|${ANSWER_SALT}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

const chapterTrainer = (number) => {
  const module = studyModuleByChapter[number];
  const items = chapterTrainerOverrides.get(number) ?? studyDatabase.items.filter((item) => item.module === module && Array.isArray(item.options)).slice(0, 2);
  if (items.length !== 2) throw new Error(`Expected two quick-check questions for chapter ${number}`);
  const questions = items.map((item, questionIndex) => {
    const trainerId = `Q${pad(number)}-${questionIndex}`;
    const shift = (number + questionIndex) % item.options.length;
    const options = [...item.options.slice(shift), ...item.options.slice(0, shift)];
    const answer = (item.answer - shift + item.options.length) % item.options.length;
    return `<fieldset class="trainer-question" data-trainer-question="${trainerId}" data-answer="${answerDigest(trainerId, answer)}"><legend><span>${questionIndex + 1}</span>${escape(item.stem)}</legend><div class="trainer-options">${options.map((option, optionIndex) => `<label><input type="radio" name="trainer-${trainerId}" value="${optionIndex}"><span>${escape(option)}</span></label>`).join('')}</div><div class="trainer-actions"><button type="button" data-trainer-check>Проверить</button><p class="trainer-feedback" data-trainer-feedback hidden data-explanation="${escape(item.explanation)}" role="status"></p></div></fieldset>`;
  }).join('');
  return `<section class="chapter-trainer" data-chapter-trainer="${number}" aria-labelledby="trainer-title-${number}"><header><div><p class="eyebrow">Закрепление материала</p><h2 id="trainer-title-${number}">Мини-тренажёр главы</h2><p>Два вопроса с мгновенной проверкой. Результат сохраняется в этом браузере.</p></div><strong data-trainer-score>0 / 2</strong></header>${questions}<footer><span data-trainer-summary>Ответьте на оба вопроса.</span><a href="/assessment/?module=${module}">Полный тренажёр по теме →</a></footer></section>`;
};

// Обратная связка «глава → её академические модули»: без неё главы 3, 5, 11 и 25
// оставались тупиками — из них не было пути ни в практикум, ни в проверку знаний.
const chapterPractice = (number) => {
  const modules = chapterModules[number];
  const items = modules.map((module) => {
    const own = moduleChapter[module] === number;
    const note = own ? 'Модуль этой главы' : `Модуль главы ${pad(moduleChapter[module])}, разбирается на материале этой темы`;
    return `<a href="${labs[module].url}"><span>L${pad(module)}</span><strong>${escape(labs[module].title.replace(/^L\d+[A-Z/]?\.\s*/, ''))}</strong><em>${note}</em></a>`;
  }).join('');
  return `<section class="chapter-practice" aria-labelledby="practice-title-${number}"><header><p class="eyebrow">Практика по теме</p><h2 id="practice-title-${number}">Работы практикума</h2></header><div class="practice-grid">${items}</div><p class="practice-note">Нумерация работ <strong>L</strong> следует академическим модулям <strong>U00–U27</strong>, а не номерам глав: часть глав содержит несколько модулей, часть опирается на модуль соседней главы.</p></section>`;
};

const chapterPage = (chapter) => {
  const previous = chapters[chapter.number - 1];
  const next = chapters[chapter.number + 1];
  const pager = `<nav class="pager" aria-label="Переход между главами">${previous ? `<a href="${previous.url}">← Глава ${pad(previous.number)}</a>` : '<span></span>'}<a class="assessment-link" href="/assessment/?module=${studyModuleByChapter[chapter.number]}">Проверить знания</a>${next ? `<a href="${next.url}">Глава ${pad(next.number)} →</a>` : '<span></span>'}</nav>`;
  const sidebar = `<a class="back-link" href="/curriculum/">← Вся программа</a><div class="sidebar-scroll">${curriculumLinks(chapter.number)}</div>`;
  const body = `<article class="prose chapter-prose">${rewriteLinks(chapter.intro + chapter.content, chapter.url)}</article>${chapterTrainer(chapter.number)}${chapterPractice(chapter.number)}${pager}`;
  return pageShell({ title: chapter.title, eyebrow: `Глава ${pad(chapter.number)} · университетский курс`, body, sidebar, className: 'with-sidebar' });
};

const labPage = (lab) => {
  const previous = labs[lab.number - 1];
  const next = labs[lab.number + 1];
  const theory = chapters[moduleChapter[lab.number]];
  const pager = `<nav class="pager"><a href="${theory.url}">Теория: глава ${pad(theory.number)}</a>${previous ? `<a href="${previous.url}">← L${pad(previous.number)}</a>` : '<span></span>'}${next ? `<a href="${next.url}">L${pad(next.number)} →</a>` : '<span></span>'}</nav>`;
  const sidebar = `<a class="back-link" href="/curriculum/">← Вся программа</a><p class="side-title">Практикум</p>${labs.map((item) => `<a ${item.number === lab.number ? 'aria-current="page"' : ''} href="${item.url}"><span>L${pad(item.number)}</span>${escape(item.title.replace(/^L\d+[A-Z/]?\.\s*/, ''))}</a>`).join('')}`;
  return pageShell({ title: lab.title, eyebrow: `Практикум · модуль U${pad(lab.number)} · теория в главе ${pad(theory.number)}`, body: `<article class="prose">${rewriteLinks(lab.content, lab.url)}</article>${pager}`, sidebar, className: 'with-sidebar' });
};

const homeCards = parts.map(([label, title, numbers]) => `<a class="part-card" href="${chapters[numbers[0]].url}"><span>${label}</span><h2>${title}</h2><p>${numbers.length} ${numbers.length === 1 ? 'модуль' : 'модулей'} · ${numbers.map((number) => pad(number)).join(' · ')}</p></a>`).join('');
const home = pageShell({
  title: 'Университетский курс', eyebrow: 'Самостоятельное обучение', className: 'landing',
  body: `<section class="hero"><div><h1>Серверная инфраструктура<br><em>от сигнала до системы</em></h1><p>Полный маршрут для самостоятельной подготовки: Linux, сети, серверное железо, хранение данных, автоматизация, контейнеры и firmware.</p><div class="hero-actions"><a class="button primary" href="/curriculum/">Открыть программу</a><a class="button" href="/assessment/">Продолжить обучение</a></div></div><div class="hero-stats"><div><strong>28</strong><span>глав</span></div><div><strong>196</strong><span>автопроверок</span></div><div><strong>56</strong><span>полевых работ</span></div><div><strong>28</strong><span>Python-тестов</span></div></div></section><section class="progress-card"><div><p class="eyebrow">Ваш прогресс</p><strong data-progress-title>Маршрут ещё не начат</strong><p data-progress-copy>Результаты сохраняются только в этом браузере.</p></div><a href="/assessment/">Открыть кабинет →</a></section><section class="section-head"><div><p class="eyebrow">Маршрут</p><h2>Девять последовательных частей</h2></div><a href="/curriculum/">Все главы →</a></section><div class="part-grid">${homeCards}</div>`,
  description: 'Многостраничный университетский курс по серверной инфраструктуре для самостоятельного обучения.',
});

const curriculum = pageShell({
  title: 'Программа курса', eyebrow: '28 глав · 9 частей', className: 'catalog',
  body: `<header class="catalog-head"><h1>Программа курса</h1><p>Идите последовательно или выберите нужную область. Каркас главы одинаков: цели, разобранный пример, лаборатория, типичная ошибка мышления, лестница самостоятельности, самопроверка и мини-тренажёр. Разбор аварий вынесен в практикум и в главу 27.</p><label class="search"><span>Поиск по программе</span><input type="search" placeholder="Например: NUMA, Ceph, systemd" data-course-search></label></header>${parts.map(([label, title, numbers]) => `<section class="catalog-part" data-course-group><div><p>${label}</p><h2>${title}</h2></div><div class="chapter-grid">${numbers.map((number) => { const item = chapters[number]; return `<a class="chapter-card" data-course-card="${escape(item.title.toLowerCase())}" href="${item.url}"><span>${pad(number)}</span><h3>${escape(item.title.replace(/^\d+\.\s*/, ''))}</h3><p>Теория · пример · лаборатория · ошибка мышления · проверка</p></a>`; }).join('')}</div></section>`).join('')}`,
});

const quizData = scriptElement('quiz-data');
const quizScript = followingScript('quiz-data');
const studyData = scriptElement('study-data');
const checkerData = scriptElement('checker-code-data');
let studyScript = followingScript('checker-code-data')
  .replace(/'#ch'\+pad\(([^)]+)\)/g, "'/chapters/'+pad($1)+'/'")
  .replace(/'#lab'\+pad\(([^)]+)\)/g, "'/labs/'+pad($1)+'/'")
  .replace(/render\(\);\s*\}\)\(\);\s*<\/script>$/, "const requested=new URLSearchParams(location.search).get('module');if(requested!==null&&/^\\d{1,2}$/.test(requested)&&Number(requested)<28){module=Number(requested);tab='learn';}\nrender();\n})();\n</script>");
const studySection = section('study-app');
const assessmentIntro = rewriteLinks(source.slice(assessmentStart, labsStart), '/assessment/');
const assessment = pageShell({
  title: 'Проверка знаний', eyebrow: 'Автоматизированный учебный кабинет', className: 'tool-page',
  body: `<header class="tool-intro"><h1>Проверка знаний</h1><p>Выполняйте задания по модулям, возвращайтесь к слабым темам и переносите прогресс между браузерами.</p><a class="button" href="/assessment/a1/">Тренажёр A1 · 40 вопросов</a></header><article class="study-surface">${studySection}</article><article class="prose compact-prose">${assessmentIntro}</article>${studyData}${checkerData}${studyScript}`,
});
const a1 = pageShell({
  title: 'Тренажёр A1', eyebrow: '40 вопросов · мгновенная проверка', className: 'tool-page',
  body: `<header class="tool-intro"><h1>Тренажёр A1</h1><p>Быстрая проверка базовых понятий перед переходом к модульному кабинету.</p><a href="/assessment/">← Основной кабинет</a></header><article class="study-surface">${section('selftest')}</article>${quizData}${quizScript}`,
});

const referenceCards = `<div class="reference-cards"><a href="/reference/archive/"><span>Аттестация</span><strong>Экзаменационный банк и рубрики</strong></a><a href="/assessment/"><span>Интерактив</span><strong>Автоматическая проверка</strong></a><a href="/curriculum/"><span>Навигация</span><strong>Все 28 глав курса</strong></a></div>`;
const reference = pageShell({ title: 'Справочник и приложения', eyebrow: 'Команды · runbook · глоссарий', body: `<header class="catalog-head"><h1>Справочник и приложения</h1><p>Материалы для работы рядом с терминалом и повторения после курса.</p></header>${referenceCards}<article class="prose">${rewriteLinks(source.slice(appendicesStart, selftestStart), '/reference/')}</article>` });
const archive = pageShell({ title: 'Аттестация и архив материалов', eyebrow: 'Экзамены · ключи · рубрики', body: `<header class="catalog-head"><h1>Аттестация и архив</h1><p>Полная справочная модель очной аттестации, исходный экзаменационный банк и преподавательские ключи.</p></header><article class="prose">${rewriteLinks(source.slice(assessmentReferenceStart, mainEnd), '/reference/archive/')}</article>` });
const about = pageShell({ title: 'О курсе', eyebrow: 'Как учиться самостоятельно', body: `<article class="prose">${rewriteLinks(source.slice(frontStart, chapterStarts[0]), '/about/')}</article>` });

const css = `
:root{--ink:#102733;--muted:#5b6d76;--navy:#071a24;--navy2:#0d2c38;--teal:#1aa698;--teal2:#8ce0d6;--paper:#f5f0e6;--white:#fffdf9;--line:#d9d4c8;--amber:#e2a947;--link:#087e75;--soft:#faf9f4;--code:#e4e2d9;--quote:#fff8e9;--success:#e9f5f3;--selected:#e7f6f3;color-scheme:light}html[data-theme=dark]{--ink:#e8f0ed;--muted:#9fb1b2;--navy:#06151d;--navy2:#0d2a35;--teal:#45c8bb;--teal2:#94e5dc;--paper:#07171f;--white:#0d222b;--line:#29414a;--amber:#e2ae58;--link:#69d6ca;--soft:#102832;--code:#18323a;--quote:#2b281e;--success:#12362f;--selected:#113a36;color-scheme:dark}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;transition:background-color .2s,color .2s}.topbar{height:68px;background:var(--navy);color:white;display:flex;align-items:center;padding:0 max(24px,calc((100vw - 1440px)/2));gap:48px;position:sticky;top:0;z-index:20;border-bottom:1px solid #ffffff18}.brand{display:flex;align-items:baseline;gap:7px;color:white;text-decoration:none;letter-spacing:.08em}.brand span{font-size:11px;color:var(--teal2)}.brand strong{font-size:19px}.topbar>nav{display:flex;gap:28px}.topbar nav a{color:#d7e7e8;text-decoration:none;font-size:14px}.topbar nav a:hover{color:white}.theme-toggle{margin-left:auto;display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid #ffffff35;background:#ffffff0b;color:white;font:600 12px/1.2 inherit;cursor:pointer}.theme-toggle:hover{border-color:var(--teal2);background:#ffffff14}.theme-toggle:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}.theme-toggle [data-theme-icon]{font-size:16px}.mobile-menu{display:none}.page-layout{max-width:1440px;margin:auto;min-height:calc(100vh - 68px)}.page-main{min-width:0;padding:54px clamp(24px,5vw,76px) 90px}.with-sidebar{display:grid;grid-template-columns:300px minmax(0,1fr)}.side-nav{height:calc(100vh - 68px);position:sticky;top:68px;overflow:auto;padding:34px 24px;background:#0b2430;color:white}.side-nav a{display:grid;grid-template-columns:35px 1fr;gap:8px;padding:8px 9px;color:#bcd0d3;text-decoration:none;font-size:12px;line-height:1.35;border-radius:5px}.side-nav a span{color:#6ec9bf;font-variant-numeric:tabular-nums}.side-nav a:hover,.side-nav a[aria-current=page]{background:#173b47;color:white}.side-nav .back-link{display:block;margin-bottom:22px;color:white}.nav-group{margin:20px 0}.nav-group p,.side-title{margin:0 8px 8px;color:#6f9199;font-size:10px;text-transform:uppercase;letter-spacing:.1em}.sidebar-scroll{padding-bottom:40px}.eyebrow{margin:0 0 12px;color:var(--teal);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.hero{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,.7fr);gap:72px;align-items:end;padding:58px 0 74px}.hero h1,.catalog-head h1,.tool-intro h1{font-family:Georgia,serif;font-size:clamp(42px,6vw,84px);line-height:.94;letter-spacing:-.04em;margin:0}.hero h1 em{color:var(--teal);font-weight:400}.hero>div>p{max-width:720px;font-size:19px;line-height:1.6;color:var(--muted)}.hero-actions{display:flex;gap:12px;margin-top:30px}.button{display:inline-block;border:1px solid #77979b;padding:12px 18px;text-decoration:none;color:var(--ink);font-weight:700;font-size:14px}.button.primary{background:var(--navy);color:white;border-color:#31505a}.hero-stats{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);background:var(--white)}.hero-stats div{padding:25px;border:1px solid var(--line)}.hero-stats strong{display:block;font-family:Georgia,serif;font-size:42px}.hero-stats span{font-size:12px;color:var(--muted)}.progress-card{background:var(--navy2);color:white;padding:26px 30px;display:flex;align-items:center;justify-content:space-between}.progress-card p{margin:6px 0;color:#b7d1d2}.progress-card a{color:var(--teal2)}.section-head{display:flex;align-items:end;justify-content:space-between;margin:70px 0 22px}.section-head h2{font-family:Georgia,serif;font-size:36px;margin:0}.section-head a{color:var(--ink)}.part-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.part-card{min-height:178px;padding:23px;background:var(--white);border:1px solid var(--line);text-decoration:none;color:var(--ink);transition:.18s}.part-card:hover,.chapter-card:hover{border-color:var(--teal);transform:translateY(-2px)}.part-card span{color:var(--teal);font-size:11px;font-weight:800;text-transform:uppercase}.part-card h2{font-family:Georgia,serif;font-size:23px}.part-card p{color:var(--muted);font-size:12px}.catalog-head{max-width:900px;margin-bottom:46px}.catalog-head h1,.tool-intro h1{font-size:clamp(40px,6vw,68px)}.catalog-head>p,.tool-intro>p{font-size:18px;line-height:1.6;color:var(--muted)}.search{display:block;margin-top:28px}.search span{display:block;font-size:12px;font-weight:700;margin-bottom:7px}.search input{width:min(560px,100%);padding:14px 16px;border:1px solid #69878b;background:var(--white);color:var(--ink);font:inherit}.catalog-part{display:grid;grid-template-columns:210px 1fr;gap:35px;border-top:1px solid var(--line);padding:32px 0}.catalog-part>div>p{color:var(--teal);font-size:11px;font-weight:800;text-transform:uppercase}.catalog-part h2{font-family:Georgia,serif;font-size:26px}.chapter-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.chapter-card{padding:18px;background:var(--white);border:1px solid var(--line);text-decoration:none;color:var(--ink)}.chapter-card>span{color:var(--teal);font-family:ui-monospace,monospace}.chapter-card h3{font-size:16px;line-height:1.35}.chapter-card p{font-size:11px;color:var(--muted)}.chapter-prose,.prose{max-width:900px;margin:auto}.prose h1{font-family:Georgia,serif;font-size:clamp(34px,5vw,58px);line-height:1.06;letter-spacing:-.025em;margin:0 0 36px}.prose h2{font-family:Georgia,serif;font-size:32px;margin:62px 0 18px;padding-top:10px;border-top:1px solid var(--line)}.prose h3{font-size:20px;margin:38px 0 12px}.prose h4{font-size:16px}.prose p,.prose li{font-size:16px;line-height:1.72}.prose p{margin:13px 0}.prose a{color:var(--link)}.prose pre{overflow:auto;background:var(--navy);color:#d9eeee;padding:18px;border-left:4px solid var(--teal);font-size:13px;line-height:1.55}.prose code{font-family:"Cascadia Code",Consolas,monospace;background:var(--code);padding:.08em .28em}.prose pre code{background:none;padding:0}.prose table{width:100%;border-collapse:collapse;margin:20px 0;background:var(--white)}.prose th,.prose td{padding:10px;border:1px solid var(--line);text-align:left}.prose blockquote{margin:24px 0;padding:5px 20px;border-left:4px solid var(--amber);background:var(--quote)}.prose details{margin:20px 0;padding:16px;border:1px solid var(--line);background:var(--white)}.prose img{max-width:100%}.pager{max-width:900px;margin:60px auto 0;display:grid;grid-template-columns:1fr auto 1fr;gap:14px;border-top:1px solid var(--line);padding-top:24px}.pager a{color:var(--ink);text-decoration:none;font-weight:700}.pager a:last-child{text-align:right}.assessment-link{color:var(--teal)!important}.tool-intro{max-width:950px;margin:0 auto 35px}.study-surface,.compact-prose{max-width:980px;margin:0 auto 38px;background:var(--white);border:1px solid var(--line);padding:clamp(18px,4vw,42px)}.study-app .controls{display:flex;flex-wrap:wrap;gap:8px;margin:15px 0}.study-app button,.study-surface button,.study-app select,.file-label{padding:10px 14px;border:1px solid #63858a;background:var(--white);color:var(--ink);cursor:pointer;font:inherit}.study-app .navbtn[aria-pressed=true]{background:var(--navy);color:white}.study-app .card,.quiz{padding:20px;margin:18px 0;border:1px solid var(--line);background:var(--soft)}.study-app label.option,.quiz label{display:block;padding:10px;margin:8px 0;background:var(--white);border:1px solid var(--line);cursor:pointer}.study-app label.option:has(input:checked){border-color:var(--teal);background:var(--selected)}.study-app .answer-field{display:block;width:100%;max-width:320px;padding:10px;margin-top:6px;background:var(--white);color:var(--ink);border:1px solid var(--line)}.study-app .result{padding:12px;border-left:4px solid var(--teal);background:var(--success)}.study-app .ok{color:var(--teal)}.study-app .bad{color:#e07961}.study-app progress{width:100%}.study-app table{width:100%;border-collapse:collapse}.study-app td,.study-app th{padding:9px;border:1px solid var(--line)}.study-app .hidden-input{display:none}.reference-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:900px;margin:0 auto 44px}.reference-cards a{padding:22px;background:var(--navy2);color:white;text-decoration:none}.reference-cards span{display:block;color:var(--teal2);font-size:11px;text-transform:uppercase;margin-bottom:8px}.reference-cards strong{font-family:Georgia,serif;font-size:20px}@media(max-width:900px){.topbar{gap:18px}.topbar>nav{display:none}.theme-toggle{margin-left:auto}.mobile-menu{display:block}.mobile-menu summary{cursor:pointer}.mobile-menu>div{position:absolute;right:16px;top:58px;background:var(--navy2);padding:18px;box-shadow:0 12px 30px #0008}.mobile-menu .brand{display:none}.mobile-menu nav{display:grid;gap:14px}.with-sidebar{display:block}.side-nav{display:none}.hero{grid-template-columns:1fr;gap:30px}.part-grid{grid-template-columns:1fr 1fr}.catalog-part{grid-template-columns:1fr}.chapter-grid{grid-template-columns:1fr}.reference-cards{grid-template-columns:1fr}.page-main{padding-top:35px}}@media(max-width:560px){.theme-toggle [data-theme-label]{display:none}.part-grid{grid-template-columns:1fr}.hero h1{font-size:44px}.hero-actions{flex-direction:column}.pager{grid-template-columns:1fr}.pager a:last-child{text-align:left}.study-surface{padding:14px}.topbar{padding:0 18px}}@media print{.topbar,.side-nav,.pager{display:none}.with-sidebar{display:block}.page-main{padding:0}.prose{max-width:none}}
/* Chapter quick trainer */
.chapter-trainer{max-width:900px;margin:68px auto 0;padding:clamp(22px,4vw,38px);background:var(--white);border:1px solid var(--line);box-shadow:0 16px 40px #06151d0c}.chapter-trainer>header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:1px solid var(--line)}.chapter-trainer h2{margin:0;font-family:Georgia,serif;font-size:clamp(28px,4vw,38px)}.chapter-trainer header p:last-child{max-width:610px;margin:9px 0 0;color:var(--muted);line-height:1.55}.chapter-trainer>header>strong{flex:0 0 auto;min-width:78px;padding:10px 12px;background:var(--navy2);color:white;text-align:center;font-variant-numeric:tabular-nums}.trainer-question{margin:24px 0 0;padding:0;border:0}.trainer-question legend{display:flex;gap:12px;width:100%;font-size:16px;font-weight:750;line-height:1.45}.trainer-question legend>span{display:grid;flex:0 0 28px;height:28px;place-items:center;background:var(--teal);color:#04191d;font-size:12px}.trainer-options{display:grid;gap:8px;margin:15px 0}.trainer-options label{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:var(--soft);border:1px solid var(--line);cursor:pointer;line-height:1.45}.trainer-options label:has(input:checked){border-color:var(--teal);background:var(--selected)}.trainer-options label.is-correct{border-color:#319480;background:var(--success)}.trainer-options label.is-wrong{border-color:#c45a43;background:var(--quote)}.trainer-options input{margin-top:.25em;accent-color:var(--teal)}.trainer-actions{display:flex;align-items:center;gap:14px}.trainer-actions button{padding:10px 16px;border:1px solid var(--navy);background:var(--navy);color:white;font:700 13px/1.2 inherit;cursor:pointer}.trainer-actions button:disabled{opacity:.55;cursor:not-allowed}.trainer-feedback{margin:0;font-size:13px;line-height:1.45}.trainer-feedback.is-correct{color:#137769}.trainer-feedback.is-wrong{color:#b04f3c}.chapter-trainer>footer{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:27px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.chapter-trainer>footer a{color:var(--link);font-weight:750;text-decoration:none}@media(max-width:560px){.chapter-trainer>header,.chapter-trainer>footer,.trainer-actions{align-items:stretch;flex-direction:column}.chapter-trainer>header>strong{align-self:flex-start}.trainer-feedback{min-height:0}}
/* Chapter practice bridge */
.chapter-practice{max-width:900px;margin:34px auto 0;padding:clamp(20px,3.4vw,32px);background:var(--soft);border:1px solid var(--line)}.chapter-practice header{margin-bottom:18px}.chapter-practice h2{margin:4px 0 0;font-family:Georgia,serif;font-size:clamp(22px,3vw,28px)}.practice-grid{display:grid;gap:10px}.practice-grid a{display:grid;grid-template-columns:58px 1fr;align-items:baseline;gap:4px 14px;padding:14px 16px;background:var(--white);border:1px solid var(--line);color:inherit;text-decoration:none}.practice-grid a:hover{border-color:var(--teal)}.practice-grid span{grid-row:1/3;align-self:center;font-weight:750;font-size:13px;color:var(--link);font-variant-numeric:tabular-nums}.practice-grid strong{font-size:15px;line-height:1.4}.practice-grid em{color:var(--muted);font-size:12.5px;font-style:normal;line-height:1.4}.practice-note{margin:16px 0 0;color:var(--muted);font-size:12.5px;line-height:1.5}@media(max-width:560px){.practice-grid a{grid-template-columns:1fr}.practice-grid span{grid-row:auto}}
/* Term definition card */
.define-card{position:fixed;z-index:60;width:min(430px,calc(100vw - 24px));max-height:min(60vh,460px);overflow:auto;padding:18px 20px 20px;background:var(--white);border:1px solid var(--line);box-shadow:0 22px 54px #06151d2e}.define-close{position:absolute;top:8px;right:8px;padding:2px 8px;border:0;background:transparent;color:var(--muted);font-size:19px;line-height:1;cursor:pointer}.define-close:hover{color:var(--ink)}
.define-term{margin:0 6px 0 0;font-family:Georgia,serif;font-size:20px;line-height:1.25}.define-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;padding-right:26px}.define-source{flex:0 0 auto;font-size:11px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.define-card p{margin:10px 0 0;font-size:14.5px;line-height:1.6}.define-card p.define-def{color:var(--ink)}
.define-card a.define-link{display:inline-block;margin-top:12px;color:var(--link);font-weight:750;font-size:13px;text-decoration:none}.define-card a.define-link:hover{text-decoration:underline}
.define-more{margin-top:15px;padding-top:12px;border-top:1px solid var(--line)}.define-more p{margin:0 0 8px;font-size:12px;color:var(--muted)}
.define-suggest{display:flex;flex-wrap:wrap;gap:7px}.define-suggest button{padding:5px 10px;border:1px solid var(--line);background:var(--soft);color:var(--ink);font:600 12.5px/1.2 inherit;cursor:pointer}.define-suggest button:hover{border-color:var(--teal)}
.define-miss{color:var(--muted)}.define-actions{display:flex;gap:8px;margin-top:14px}.define-actions button{padding:7px 12px;border:1px solid var(--line);background:var(--soft);color:var(--ink);font:600 12.5px/1.2 inherit;cursor:pointer}.define-actions button:hover{border-color:var(--teal)}
@media(max-width:560px){.define-card{left:10px!important;right:10px;width:auto}}
/* Reader notebook */
.notes-toggle{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid #ffffff35;background:#ffffff0b;color:white;font:600 12px/1.2 inherit;cursor:pointer;white-space:nowrap}.notes-toggle:hover{border-color:var(--teal2);background:#ffffff14}.notes-toggle:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}.notes-toggle strong{min-width:18px;padding:2px 5px;border-radius:10px;background:var(--teal);color:#06151d;font-size:10px;text-align:center}.notes-panel{position:fixed;z-index:50;top:68px;right:0;bottom:0;width:min(410px,100vw);padding:24px;background:var(--white);color:var(--ink);border-left:1px solid var(--line);box-shadow:-18px 0 48px #0005;overflow:auto;transform:translateX(105%);visibility:hidden;transition:transform .22s ease,visibility .22s}.notes-panel.is-open{transform:translateX(0);visibility:visible}.notes-backdrop{position:fixed;z-index:45;inset:68px 0 0;border:0;background:#00101899;cursor:default}.notes-head,.notes-library-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.notes-head h2{margin:3px 0 0;font-family:Georgia,serif;font-size:30px}.icon-button,.text-button{border:0;background:transparent;color:var(--ink);cursor:pointer}.icon-button{font-size:30px;line-height:1;padding:2px 6px}.text-button{padding:4px 0;color:var(--link);font-weight:700}.text-button:disabled{opacity:.45;cursor:not-allowed}.selection-card,.note-composer,.notes-library{margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}.selection-card h3,.notes-library h3{margin:0 0 12px;font-size:15px}.selection-preview{min-height:68px;margin:0 0 12px;padding:12px;background:var(--soft);border:1px solid var(--line);color:var(--muted);font-size:13px;line-height:1.5;white-space:pre-wrap}.selection-actions{display:flex;gap:8px}.selection-actions button,.note-composer button{padding:9px 12px;border:1px solid #63858a;background:var(--white);color:var(--ink);font:inherit;cursor:pointer}.selection-actions button:disabled,.highlight-palette button:disabled{opacity:.38;cursor:not-allowed}.highlight-palette{display:flex;align-items:center;gap:10px;margin-top:13px}.undo-highlight{margin-top:13px;padding:0;border:0;background:transparent;color:var(--link);font:700 12px/1.4 inherit;cursor:pointer}.undo-highlight:disabled{opacity:.42;cursor:not-allowed}.color-dot{width:24px;height:24px;padding:0!important;border:2px solid #26363b!important;border-radius:50%;cursor:pointer;box-shadow:0 0 0 1px #ffffffaa}.color-dot:hover:not(:disabled),.color-dot:focus-visible{transform:scale(1.12);outline:2px solid var(--teal);outline-offset:2px}.color-dot.yellow,.reader-highlight[data-color=yellow]{background:#ffe48c!important}.color-dot.green,.reader-highlight[data-color=green]{background:#a9e6bd!important}.color-dot.blue,.reader-highlight[data-color=blue]{background:#a9d8ff!important}.color-dot.pink,.reader-highlight[data-color=pink]{background:#f7b8cf!important}.reader-highlight{color:#102733;padding:.04em .08em;border-radius:2px;box-decoration-break:clone;-webkit-box-decoration-break:clone;cursor:pointer}.reader-highlight:target{outline:3px solid var(--teal);outline-offset:3px}.note-composer label{display:block;margin-bottom:8px;font-size:13px;font-weight:800}.note-composer textarea{width:100%;resize:vertical;padding:12px;border:1px solid #63858a;background:var(--paper);color:var(--ink);font:inherit;line-height:1.5}.note-composer .button{margin-top:9px}.notes-library-head{align-items:baseline}.notes-library-head h3 span{display:inline-block;min-width:22px;margin-left:4px;padding:2px 6px;border-radius:12px;background:var(--soft);text-align:center}.notes-list{display:grid;gap:10px}.notes-empty{color:var(--muted);font-size:13px;line-height:1.5}.note-item{padding:13px;border:1px solid var(--line);background:var(--paper)}.note-item-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.note-kind{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--teal)}.note-item p{margin:9px 0;font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.note-item-source{display:block;color:var(--link);font-size:11px;text-decoration:none}.note-item-actions{display:flex;gap:12px;margin-top:10px}.note-item-actions button{padding:0;border:0;background:transparent;color:var(--link);font:700 11px/1.4 inherit;cursor:pointer}.note-item-actions .danger{color:#c45a43}.selection-toolbar{position:fixed;z-index:60;display:flex;align-items:center;gap:6px;padding:8px;background:var(--navy2);border:1px solid #ffffff2b;box-shadow:0 8px 24px #0007;color:white}.selection-toolbar[hidden]{display:none}.selection-toolbar>button:not(.color-dot){padding:7px 9px;border:1px solid #ffffff30;background:#ffffff0e;color:white;font:600 11px/1.2 inherit;cursor:pointer}.selection-toolbar>button[hidden]{display:none}.selection-toolbar>span{width:1px;height:22px;background:#ffffff38}.selection-toolbar .color-dot{width:20px;height:20px}.reader-toast{position:fixed;z-index:70;right:22px;bottom:22px;max-width:330px;padding:11px 15px;background:var(--navy2);color:white;border:1px solid #ffffff2b;box-shadow:0 8px 24px #0006;font-size:13px;opacity:0;transform:translateY(8px);pointer-events:none;transition:.18s}.reader-toast.is-visible{opacity:1;transform:translateY(0)}
/* Полнотекстовый поиск */
.visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.search-toggle{margin-left:auto;display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid #ffffff35;background:#ffffff0b;color:white;font:600 12px/1.2 inherit;cursor:pointer;white-space:nowrap}
.search-toggle:hover{border-color:var(--teal2);background:#ffffff14}
.search-toggle:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}
.search-toggle kbd{padding:2px 5px;border:1px solid #ffffff30;background:#ffffff12;font:600 10px/1.3 inherit;letter-spacing:.04em}
.topbar .search-toggle~.theme-toggle{margin-left:0}
.search-overlay{position:fixed;inset:0;z-index:60;display:flex;justify-content:center;padding:min(12vh,110px) 16px 24px;background:#04141ba8;backdrop-filter:blur(2px)}
.search-overlay[hidden]{display:none}
.search-panel{display:flex;flex-direction:column;width:min(760px,100%);max-height:76vh;background:var(--white);border:1px solid var(--line);box-shadow:0 30px 80px #04141b40}
.search-field{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}
.search-field>span{color:var(--muted);font-size:22px;line-height:1}
.search-field input{flex:1;min-width:0;padding:8px 2px;border:0;background:transparent;color:var(--ink);font:400 17px/1.4 inherit}
.search-field input:focus{outline:none}
.search-status{margin:0;padding:10px 16px;color:var(--muted);font-size:12.5px;border-bottom:1px solid var(--line)}
.search-results{overflow-y:auto;padding:6px 0 10px}
.search-hit{display:block;padding:13px 16px;border-bottom:1px solid var(--line);color:inherit;text-decoration:none}
.search-hit:last-child{border-bottom:0}
.search-hit:hover,.search-hit:focus-visible,.search-hit.is-active{background:var(--soft);outline:none}
.search-hit strong{display:block;font-size:15px;line-height:1.35}
.search-hit em{display:block;margin-top:3px;color:var(--muted);font-style:normal;font-size:12px}
.search-hit p{margin:6px 0 0;color:var(--ink);font-size:13.5px;line-height:1.5}
.search-hit mark{background:var(--teal2);color:#04191d;padding:0 1px}
@media(max-width:900px){.topbar{gap:12px}.search-toggle span:nth-child(2),.search-toggle kbd{display:none}.notes-toggle span:nth-child(2){display:none}.notes-panel{top:68px}.selection-toolbar{left:10px!important;right:10px;bottom:12px;top:auto!important;justify-content:center;flex-wrap:wrap}}@media(max-width:560px){.notes-toggle{padding:8px}.theme-toggle{padding:8px}.notes-panel{padding:19px}.notes-backdrop{display:none}.selection-toolbar>button:not(.color-dot){font-size:10px}}@media print{.notes-toggle,.notes-panel,.notes-backdrop,.selection-toolbar,.reader-toast{display:none!important}.reader-highlight{background:transparent!important;color:inherit;padding:0}}
`;

const js = `(() => {'use strict';
const THEME_KEY='server-infrastructure-theme',themeButton=document.querySelector('[data-theme-toggle]');
const applyTheme=theme=>{document.documentElement.dataset.theme=theme;if(themeButton){const dark=theme==='dark';themeButton.setAttribute('aria-pressed',String(dark));themeButton.querySelector('[data-theme-label]').textContent=dark?'Светлая тема':'Тёмная тема';themeButton.querySelector('[data-theme-icon]').textContent=dark?'☀':'◐';}};
applyTheme(document.documentElement.dataset.theme||'light');themeButton?.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(THEME_KEY,next)}catch{}applyTheme(next);});
const READER_KEY='server-infrastructure-reader-v1',readerPath=location.pathname,readerTitle=document.title.replace(' · Серверная инфраструктура','');
const readerPanel=document.querySelector('[data-notes-panel]'),readerToggle=document.querySelector('[data-notes-toggle]'),readerBackdrop=document.querySelector('.notes-backdrop'),readerPreview=document.querySelector('[data-selection-preview]'),readerList=document.querySelector('[data-notes-list]'),readerInput=document.querySelector('[data-note-input]'),readerToolbar=document.querySelector('[data-selection-toolbar]'),readerToast=document.querySelector('[data-reader-toast]'),readerRoots=[...document.querySelectorAll('.prose')];
const readReader=()=>{try{const data=JSON.parse(localStorage.getItem(READER_KEY)||'null');return{notes:Array.isArray(data?.notes)?data.notes:[],highlights:Array.isArray(data?.highlights)?data.highlights:[]}}catch{return{notes:[],highlights:[]}}};
let readerState=readReader(),activeSelection=null,activeHighlightId=null,selectionControlActive=false,toastTimer=0;
const saveReader=()=>{try{localStorage.setItem(READER_KEY,JSON.stringify(readerState))}catch{showToast('Не удалось сохранить данные в браузере')}};
const showToast=message=>{if(!readerToast)return;readerToast.textContent=message;readerToast.classList.add('is-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>readerToast.classList.remove('is-visible'),1800)};
const makeId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const escapeText=value=>String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
const copyText=async text=>{if(!text)return false;try{await navigator.clipboard.writeText(text)}catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)return false}showToast('Скопировано в буфер обмена');return true};
const openNotes=()=>{readerPanel?.classList.add('is-open');readerPanel?.setAttribute('aria-hidden','false');readerToggle?.setAttribute('aria-expanded','true');if(readerBackdrop)readerBackdrop.hidden=false;if(!activeSelection)setTimeout(()=>readerInput?.focus(),40)};
const closeNotes=()=>{readerPanel?.classList.remove('is-open');readerPanel?.setAttribute('aria-hidden','true');readerToggle?.setAttribute('aria-expanded','false');if(readerBackdrop)readerBackdrop.hidden=true;readerToggle?.focus()};
readerToggle?.addEventListener('click',openNotes);document.querySelectorAll('[data-notes-close]').forEach(button=>button.addEventListener('click',closeNotes));document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(readerPanel?.classList.contains('is-open'))closeNotes();if(!readerToolbar?.hidden){getSelection()?.removeAllRanges();clearSelectionUi()}});
const removeHighlightMarks=id=>{document.querySelectorAll('[data-reading-highlight]').forEach(mark=>{if(mark.dataset.readingHighlight!==id)return;const parent=mark.parentNode;mark.replaceWith(...mark.childNodes);parent?.normalize()})};
const deleteHighlight=(id,message='Выделение отменено')=>{readerState.highlights=readerState.highlights.filter(item=>item.id!==id);removeHighlightMarks(id);saveReader();renderReader();clearSelectionUi();showToast(message)};
const applyHighlight=record=>{if(record.path!==readerPath)return false;const root=readerRoots[record.rootIndex];if(!root)return false;let start=Number(record.start),end=Number(record.end),full=root.textContent||'';if(full.slice(start,end)!==record.text){start=full.indexOf(record.text);end=start+record.text.length}if(start<0||end<=start)return false;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),segments=[];let position=0,node;while((node=walker.nextNode())){const nodeStart=position,nodeEnd=position+node.data.length;if(nodeEnd>start&&nodeStart<end)segments.push({node,from:Math.max(0,start-nodeStart),to:Math.min(node.data.length,end-nodeStart)});position=nodeEnd}segments.reverse().forEach((segment,index)=>{const range=document.createRange();range.setStart(segment.node,segment.from);range.setEnd(segment.node,segment.to);const mark=document.createElement('mark');mark.className='reader-highlight';mark.dataset.readingHighlight=record.id;mark.dataset.color=record.color;if(index===segments.length-1)mark.id='reader-highlight-'+record.id;range.surroundContents(mark)});return segments.length>0};
readerState.highlights.filter(item=>item.path===readerPath).sort((a,b)=>Number(a.start)-Number(b.start)).forEach(applyHighlight);
const itemLabel=item=>item.kind==='note'?'Заметка':item.kind==='quote'?'Цитата':'Маркер';
const renderReader=()=>{const entries=[...readerState.notes,...readerState.highlights.map(item=>({...item,kind:'highlight'}))].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),count=entries.length;document.querySelectorAll('[data-notes-count]').forEach(node=>node.textContent=String(count));document.querySelectorAll('[data-notes-badge]').forEach(node=>{node.textContent=String(count);node.hidden=!count});document.querySelectorAll('[data-copy-all]').forEach(node=>node.disabled=!count);document.querySelectorAll('[data-undo-highlight]').forEach(node=>node.disabled=!readerState.highlights.length);if(!readerList)return;if(!count){readerList.innerHTML='<p class="notes-empty">Здесь появятся ваши заметки, цитаты и цветные выделения.</p>';return}readerList.innerHTML=entries.map(item=>{const href=item.path+(item.kind==='highlight'?'#reader-highlight-'+item.id:'');return '<article class="note-item"><div class="note-item-head"><span class="note-kind">'+itemLabel(item)+'</span><time datetime="'+escapeText(item.createdAt)+'">'+new Date(item.createdAt).toLocaleDateString('ru-RU')+'</time></div><p>'+escapeText(item.text)+'</p><a class="note-item-source" href="'+escapeText(href)+'">'+escapeText(item.title||item.path)+'</a><div class="note-item-actions"><button type="button" data-copy-item="'+escapeText(item.id)+'" data-item-kind="'+escapeText(item.kind)+'">Копировать</button><button type="button" class="danger" data-delete-item="'+escapeText(item.id)+'" data-item-kind="'+escapeText(item.kind)+'">Удалить</button></div></article>'}).join('')};
renderReader();
const setSelectionControls=enabled=>{document.querySelectorAll('[data-copy-selection],[data-save-quote],[data-highlight-color],[data-define-selection]').forEach(button=>button.disabled=!enabled)};
const positionToolbar=rect=>{if(!readerToolbar)return;readerToolbar.hidden=false;readerToolbar.style.left=Math.max(10,Math.min(innerWidth-readerToolbar.offsetWidth-10,rect.left+rect.width/2-readerToolbar.offsetWidth/2))+'px';readerToolbar.style.top=Math.max(76,rect.top-readerToolbar.offsetHeight-10)+'px'};
const clearSelectionUi=()=>{activeSelection=null;activeHighlightId=null;setSelectionControls(false);document.querySelectorAll('[data-remove-current-highlight]').forEach(button=>button.hidden=true);if(readerPreview)readerPreview.textContent='Выделите слово или фрагмент в учебнике: справочник покажет определение, текст можно скопировать, сохранить или отметить цветом.';if(readerToolbar)readerToolbar.hidden=true};
const captureSelection=()=>{const selection=getSelection();if(!selection||selection.rangeCount!==1||selection.isCollapsed){if(!selectionControlActive)clearSelectionUi();return}const range=selection.getRangeAt(0),startElement=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement,endElement=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement,root=startElement?.closest('.prose');if(!root||!root.contains(endElement)||readerPanel?.contains(startElement)||readerToolbar?.contains(startElement)){if(!selectionControlActive)clearSelectionUi();return}const before=document.createRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);const text=range.toString();if(!text.trim()){if(!selectionControlActive)clearSelectionUi();return}activeHighlightId=null;document.querySelectorAll('[data-remove-current-highlight]').forEach(button=>button.hidden=true);activeSelection={text,path:readerPath,title:readerTitle,rootIndex:readerRoots.indexOf(root),start:before.toString().length,end:before.toString().length+text.length};setSelectionControls(true);if(readerPreview)readerPreview.textContent=text.length>500?text.slice(0,500)+'…':text;positionToolbar(range.getBoundingClientRect())};
document.addEventListener('selectionchange',()=>requestAnimationFrame(captureSelection));const protectSelection=event=>{if(!activeSelection)return;selectionControlActive=true;event.preventDefault()};document.querySelectorAll('[data-copy-selection],[data-save-quote],[data-highlight-color],[data-remove-current-highlight],[data-notes-toggle],[data-define-selection]').forEach(button=>{button.addEventListener('pointerdown',protectSelection);button.addEventListener('mousedown',protectSelection)});const releaseSelectionControl=()=>setTimeout(()=>{selectionControlActive=false},0);document.addEventListener('pointerup',releaseSelectionControl);document.addEventListener('mouseup',releaseSelectionControl);
document.querySelectorAll('[data-copy-selection]').forEach(button=>button.addEventListener('click',()=>activeSelection&&copyText(activeSelection.text)));
document.querySelectorAll('[data-save-quote]').forEach(button=>button.addEventListener('click',()=>{if(!activeSelection)return;readerState.notes.push({id:makeId(),kind:'quote',text:activeSelection.text.trim(),path:readerPath,title:readerTitle,createdAt:new Date().toISOString()});saveReader();renderReader();showToast('Цитата сохранена');openNotes()}));
document.querySelectorAll('[data-highlight-color]').forEach(button=>button.addEventListener('click',()=>{if(!activeSelection)return;if(activeHighlightId){const record=readerState.highlights.find(item=>item.id===activeHighlightId);if(!record)return;if(record.color===button.dataset.highlightColor)return showToast('Этот цвет уже выбран');record.color=button.dataset.highlightColor;document.querySelectorAll('[data-reading-highlight]').forEach(mark=>{if(mark.dataset.readingHighlight===record.id)mark.dataset.color=record.color});saveReader();renderReader();return showToast('Цвет маркера изменён')}const overlaps=readerState.highlights.some(item=>item.path===readerPath&&item.rootIndex===activeSelection.rootIndex&&Number(item.start)<activeSelection.end&&Number(item.end)>activeSelection.start);if(overlaps)return showToast('Этот фрагмент пересекается с другим маркером');const record={id:makeId(),text:activeSelection.text,path:readerPath,title:readerTitle,rootIndex:activeSelection.rootIndex,start:activeSelection.start,end:activeSelection.end,color:button.dataset.highlightColor,createdAt:new Date().toISOString()};readerState.highlights.push(record);saveReader();applyHighlight(record);getSelection()?.removeAllRanges();clearSelectionUi();renderReader();showToast('Текст выделен цветом')}));
document.addEventListener('click',event=>{const mark=event.target.closest?.('[data-reading-highlight]');if(!mark)return;const record=readerState.highlights.find(item=>item.id===mark.dataset.readingHighlight);if(!record)return;activeHighlightId=record.id;activeSelection={...record};setSelectionControls(true);document.querySelectorAll('[data-remove-current-highlight]').forEach(button=>button.hidden=false);if(readerPreview)readerPreview.textContent=record.text;positionToolbar(mark.getBoundingClientRect())});
document.querySelectorAll('[data-remove-current-highlight]').forEach(button=>button.addEventListener('click',()=>activeHighlightId&&deleteHighlight(activeHighlightId)));
document.querySelectorAll('[data-undo-highlight]').forEach(button=>button.addEventListener('click',()=>{const latest=readerState.highlights.at(-1);if(latest)deleteHighlight(latest.id,'Последнее выделение отменено')}));
document.querySelector('[data-add-note]')?.addEventListener('click',()=>{const text=readerInput?.value.trim();if(!text)return showToast('Сначала напишите заметку');readerState.notes.push({id:makeId(),kind:'note',text,path:readerPath,title:readerTitle,createdAt:new Date().toISOString()});readerInput.value='';saveReader();renderReader();showToast('Заметка сохранена')});
readerList?.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const id=button.dataset.copyItem||button.dataset.deleteItem,kind=button.dataset.itemKind;if(button.dataset.copyItem){const collection=kind==='highlight'?readerState.highlights:readerState.notes,item=collection.find(entry=>entry.id===id);if(item)copyText(item.text);return}if(button.dataset.deleteItem){if(kind==='highlight')return deleteHighlight(id,'Маркер удалён');readerState.notes=readerState.notes.filter(item=>item.id!==id);saveReader();renderReader();showToast('Удалено')}});
document.querySelector('[data-copy-all]')?.addEventListener('click',()=>{const entries=[...readerState.notes,...readerState.highlights.map(item=>({...item,kind:'highlight'}))].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));copyText(entries.map(item=>'['+itemLabel(item)+'] '+item.text+'\\n'+item.title+' — '+location.origin+item.path).join('\\n\\n'))});
const KEY='server-infrastructure-selfstudy-v6';
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}};
const freshProgress=()=>({schema:'course-study-progress',version:${JSON.stringify(studyDatabase.version)},records:{},scenarios:{},exam:null,history:[],practice:null});
let state=read();if(!state||state.schema!=='course-study-progress'||state.version!==${JSON.stringify(studyDatabase.version)}||!state.records||typeof state.records!=='object'||Array.isArray(state.records))state=freshProgress();
const records=state.records,history=Array.isArray(state.history)?state.history:[];
const renderCourseProgress=()=>{const correct=Object.values(records).filter(x=>x?.correct).length,best=Math.max(0,...history.map(x=>Number(x.correct||0)));document.querySelectorAll('[data-progress-title]').forEach(x=>x.textContent=correct?correct+' проверок выполнено верно':'Маршрут ещё не начат');document.querySelectorAll('[data-progress-copy]').forEach(x=>x.textContent='Python: '+Number(state?.practice?.passed||0)+'/28 · итоговый тест: '+best+'/28');return{correct,best}};
const progressTotals=renderCourseProgress();
/* ---------- Справка по терминам ---------- */
const TERMS=${JSON.stringify(referenceTerms)};
const defineCard=document.querySelector('[data-define-card]'),defineBody=document.querySelector('[data-define-body]');
// Нормализация: регистр, ё, и вся пунктуация кроме символов, встречающихся внутри
// самих терминов (/ . _ - +) — чтобы «/proc», «set -euo pipefail» и «network.target» находились.
const defNorm=value=>String(value??'').toLowerCase().replace(/ё/g,'е').replace(/[^0-9a-zа-я/._+-]+/g,' ').replace(/\\s+/g,' ').trim();
// Грубый стеммер для русских слов: снимает падежные окончания, чтобы «маршрутизации»
// находило «Маршрутизация». Латиницу не трогает — там окончаний нет.
const defStem=word=>/^[а-я]/.test(word)&&word.length>4?word.replace(/(иями|ями|ами|ого|его|ыми|ими|ой|ей|ый|ий|ая|яя|ое|ее|ые|ие|ах|ях|ам|ям|ом|ем|ов|ев|у|ю|а|я|ы|и|е|о|й|ь)$/,''):word;
const defKey=value=>defNorm(value).split(' ').map(defStem).join(' ');
const DEF_INDEX=new Map();
TERMS.forEach((entry,index)=>{
  for(const variant of [entry.term,...entry.aliases]){
    for(const key of [defNorm(variant),defKey(variant)]){
      if(key&&!DEF_INDEX.has(key))DEF_INDEX.set(key,index);
    }
  }
});
const defLookup=text=>{
  const tokens=defNorm(text).split(' ').filter(Boolean);
  if(!tokens.length)return null;
  // от самой длинной сочетаемости к самой короткой: «page cache» важнее, чем «cache»
  for(let size=Math.min(tokens.length,5);size>0;size-=1){
    for(let start=0;start+size<=tokens.length;start+=1){
      const window=tokens.slice(start,start+size);
      const hit=DEF_INDEX.get(window.join(' '))??DEF_INDEX.get(window.map(defStem).join(' '));
      if(hit!==undefined)return TERMS[hit];
    }
  }
  return null;
};
const defSuggest=text=>{
  const tokens=defNorm(text).split(' ').filter(token=>token.length>=3);
  if(!tokens.length)return [];
  const found=new Set();
  for(const token of tokens){
    const stem=defStem(token);
    TERMS.forEach((entry,index)=>{
      if(found.size>=6)return;
      const key=defNorm(entry.term);
      if(key.startsWith(stem)||key.includes(token))found.add(index);
    });
  }
  return [...found].slice(0,6).map(index=>TERMS[index]);
};
const defChapterHref=entry=>entry.chapter===null?null:'/chapters/'+String(entry.chapter).padStart(2,'0')+'/#b'+String(entry.chapter).padStart(2,'0');
const hideDefine=()=>{if(defineCard)defineCard.hidden=true};
const showDefine=(entry,query,rect)=>{
  if(!defineCard||!defineBody)return;
  if(entry){
    const href=defChapterHref(entry);
    defineBody.innerHTML='<div class="define-head"><h3 class="define-term">'+escapeText(entry.term)+'</h3><span class="define-source">справочник курса</span></div>'
      +'<p class="define-def">'+entry.html+'</p>'
      +(href?'<a class="define-link" href="'+href+'">Разбор в главе '+String(entry.chapter).padStart(2,'0')+' →</a>':'')
      +'<div class="define-actions"><button type="button" data-define-copy>Копировать</button><button type="button" data-define-note>Сохранить в заметки</button></div>';
    defineBody.dataset.term=entry.term;
    defineBody.dataset.text=entry.term+' — '+entry.html.replace(/<[^>]+>/g,'');
  }else{
    const near=defSuggest(query);
    defineBody.innerHTML='<div class="define-head"><h3 class="define-term">Определения нет</h3></div>'
      +'<p class="define-miss">В справочнике курса нет статьи для «'+escapeText(query.length>60?query.slice(0,60)+'…':query)+'». Справочник покрывает термины глоссария и ключевые понятия глав.</p>'
      +(near.length?'<div class="define-more"><p>Возможно, вы искали:</p><div class="define-suggest">'+near.map(item=>'<button type="button" data-define-pick="'+escapeText(item.term)+'">'+escapeText(item.term)+'</button>').join('')+'</div></div>':'');
    delete defineBody.dataset.term;
    delete defineBody.dataset.text;
  }
  defineCard.hidden=false;
  const width=defineCard.offsetWidth,height=defineCard.offsetHeight;
  const left=rect?Math.max(10,Math.min(innerWidth-width-10,rect.left+rect.width/2-width/2)):Math.max(10,innerWidth-width-24);
  const below=rect?rect.bottom+10:96;
  const top=rect&&below+height>innerHeight-10?Math.max(76,rect.top-height-10):Math.min(below,Math.max(76,innerHeight-height-10));
  defineCard.style.left=left+'px';
  defineCard.style.top=top+'px';
};
const defineFromText=(text,rect)=>{
  const query=String(text||'').trim();
  if(!query)return showToast('Сначала выделите слово или сочетание');
  showDefine(defLookup(query),query,rect);
};
const selectionRect=()=>{
  const selection=getSelection();
  if(selection&&selection.rangeCount===1&&!selection.isCollapsed)return selection.getRangeAt(0).getBoundingClientRect();
  return readerToolbar&&!readerToolbar.hidden?readerToolbar.getBoundingClientRect():null;
};
document.querySelectorAll('[data-define-selection]').forEach(button=>button.addEventListener('click',()=>{
  if(!activeSelection)return showToast('Сначала выделите слово или сочетание');
  defineFromText(activeSelection.text,selectionRect());
}));
document.querySelectorAll('[data-define-close]').forEach(button=>button.addEventListener('click',hideDefine));
defineCard?.addEventListener('click',event=>{
  const pick=event.target.closest('[data-define-pick]');
  if(pick)return defineFromText(pick.dataset.definePick,defineCard.getBoundingClientRect());
  if(event.target.closest('[data-define-copy]'))return copyText(defineBody.dataset.text||'').then(()=>showToast('Определение скопировано'));
  if(event.target.closest('[data-define-note]')){
    const text=defineBody.dataset.text;
    if(!text)return;
    readerState.notes.push({id:makeId(),kind:'quote',text,path:readerPath,title:readerTitle,createdAt:new Date().toISOString()});
    saveReader();renderReader();showToast('Определение сохранено в заметки');
  }
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideDefine()});
document.addEventListener('pointerdown',event=>{
  if(defineCard?.hidden)return;
  if(defineCard.contains(event.target)||event.target.closest?.('[data-define-selection]'))return;
  hideDefine();
});
const QUICK_KEY='server-infrastructure-chapter-trainers-v1';
const readQuick=()=>{try{const value=JSON.parse(localStorage.getItem(QUICK_KEY)||'null');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return{}}};
const quickRecords=readQuick(),saveQuick=()=>{try{localStorage.setItem(QUICK_KEY,JSON.stringify(quickRecords));return true}catch{return false}};
const recordQuickCheck=(id,correct)=>{const old=quickRecords[id];quickRecords[id]={correct,attempts:(old?.attempts||0)+1,last:Date.now()};saveQuick()};
const answerDigest=(id,index)=>{let hash=0x811c9dc5;for(const character of id+'|'+index+'|sic6')hash=Math.imul(hash^character.charCodeAt(0),0x01000193)>>>0;return hash.toString(36)};
const answerIndex=question=>{const id=question.dataset.trainerQuestion,digest=question.dataset.answer,total=question.querySelectorAll('input[type=radio]').length;for(let index=0;index<total;index+=1)if(answerDigest(id,index)===digest)return index;return -1};
document.querySelectorAll('[data-chapter-trainer]').forEach(trainer=>{const questions=[...trainer.querySelectorAll('[data-trainer-question]')],score=trainer.querySelector('[data-trainer-score]'),summary=trainer.querySelector('[data-trainer-summary]');const refresh=()=>{const done=questions.filter(question=>quickRecords[question.dataset.trainerQuestion]?.correct).length;score.textContent=done+' / '+questions.length;summary.textContent=done===questions.length?'Глава закреплена. Можно переходить дальше.':done?'Верно: '+done+' из '+questions.length+'. Завершите мини-тренажёр.':'Ответьте на оба вопроса.';trainer.classList.toggle('is-complete',done===questions.length)};questions.forEach(question=>{const id=question.dataset.trainerQuestion,answer=answerIndex(question),button=question.querySelector('[data-trainer-check]'),feedback=question.querySelector('[data-trainer-feedback]'),inputs=[...question.querySelectorAll('input[type=radio]')],labels=[...question.querySelectorAll('.trainer-options label')];const showResult=(correct,restored=false)=>{labels.forEach(label=>label.classList.remove('is-correct','is-wrong'));labels[answer]?.classList.add('is-correct');const chosen=inputs.find(input=>input.checked);if(chosen&&!correct)chosen.closest('label')?.classList.add('is-wrong');feedback.hidden=false;feedback.className='trainer-feedback '+(correct?'is-correct':'is-wrong');feedback.textContent=(restored?'Ранее отвечено верно. ':correct?'Верно. ':'Пока неверно. ')+feedback.dataset.explanation;if(correct){inputs.forEach(input=>input.disabled=true);button.disabled=true;button.textContent='Засчитано'}else{button.textContent='Проверить ещё раз'}};if(quickRecords[id]?.correct){inputs[answer].checked=true;showResult(true,true)}button.addEventListener('click',()=>{const selected=inputs.find(input=>input.checked);if(!selected){feedback.hidden=false;feedback.className='trainer-feedback is-wrong';feedback.textContent='Сначала выберите вариант ответа.';return}const correct=Number(selected.value)===answer;recordQuickCheck(id,correct);showResult(correct);refresh()})});refresh()});
/* Полнотекстовый поиск. Индекс лежит отдельным файлом и загружается один раз при
   первом открытии панели, поэтому страница не тяжелеет от 76 тысяч слов. */
const searchOverlay=document.querySelector('[data-search-overlay]'),searchInput=document.querySelector('[data-search-input]'),searchStatus=document.querySelector('[data-search-status]'),searchResults=document.querySelector('[data-search-results]');
const fold=text=>String(text).toLowerCase().replace(/ё/g,'е');
let searchIndex=null,searchRequest=null,searchTimer=0,searchReturnFocus=null;
const loadSearchIndex=()=>{
  if(searchIndex)return Promise.resolve(searchIndex);
  if(!searchRequest)searchRequest=fetch('/assets/search.json').then(response=>{if(!response.ok)throw new Error('HTTP '+response.status);return response.json()}).then(data=>{searchIndex=data.map(entry=>({...entry,f:fold(entry.h+' '+entry.x)}));return searchIndex});
  return searchRequest;
};
const markTerms=(raw,terms)=>{
  const folded=fold(raw),ranges=[];
  for(const term of terms){let from=0,at;while((at=folded.indexOf(term,from))>=0){ranges.push([at,at+term.length]);from=at+term.length}}
  ranges.sort((a,b)=>a[0]-b[0]);
  let html='',cursor=0;
  for(const [start,end] of ranges){if(start<cursor)continue;html+=escapeText(raw.slice(cursor,start))+'<mark>'+escapeText(raw.slice(start,end))+'</mark>';cursor=end}
  return html+escapeText(raw.slice(cursor));
};
const excerpt=(text,terms)=>{
  const folded=fold(text);let at=-1;
  for(const term of terms){const found=folded.indexOf(term);if(found>=0&&(at<0||found<at))at=found}
  const start=Math.max(0,(at<0?0:at)-90),end=Math.min(text.length,start+280);
  return (start>0?'… ':'')+text.slice(start,end).trim()+(end<text.length?' …':'');
};
const renderSearch=(query,index)=>{
  const terms=[...new Set(fold(query).split(/[^\\p{L}\\p{N}._-]+/u).filter(term=>term.length>1))];
  if(!terms.length){searchResults.innerHTML='';searchStatus.textContent='Введите не меньше двух символов.';return}
  const hits=[];
  for(const entry of index){
    let score=0,missing=false;
    for(const term of terms){
      let count=0,from=0,at;
      while((at=entry.f.indexOf(term,from))>=0){count+=1;from=at+term.length}
      if(!count){missing=true;break}
      score+=count+(fold(entry.h).includes(term)?12:0);
    }
    if(!missing)hits.push({entry,score});
  }
  hits.sort((a,b)=>b.score-a.score);
  if(!hits.length){searchResults.innerHTML='';searchStatus.textContent='Ничего не найдено. Попробуйте более короткое слово или основу термина.';return}
  searchStatus.textContent='Найдено разделов: '+hits.length+(hits.length>40?' — показаны первые 40':'');
  searchResults.innerHTML=hits.slice(0,40).map(({entry})=>{
    const href=entry.u+(entry.a?'#'+entry.a:'');
    return '<a class="search-hit" href="'+escapeText(href)+'"><strong>'+markTerms(entry.h,terms)+'</strong><em>'+escapeText(entry.t)+'</em><p>'+markTerms(excerpt(entry.x,terms),terms)+'</p></a>';
  }).join('');
};
const scheduleSearch=()=>{
  clearTimeout(searchTimer);
  const query=searchInput.value.trim();
  if(query.length<2){searchResults.innerHTML='';searchStatus.textContent='Введите не меньше двух символов.';return}
  searchTimer=setTimeout(()=>{
    searchStatus.textContent='Ищем…';
    loadSearchIndex().then(index=>{if(searchInput.value.trim()===query)renderSearch(query,index)})
      .catch(()=>{searchStatus.textContent='Не удалось загрузить поисковый индекс.'});
  },120);
};
const activeHit=()=>searchResults.querySelector('.search-hit.is-active');
const moveHit=step=>{
  const hits=[...searchResults.querySelectorAll('.search-hit')];
  if(!hits.length)return;
  const current=hits.indexOf(activeHit());
  const next=hits[Math.min(hits.length-1,Math.max(0,current<0?0:current+step))];
  hits.forEach(hit=>hit.classList.remove('is-active'));
  next.classList.add('is-active');
  next.scrollIntoView({block:'nearest'});
};
const closeSearch=()=>{
  if(!searchOverlay||searchOverlay.hidden)return;
  searchOverlay.hidden=true;
  searchReturnFocus?.focus?.();
};
const openSearch=()=>{
  if(!searchOverlay)return;
  searchReturnFocus=document.activeElement;
  searchOverlay.hidden=false;
  searchInput.select();
  searchInput.focus();
  loadSearchIndex().catch(()=>{});
};
if(searchOverlay){
  document.querySelectorAll('[data-search-open]').forEach(button=>button.addEventListener('click',openSearch));
  document.querySelectorAll('[data-search-close]').forEach(button=>button.addEventListener('click',closeSearch));
  searchOverlay.addEventListener('pointerdown',event=>{if(event.target===searchOverlay)closeSearch()});
  searchInput.addEventListener('input',scheduleSearch);
  searchOverlay.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeSearch();return}
    if(event.key==='ArrowDown'){event.preventDefault();moveHit(1);return}
    if(event.key==='ArrowUp'){event.preventDefault();moveHit(-1);return}
    if(event.key==='Enter'){const hit=activeHit();if(hit){event.preventDefault();hit.click()}}
  });
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchOverlay.hidden?openSearch():closeSearch()}
  });
}
const search=document.querySelector('[data-course-search]');if(search)search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();document.querySelectorAll('[data-course-card]').forEach(card=>card.hidden=q&&!card.dataset.courseCard.includes(q));document.querySelectorAll('[data-course-group]').forEach(group=>group.hidden=![...group.querySelectorAll('[data-course-card]')].some(card=>!card.hidden));});
const context=document.modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}};
register({name:'get_course_progress',title:'Показать прогресс курса',description:'Возвращает краткий прогресс самостоятельного обучения в этом браузере.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>({answeredChecks:Object.keys(records).length,correctChecks:progressTotals.correct,programmingTestsPassed:Number(state?.practice?.passed||0),bestFinalExam:progressTotals.best})});
register({name:'open_course_module',title:'Открыть модуль курса',description:'Переходит на отдельную страницу одного из 28 модулей курса.',inputSchema:{type:'object',properties:{module:{type:'integer',minimum:0,maximum:27}},required:['module'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:input=>{const n=input?.module;if(!Number.isInteger(n)||n<0||n>27)throw Error('Номер модуля должен быть целым числом от 0 до 27.');location.href='/chapters/'+String(n).padStart(2,'0')+'/';return{openedModule:n};}});
})();`;

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'assets'), { recursive: true });
await Promise.all([
  writeFile(resolve(output, 'index.html'), home),
  writeFile(resolve(output, 'curriculum', 'index.html'), curriculum).catch(async (error) => { await mkdir(resolve(output, 'curriculum'), { recursive: true }); await writeFile(resolve(output, 'curriculum', 'index.html'), curriculum); }),
  writeFile(resolve(output, 'assets', 'site.css'), css),
  writeFile(resolve(output, 'assets', 'site.js'), js),
  cp(resolve(root, 'public', 'favicon.svg'), resolve(output, 'assets', 'favicon.svg')),
]);

const outputs = [
  ...chapters.map((item) => [item.url, chapterPage(item)]),
  ...labs.map((item) => [item.url, labPage(item)]),
  ['/about/', about], ['/assessment/', assessment], ['/assessment/a1/', a1], ['/reference/', reference], ['/reference/archive/', archive],
];
for (const [url, html] of outputs) {
  const file = resolve(output, url.slice(1), 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}

// ---------- Индекс полнотекстового поиска ----------
// Единица поиска — раздел, а не страница: результат ведёт сразу к нужному месту главы.
// Индекс собирается из готовых страниц, поэтому он не может разойтись с тем, что читает
// читатель. Мини-тренажёр из индекса исключён: его вопросы — не текст учебника.
const searchDocuments = [];
const indexPage = (url, html) => {
  const title = strip(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? url).replace(/\s*·\s*Серверная инфраструктура$/, '');
  const mainMatch = html.match(/<main class="page-main">([\s\S]*)<\/main>/);
  if (!mainMatch) return;
  const main = mainMatch[1]
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<section class="chapter-trainer"[\s\S]*?<\/section>/g, ' ');
  const headings = Array.from(main.matchAll(/<h([1-4])[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g));
  const blocks = headings.length
    ? headings.map((match, order) => ({
      anchor: match[2],
      heading: strip(match[3]),
      body: main.slice(match.index + match[0].length, headings[order + 1]?.index ?? main.length),
    }))
    : [{ anchor: '', heading: title, body: main }];
  const before = searchDocuments.length;
  for (const block of blocks) {
    const text = decode(strip(block.body));
    if (text.length < 40) continue;
    searchDocuments.push({ u: url, t: title, a: block.anchor, h: decode(block.heading), x: text });
  }
  // Страница целиком из интерактивных блоков (тренажёр A1) не даёт ни одного раздела —
  // она всё равно должна находиться по названию, иначе маршрут выпадает из поиска.
  if (searchDocuments.length === before) searchDocuments.push({ u: url, t: title, a: '', h: title, x: decode(strip(main)) });
};
indexPage('/', home);
indexPage('/curriculum/', curriculum);
for (const [url, html] of outputs) indexPage(url, html);
if (searchDocuments.length < 400) throw new Error(`Search index too small: ${searchDocuments.length} sections`);
await writeFile(resolve(output, 'assets', 'search.json'), JSON.stringify(searchDocuments));

const htmlFiles = ['index.html', 'curriculum/index.html', ...outputs.map(([url]) => `${url.slice(1)}index.html`)];
for (const relative of htmlFiles) {
  const html = await readFile(resolve(output, relative), 'utf8');
  if (!html.includes('<title>') || !html.includes('/assets/site.css')) throw new Error(`Invalid generated page: ${relative}`);
}
const manifest = { generatedAt: new Date().toISOString(), sourceSha256: sha256(source), routes: htmlFiles.length, chapters: chapters.length, labs: labs.length };
await writeFile(resolve(output, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Multipage site built: ${htmlFiles.length} routes, ${chapters.length} chapters, ${labs.length} lab modules.`);
