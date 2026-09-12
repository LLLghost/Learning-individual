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
  ['Часть IX', 'Эксплуатация, надёжность и безопасность', [27, 28, 29, 30, 31, 32]],
  ['Часть X', 'Итоговая инженерная практика', [33]],
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

// Базовый путь публикации. Пусто — сайт живёт в корне домена. Для страниц проекта
// на GitHub Pages задают BASE_PATH=/имя-репозитория: маршруты и файлы остаются
// прежними, префикс появляется только в ссылках, которые видит браузер.
const BASE = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');
// Полный адрес сайта. Без него ссылка на главу, отправленная в мессенджер,
// остаётся голым адресом: карточку предпросмотра собирают по og-разметке, а
// она требует абсолютных адресов. Когда SITE_URL не задан (сборка на своей
// машине), canonical, og:url и карта сайта просто не выпускаются — врать
// поисковику о том, где страница живёт, хуже, чем молчать.
const SITE = (process.env.SITE_URL ?? '').replace(/\/+$/, '');
if (BASE && !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(BASE)) {
  throw new Error(`BASE_PATH должен начинаться со «/» и не содержать пробелов: ${BASE}`);
}
// Все абсолютные ссылки страниц создаёт этот генератор — в самом учебнике их нет,
// поэтому префикс проставляется одним проходом по готовой странице.
const withBase = (html) => (BASE ? html.replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}/`) : html);

const MODULE_COUNT = 37;
const frontStart = marker('title');
const chapterStarts = Array.from({ length: 34 }, (_, number) => marker(`b${pad(number)}`));
// Глава, открывающая часть, забирает заголовок части себе: иначе он остаётся
// в конце предыдущей страницы без единой строки под собой. Для главы 0 такой
// предыдущей страницей была «О курсе», и «Часть 0» висела там сиротой.
const chapterPageStarts = chapterStarts.map((start, number) => {
  const precedingHeading = source.lastIndexOf('<h1', start - 1);
  const bound = number === 0 ? frontStart : chapterStarts[number - 1];
  return precedingHeading > bound ? precedingHeading : start;
});
const startPartStart = marker('start-part');
const appendicesStart = marker('b33-s044');
const selftestStart = marker('selftest');
const studyAppStart = marker('study-app');
const assessmentStart = marker('assessment');
const labsStart = marker('labs');
const assessmentReferenceStart = marker('assessment-reference');
const mainEnd = source.lastIndexOf('</main>');
const studyDatabase = scriptJson('study-data');
// Вводная часть кончается там, где начинается первая глава со своим заголовком
// части. Разделительная черта перед ним осталась бы висячей линией в конце
// страницы: разделять после неё уже нечего.
const aboutSource = source.slice(frontStart, startPartStart).replace(/(?:\s*<hr\s*\/?>)+\s*$/i, '');

// Вводная часть «Начало» — пологий вход для читателя, который никогда не
// администрировал систему. Это не главы: у неё своя нумерация уроков и свой
// раздел сайта, поэтому 34 главы, 37 модулей и банк проверок остаются как есть.
const LESSON_COUNT = 5;
const lessonStarts = Array.from({ length: LESSON_COUNT }, (_, number) => marker(`start${pad(number + 1)}`));
const lessons = lessonStarts.map((start, index) => {
  const number = index + 1;
  const end = index === LESSON_COUNT - 1 ? chapterPageStarts[0] : lessonStarts[index + 1];
  // Первый урок забирает себе заголовок части и её вступление — так же, как
  // глава, открывающая часть, в основном курсе.
  const intro = index === 0 ? source.slice(startPartStart, start) : '';
  const content = source.slice(start, end).replace(/(?:\s*<hr\s*\/?>)+\s*$/i, '');
  const titleMatch = content.match(/^<h1[^>]*>(.*?)<\/h1>/s);
  if (!titleMatch) throw new Error(`Missing title for lesson ${number}`);
  return { number, title: strip(titleMatch[1]), intro, content, url: `/start/${pad(number)}/` };
});

const chapters = chapterStarts.map((start, number) => {
  const end = number === 33 ? appendicesStart : chapterPageStarts[number + 1];
  const intro = source.slice(chapterPageStarts[number], start);
  const content = source.slice(start, end);
  const titleMatch = content.match(/^<h1[^>]*>(.*?)<\/h1>/s);
  if (!titleMatch) throw new Error(`Missing title for chapter ${number}`);
  return { number, title: strip(titleMatch[1]), intro, content, url: `/chapters/${pad(number)}/` };
});

const labMarkers = Array.from({ length: MODULE_COUNT }, (_, number) => marker(`lab${pad(number)}`));
const labEnd = marker('assessment-reference');
const labs = labMarkers.map((start, number) => {
  const end = number === 36 ? labEnd : labMarkers[number + 1];
  // В книге работа — раздел практикума, на своей странице она и есть страница.
  // Заголовок один и тот же, уровень разный: без этого у страницы нет h1,
  // и в оглавлении для чтения с экрана она начинается со второй ступени.
  // Заголовок работы остаётся h2: своей страницей работа быть перестала и живёт
  // разделом вида модуля, где h1 — заголовок самой страницы практики.
  const content = source.slice(start, end);
  const titleMatch = content.match(/^<h2[^>]*>(.*?)<\/h2>/s);
  return { number, title: strip(titleMatch?.[1] ?? `Практикум ${number}`), content, url: `/assessment/?module=${number}` };
});
// Общее введение практикума не принадлежит нулевой работе. Вид модуля показывает
// секцию работы целиком, поэтому заголовок всего практикума уезжал бы в U00 —
// у одного модуля из тридцати семи появлялась лишняя ступень заголовков.
const labsIntro = source.slice(labsStart, labMarkers[0]);

const pages = [
  { url: '/about/', content: aboutSource },
  ...lessons.map((item) => ({ url: item.url, content: item.intro + item.content })),
  ...chapters.map((item) => ({ url: item.url, content: item.intro + item.content })),
  ...labs.map((item) => ({ url: item.url, content: item.content })),
  { url: '/assessment/', content: source.slice(studyAppStart, labMarkers[0]) },
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

const curriculumLinks = (active) => `<section class="nav-group"><p>Начало · если вы здесь впервые</p><a href="/start/01/"><span>У1</span>Пять вводных уроков</a></section>` + parts.map(([label, title, numbers]) => `
  <section class="nav-group"><p>${label} · ${title}</p>${numbers.map((number) => {
    const chapter = chapters[number];
    return `<a ${active === number ? 'aria-current="page"' : ''} href="${chapter.url}"><span>${pad(number)}</span>${escape(chapter.title.replace(/^\d+\.\s*/, ''))}</a>`;
  }).join('')}</section>`).join('');

const globalNav = `
  <a class="brand" href="/"><span>SERVER</span><strong>INFRA</strong></a>
  <nav aria-label="Основная навигация">
    <a href="/curriculum/">Программа</a>
    <a href="/route/">Маршрут</a>
    <a href="/assessment/">Практика и проверка</a>
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
  <div class="reader-toast t-toast" data-reader-toast role="status" aria-live="polite"></div>
  <div class="search-overlay" data-search-overlay hidden role="dialog" aria-modal="true" aria-labelledby="search-title">
    <div class="search-panel t-modal">
      <h2 id="search-title" class="visually-hidden">Поиск по учебнику</h2>
      <div class="search-field"><span aria-hidden="true">⌕</span><input type="search" data-search-input placeholder="Найти по всему учебнику: PMTU, initramfs, bifurcation…" autocomplete="off" spellcheck="false" aria-label="Поисковый запрос" aria-controls="search-results"><button type="button" class="icon-button" data-search-close aria-label="Закрыть поиск">×</button></div>
      <p class="search-status" data-search-status role="status">Введите не меньше двух символов.</p>
      <div class="search-results" id="search-results" data-search-results></div>
    </div>
  </div>`;

// Длинную страницу нельзя читать одним свитком: переход от одного раздела к
// другому должен быть в один щелчок. Список собирается из заголовков h2 самой
// страницы, поэтому не может разойтись с её содержанием.
const sectionRail = (body) => {
  const headings = [...body.matchAll(/<h2[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)]
    .map((match) => ({ id: match[1], text: strip(match[2]) }))
    .filter((heading) => heading.text);
  if (headings.length < 5) return '';
  const items = headings.map((heading) => {
    const numbered = heading.text.match(/^(\d+\.\d+[A-Z]?|U\d\d)\.\s*(.*)$/);
    const mark = numbered ? numbered[1] : '';
    const label = numbered ? numbered[2] : heading.text;
    return `<li><a href="#${heading.id}" data-section-link>${mark ? `<span>${escape(mark)}</span>` : '<span></span>'}${escape(label)}</a></li>`;
  }).join('');
  return `<nav class="section-rail" data-section-rail aria-label="Разделы страницы"><details data-section-details><summary><span>Разделы страницы</span><strong>${headings.length}</strong></summary><ol>${items}</ol></details></nav>`;
};

// Место под политику безопасности. GitHub Pages не даёт задать заголовки,
// поэтому политика едет в <meta>, а хеши встроенных скриптов считаются по уже
// готовой странице (sealPolicy) — иначе политика разойдётся с содержимым,
// и это будет видно только в браузере.
const policySlot = '__content-security-policy__';

// Что считать исполняемым скриптом. <script type="application/json"> с банком
// заданий браузер не выполняет, и хеш ему не нужен; без этого разделения все
// 111 заданий попали бы в заголовок политики.
const executableScript = (attributes) => {
  if (/\ssrc=/.test(attributes)) return false;
  const type = /type\s*=\s*"([^"]*)"/.exec(attributes)?.[1].trim().toLowerCase();
  return !type || type === 'module' || /^(text|application)\/(java|ecma)script$/.test(type);
};

// 'none' по умолчанию: сайт грузит только свои стили, свой site.js и
// search.json со своего же origin. frame-ancestors в <meta> не работает
// вовсе, поэтому его здесь нет: обещать защиту от вставки в чужой фрейм без
// заголовка нельзя.
const sealPolicy = (html) => {
  const hashes = new Set();
  for (const [, attributes, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!executableScript(attributes)) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  const policy = [
    "default-src 'none'",
    `script-src 'self' ${[...hashes].join(' ')}`,
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return html.replace(policySlot, policy);
};

// Считать хеши до подстановки BASE_PATH нельзя: она меняет пути внутри
// скриптов, а вместе с ними и хеш.
// Метаданные страницы подставляются в момент записи: сам pageShell своего адреса
// не знает, а прокидывать его через десяток вызовов ради двух тегов не стоит.
const pageMeta = (url, title, description) => {
  const full = `${escape(title)} · Серверная инфраструктура`;
  const tags = [
    `<meta property="og:type" content="${url === '/' ? 'website' : 'article'}">`,
    '<meta property="og:site_name" content="Серверная инфраструктура">',
    '<meta property="og:locale" content="ru_RU">',
    `<meta property="og:title" content="${full}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    '<meta name="twitter:card" content="summary">',
  ];
  if (SITE) {
    tags.push(`<meta property="og:url" content="${SITE}${url}">`, `<link rel="canonical" href="${SITE}${url}">`);
  }
  return tags.join('');
};
const finishPage = (html, url = '/') => {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/ · Серверная инфраструктура$/, '') ?? 'Серверная инфраструктура';
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? title;
  return sealPolicy(withBase(html.replace('__page-meta__', pageMeta(url, decode(title), decode(description)))));
};

const pageShell = ({ title, eyebrow, body, sidebar = '', className = '', description = title }) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policySlot}"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escape(description)}"><meta name="theme-color" content="#081a24">__page-meta__<script>try{const saved=localStorage.getItem('server-infrastructure-theme');document.documentElement.dataset.theme=saved||((matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light')}catch{document.documentElement.dataset.theme='light'}</script><title>${escape(title)} · Серверная инфраструктура</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css"></head>
<body><a class="skip-link" href="#main">К основному тексту</a><div class="read-progress" data-read-progress aria-hidden="true"></div><header class="topbar">${globalNav}<div class="read-size" data-read-size-group role="group" aria-label="Размер текста" hidden><button type="button" data-read-size="s" aria-pressed="false" title="Мелкий текст">А</button><button type="button" data-read-size="m" aria-pressed="true" title="Обычный текст">А</button><button type="button" data-read-size="l" aria-pressed="false" title="Крупный текст">А</button></div><button class="search-toggle" type="button" data-search-open aria-haspopup="dialog"><span aria-hidden="true">⌕</span><span>Поиск</span><kbd>Ctrl K</kbd></button><button class="theme-toggle" type="button" data-theme-toggle aria-pressed="false"><span aria-hidden="true" data-theme-icon>◐</span><span data-theme-label>Тёмная тема</span></button><button class="notes-toggle" type="button" data-notes-toggle aria-expanded="false"><span aria-hidden="true">✎</span><span>Заметки</span><strong data-notes-badge hidden>0</strong></button><details class="mobile-menu"><summary><span class="menu-label">Разделы</span></summary><div>${globalNav}</div></details></header>
<div class="page-layout ${className}">${sidebar ? `<aside class="side-nav">${sidebar}</aside>` : ''}<main class="page-main" id="main" tabindex="-1">${sectionRail(body.replace(/<div id="lab-texts"[\s\S]*?<\/div>/, ' '))}<p class="eyebrow">${escape(eyebrow)}</p>${body}</main></div>
${readerTools}<script src="/assets/site.js"></script></body></html>`;

// ---------- Справочная база терминов ----------
// Основа — приложение C (глоссарий) прямо из учебника, чтобы определения не
// разъезжались с текстом; public/reference-terms.json добавляет термины, которых
// в глоссарии нет, и варианты написания для поиска по выделенному фрагменту.
const glossaryEntries = () => {
  const start = marker('b33-s058');
  const end = marker('b33-s059');
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

// Нумерация академических модулей U00–U36 не совпадает с нумерацией глав: часть глав
// содержит несколько U-модулей, а нулевая опирается на модуль соседней. Достоверный источник
// соответствия — то, внутри какой главы физически находится заголовок U-модуля.
// Всё остальное (практикум, тренажёры, ссылки «Проверить знания») выводится отсюда,
// поэтому связка не может разъехаться при правке учебника.
const moduleChapter = Array.from({ length: MODULE_COUNT }, (_, module) => {
  const position = marker(`ch${pad(module)}`);
  let chapter = 0;
  chapterStarts.forEach((start, number) => { if (start <= position) chapter = number; });
  return chapter;
});
// Нулевая глава ставит стенд и опирается на модуль первой главы; у остальных
// глав есть собственный академический модуль.
const chapterFallbackModule = new Map([[0, 0]]);
const chapterModules = chapterStarts.map((_, chapter) => {
  const own = moduleChapter.flatMap((owner, module) => (owner === chapter ? [module] : []));
  return own.length ? own : [chapterFallbackModule.get(chapter)];
});
const studyModuleByChapter = chapterModules.map((modules) => modules[0]);
// Мини-тренажёр главы — своя проверка, а не копия банка кабинета. Раньше он брал
// два первых задания модуля прямо из `study-data`: читатель отвечал на те же
// вопросы, которые потом оцениваются, и видел их разбор заранее — первый ярус
// оценки был раскрыт до попытки. Теперь у главы свои вопросы: один о главной
// модели главы, второй о её «типичной ошибке мышления». Уровень другой —
// «прочитал и понял», тогда как кабинет спрашивает применение механизма.
const chapterQuick = scriptJson('chapter-quick-data');
const lessonQuick = scriptJson('lesson-quick-data');

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

// Выбор из вариантов — узнавание, а не припоминание, и оно завышает ощущение
// владения темой. Здесь читатель сначала пишет по памяти и только потом видит
// список тем главы: открыть его заранее значит превратить упражнение обратно в
// узнавание, поэтому список спрятан за кнопкой.
const chapterRecall = (chapter) => {
  const topics = [...chapter.content.matchAll(/<h2[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)]
    .map((match) => ({ id: match[1], text: strip(match[2]) }))
    .filter((heading) => /^\d+\.\d+[A-Z]?\.\s/.test(heading.text))
    .map((heading) => ({ id: heading.id, text: heading.text.replace(/^\d+\.\d+[A-Z]?\.\s*/, '') }))
    // Лаборатория — действие на стенде, а не то, что вспоминают по памяти.
    .filter((topic) => topic.text !== 'Лаборатория');
  if (topics.length < 4) return '';
  const rows = topics.map((topic, index) => `<li><label><input type="checkbox" data-recall-topic="${index}"><span>${escape(topic.text)}</span></label><a href="#${topic.id}">к разделу</a></li>`).join('');
  return `<section class="chapter-recall" data-chapter-recall="${chapter.number}" aria-labelledby="recall-title-${chapter.number}">
<header><p class="eyebrow">Проверка без подсказок</p><h2 id="recall-title-${chapter.number}">Что осталось в памяти</h2><p>Закройте главу и выпишите всё, что помните: механизмы, величины, порядок действий. Пишите до тех пор, пока не иссякнет — именно попытка вспомнить, а не перечитывание, оставляет след.</p></header>
<label class="recall-field"><span>Ваш пересказ по памяти</span><textarea data-recall-text rows="8" placeholder="Например: главное различие темы, что чем измеряется, какой шаг диагностики идёт первым…"></textarea></label>
<p class="recall-hint" data-recall-hint>Сохраняется в этом браузере. Ничего не оценивается автоматически: сверку делаете вы сами.</p>
<details class="recall-topics" data-recall-list><summary>Сверить со списком тем главы (${topics.length})</summary><p class="recall-note">Отметьте только те темы, которые вспомнили <em>до</em> открытия списка. Отметка ничего не засчитывает и в календарь не идёт — она нужна вам, а не системе.</p><ol>${rows}</ol><p class="recall-score" data-recall-score>Отмечено: 0 из ${topics.length}.</p></details>
</section>`;
};

// Мини-тренажёр общий для глав и вводных уроков: ярус один и тот же, меняются
// только вопросы, подпись и то, куда ведёт ссылка. Ключ отметки в календаре
// (`data-chapter-trainer`) для главы — её номер, для урока — «sN»: шкалы разные
// и пересечься не должны.
const quickTrainer = ({ scope, seed, items, eyebrow, title, lead, doneText, footerHref, footerText }) => {
  if (items.length !== 2) throw new Error(`Expected two quick-check questions for ${scope}`);
  const questions = items.map((item, questionIndex) => {
    const trainerId = `Q${scope}-${questionIndex}`;
    const shift = (seed + questionIndex) % item.options.length;
    const options = [...item.options.slice(shift), ...item.options.slice(0, shift)];
    const answer = (item.answer - shift + item.options.length) % item.options.length;
    return `<fieldset class="trainer-question" data-trainer-question="${trainerId}" data-answer="${answerDigest(trainerId, answer)}"><legend><span>${questionIndex + 1}</span>${escape(item.stem)}</legend><div class="trainer-options">${options.map((option, optionIndex) => `<label><input type="radio" name="trainer-${trainerId}" value="${optionIndex}"><span>${escape(option)}</span></label>`).join('')}</div><div class="trainer-actions"><button type="button" data-trainer-check>Проверить</button><p class="trainer-feedback" data-trainer-feedback hidden data-explanation="${escape(item.explanation)}" role="status"></p></div></fieldset>`;
  }).join('');
  return `<section class="chapter-trainer" data-chapter-trainer="${scope}" data-trainer-done="${escape(doneText)}" aria-labelledby="trainer-title-${scope}"><header><div><p class="eyebrow">${escape(eyebrow)}</p><h2 id="trainer-title-${scope}">${escape(title)}</h2><p>${escape(lead)}</p></div><strong data-trainer-score>0 / 2</strong></header>${questions}<footer><span data-trainer-summary>Ответьте на оба вопроса.</span><a href="${footerHref}">${escape(footerText)}</a></footer></section>`;
};

const chapterTrainer = (number) => {
  const module = studyModuleByChapter[number];
  return quickTrainer({
    scope: String(number), seed: number, items: chapterQuick[String(number)] ?? [],
    eyebrow: 'Сразу после главы', title: 'Мини-тренажёр главы',
    lead: 'Два вопроса по главным утверждениям этой главы: прочитана и понята. Мгновенная проверка, результат сохраняется в этом браузере.',
    doneText: 'Глава закреплена. Можно переходить дальше.',
    footerHref: `/assessment/?module=${module}`, footerText: `Проверка знаний · модуль U${pad(module)} →`,
  });
};

// Вводные уроки жили вне всех трёх ярусов: свёрнутый блок «Проверьте себя» есть,
// но он ничего не проверяет и никуда не идёт. Человек, пришедший с нуля, первые
// пять шагов проходил без единой отметки.
const lessonTrainer = (lesson) => quickTrainer({
  scope: `s${lesson.number}`, seed: lesson.number, items: lessonQuick[String(lesson.number)] ?? [],
  eyebrow: 'Сразу после урока', title: 'Мини-тренажёр урока',
  lead: 'Два вопроса по главным утверждениям этого урока. Мгновенная проверка, результат сохраняется в этом браузере.',
  doneText: 'Урок закреплён. Можно переходить дальше.',
  footerHref: lesson.number < lessons.length ? lessons[lesson.number].url : '/chapters/00/',
  footerText: lesson.number < lessons.length ? `Урок ${lesson.number + 1} →` : 'Глава 00 · сборка стенда →',
});

// Обратная связка «глава → её академические модули»: без неё главы 3, 5, 11 и 25
// оставались тупиками — из них не было пути ни в практикум, ни в проверку знаний.
const chapterPractice = (number) => {
  const modules = chapterModules[number];
  const items = modules.map((module) => {
    const own = moduleChapter[module] === number;
    const note = own ? 'Модуль этой главы' : `Модуль главы ${pad(moduleChapter[module])}, разбирается на материале этой темы`;
    return `<a href="${labs[module].url}"><span>L${pad(module)}</span><strong>${escape(labs[module].title.replace(/^L\d+[A-Z/]?\.\s*/, ''))}</strong><em>${note}</em></a>`;
  }).join('');
  return `<section class="chapter-practice" aria-labelledby="practice-title-${number}"><header><p class="eyebrow">Практика по теме</p><h2 id="practice-title-${number}">Работы практикума</h2></header><div class="practice-grid">${items}</div><p class="practice-note">Нумерация работ <strong>L</strong> следует академическим модулям <strong>U00–U36</strong>, а не номерам глав: часть глав содержит несколько модулей, а нулевая опирается на модуль первой.</p></section>`;
};

const chapterPage = (chapter) => {
  const previous = chapters[chapter.number - 1];
  const next = chapters[chapter.number + 1];
  const pager = `<nav class="pager" aria-label="Переход между главами">${previous ? `<a href="${previous.url}">← Глава ${pad(previous.number)}</a>` : '<span></span>'}<a class="assessment-link" href="/assessment/?module=${studyModuleByChapter[chapter.number]}">Проверить знания</a>${next ? `<a href="${next.url}">Глава ${pad(next.number)} →</a>` : '<span></span>'}</nav>`;
  const sidebar = `<a class="back-link" href="/curriculum/">← Вся программа</a><div class="sidebar-scroll">${curriculumLinks(chapter.number)}</div>`;
  const body = `<article class="prose chapter-prose">${rewriteLinks(chapter.intro + chapter.content, chapter.url)}</article>${chapterRecall(chapter)}${chapterTrainer(chapter.number)}${chapterPractice(chapter.number)}${pager}`;
  // Описание страницы — первый абзац главы, а не её же заголовок: именно оно
  // уходит в карточку предпросмотра и в выдачу поисковика.
  const lead = [...chapter.content.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map((match) => strip(match[1]).replace(/\s+/g, ' ').trim())
    .find((text) => text.length >= 120 && !text.startsWith('Академическое продолжение')) ?? '';
  const description = lead.length > 40 ? `${lead.slice(0, 180).replace(/[\s,;:]+\S*$/, '')}…` : chapter.title;
  return pageShell({ title: chapter.title, eyebrow: `Глава ${pad(chapter.number)} · университетский курс`, body, sidebar, className: 'with-sidebar', description });
};

const lessonNav = (active) => `<p class="side-title">Начало · вводные уроки</p>${lessons.map((item) => `<a ${active === item.number ? 'aria-current="page"' : ''} href="${item.url}"><span>${item.number}</span>${escape(item.title.replace(/^Урок \d+\.\s*/, ''))}</a>`).join('')}<p class="side-title">Дальше</p><a href="/chapters/00/"><span>00</span>Учебная лаборатория</a><a href="/curriculum/"><span>—</span>Вся программа</a>`;

const lessonPage = (lesson) => {
  const previous = lessons[lesson.number - 2];
  const next = lessons[lesson.number];
  // Последний урок ведёт в главу 0: вводная часть кончается там, где
  // начинается основной курс, и тупика в конце быть не должно.
  const forward = next
    ? `<a href="${next.url}">Урок ${next.number} →</a>`
    : '<a href="/chapters/00/">Глава 00 →</a>';
  const pager = `<nav class="pager" aria-label="Переход между уроками">${previous ? `<a href="${previous.url}">← Урок ${previous.number}</a>` : '<a href="/about/">← О курсе</a>'}<a class="assessment-link" href="/curriculum/">Вся программа</a>${forward}</nav>`;
  const body = `<article class="prose chapter-prose">${rewriteLinks(lesson.intro + lesson.content, lesson.url)}</article>${lessonTrainer(lesson)}${pager}`;
  return pageShell({
    title: lesson.title, eyebrow: `Начало · урок ${lesson.number} из ${LESSON_COUNT}`,
    body, sidebar: `<a class="back-link" href="/curriculum/">← Вся программа</a><div class="sidebar-scroll">${lessonNav(lesson.number)}</div>`,
    className: 'with-sidebar',
    description: `${lesson.title}. Вводный урок для читателя без опыта администрирования.`,
  });
};


// Русский счёт требует трёх форм, а не двух: «2 модулей» на карточке части
// читалось ошибкой вёрстки, хотя разметка была правильной.
const plural = (n, one, few, many) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return many;
  const last = n % 10;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
};
const homeCards = parts.map(([label, title, numbers]) => `<a class="part-card" href="${chapters[numbers[0]].url}"><span>${label}</span><h2>${title}</h2><p>${numbers.length} ${plural(numbers.length, 'модуль', 'модуля', 'модулей')} · ${numbers.map((number) => pad(number)).join(' · ')}</p></a>`).join('');
const home = pageShell({
  title: 'Университетский курс', eyebrow: 'Самостоятельное обучение', className: 'landing',
  body: `<section class="hero"><div><h1>Серверная инфраструктура<br><em>от сигнала до системы</em></h1><p>Полный маршрут для самостоятельной подготовки: Linux, сети, серверное железо, хранение данных, автоматизация, контейнеры и firmware.</p><div class="hero-actions"><a class="button primary" href="/curriculum/">Открыть программу</a><a class="button" href="/assessment/">Продолжить обучение</a></div></div><div class="hero-stats"><div><strong>34</strong><span>главы</span></div><div><strong>259</strong><span>автопроверок</span></div><div><strong>74</strong><span>полевые работы</span></div><div><strong>28</strong><span>Python-тестов</span></div></div></section><section class="progress-card"><div><p class="eyebrow">Ваш прогресс</p><strong data-progress-title>Маршрут ещё не начат</strong><p data-progress-copy>Результаты сохраняются только в этом браузере.</p><p class="resume-line" data-resume-line hidden>Продолжить чтение: <a data-resume-link href="/">—</a> <em data-resume-note></em></p></div><a href="/assessment/">Открыть кабинет →</a></section><section class="section-head"><div><p class="eyebrow">Если вы здесь впервые</p><h2>Пять уроков до начала курса</h2></div><a href="/start/01/">Начать с нуля →</a></section><p class="lead-note">Курс начинается со сборки стенда и предполагает, что терминал, виртуальная машина и сеть — знакомые слова. Если это не так, вводная часть объясняет их за вечер и без единой команды.</p><section class="section-head"><div><p class="eyebrow">Маршрут</p><h2>${parts.length} ${plural(parts.length, 'последовательная часть', 'последовательные части', 'последовательных частей')}</h2></div><a href="/curriculum/">Все главы →</a></section><div class="part-grid">${homeCards}</div>`,
  description: 'Многостраничный университетский курс по серверной инфраструктуре для самостоятельного обучения.',
});

const curriculum = pageShell({
  title: 'Программа курса', eyebrow: `34 главы · ${parts.length} частей`, className: 'catalog',
  body: `<header class="catalog-head"><h1>Программа курса</h1><p>Идите последовательно или выберите нужную область. Каркас главы одинаков: цели, разобранный пример, лаборатория, типичная ошибка мышления, лестница самостоятельности, самопроверка и мини-тренажёр. Разбор аварий вынесен в практикум и в главу 33.</p><label class="search"><span>Поиск по программе</span><input type="search" placeholder="Например: NUMA, Ceph, systemd" data-course-search></label></header><section class="catalog-part" data-course-group><div><p>Начало</p><h2>Если вы здесь впервые</h2></div><div class="chapter-grid">${lessons.map((item) => `<a class="chapter-card" data-course-card="${escape(item.title.toLowerCase())}" href="${item.url}"><span>У${item.number}</span><h3>${escape(item.title.replace(/^Урок \d+\.\s*/, ''))}</h3><p>Вводный урок · без стенда и команд</p></a>`).join('')}</div></section>${parts.map(([label, title, numbers]) => `<section class="catalog-part" data-course-group><div><p>${label}</p><h2>${title}</h2></div><div class="chapter-grid">${numbers.map((number) => { const item = chapters[number]; return `<a class="chapter-card" data-course-card="${escape(item.title.toLowerCase())}" href="${item.url}"><span>${pad(number)}</span><h3>${escape(item.title.replace(/^\d+\.\s*/, ''))}</h3><p>Теория · пример · лаборатория · ошибка мышления · проверка</p></a>`; }).join('')}</div></section>`).join('')}`,
});

const quizData = scriptElement('quiz-data');
const quizScript = followingScript('quiz-data');
const studyData = scriptElement('study-data');
const checkerData = scriptElement('checker-code-data');
// Скрипт работ и база их ожидаемых ответов: страница кабинета собирается из
// перечисленных здесь блоков, а не из сплошного среза, поэтому новый блок
// данных надо назвать явно — иначе он просто не доедет до страницы.
const labCode = scriptElement('lab-code-data');
const labData = scriptElement('lab-data');
// Работы, у которых есть автоматическая проверка: со страницы работы должен
// вести мост в кабинет, иначе читатель о проверке просто не узнает — как это
// уже было с мостом «глава → модуль».
const autoCheckedLabs = new Map(scriptJson('lab-data').labs.map((lab) => [lab.module, lab]));
let studyScript = followingScript('checker-code-data')
  // Справка уехала на страницу «О курсе»: ссылка внутри кода кабинета не
  // проходит через rewriteLinks, поэтому её адрес подставляется здесь — иначе
  // она молча указывала бы на несуществующий якорь этой же страницы.
  .replace(/'#autopractice'/g, `'${BASE}/about/#autopractice'`)
  .replace(/'#ch'\+pad\(([^)]+)\)/g, `'${BASE}/chapters/'+pad($1)+'/'`)
  // Перенос прогресса — один на весь курс, на «Маршруте»: кабинет только ведёт туда.
  .replace(/'#route-backup'/g, `'${BASE}/route/#route-backup'`)
  .replace(/render\(\);\s*\}\)\(\);\s*<\/script>$/, "const requested=new URLSearchParams(location.search).get('module');if(requested!==null&&/^\\d{1,2}$/.test(requested)&&Number(requested)<37){module=Number(requested);tab='learn';}\nrender();\n})();\n</script>");
const studySection = section('study-app');
const assessmentIntro = rewriteLinks(source.slice(assessmentStart, labsStart), '/assessment/');
// Тексты работ переезжают на страницу кабинета скрытыми секциями: практика и
// проверка перестали быть двумя разными местами. Разметка готовится здесь, а
// кабинет показывает нужную секцию — так он по-прежнему не пользуется innerHTML.
const labTexts = `<div id="lab-texts" hidden>${rewriteLinks(labsIntro, '/assessment/')}${labs.map((lab) => `<section data-lab-module="${lab.number}">${rewriteLinks(lab.content, '/assessment/')}</section>`).join('')}</div>`;
const assessment = pageShell({
  title: 'Практика и проверка', eyebrow: 'Задания, сценарии и работы практикума', className: 'tool-page',
  body: `<header class="tool-intro">${assessmentIntro}<a class="button" href="/assessment/a1/">Тренажёр A1 · 40 вопросов</a></header><article class="study-surface">${studySection}</article>${labTexts}${studyData}${checkerData}${labCode}${labData}${studyScript}`,
});
const a1 = pageShell({
  title: 'Тренажёр A1', eyebrow: '40 вопросов · мгновенная проверка', className: 'tool-page',
  body: `<header class="tool-intro"><h1>Тренажёр A1</h1><p>Быстрая проверка базовых понятий перед переходом к модульному кабинету.</p><a href="/assessment/">← Основной кабинет</a></header><article class="study-surface">${section('selftest')}</article>${quizData}${quizScript}`,
});

// ---------- Маршрут самостоятельного прохождения ----------
// Чек-лист и календарь не редактируются: строки собраны из состава курса, а
// отметки берутся из фактического прогресса — мини-тренажёра главы и зачёта
// модуля в кабинете. Поставить дату вручную интерфейс не позволяет.
const routeRows = chapters.map((chapter) => {
  // Модули считаются только собственные: нулевая глава опирается на модуль первой,
  // и засчитывать его дважды нельзя.
  const shown = chapterModules[chapter.number];
  const own = shown.filter((module) => moduleChapter[module] === chapter.number);
  const links = (list) => list.map((module) => `<a href="/assessment/?module=${module}">U${pad(module)}</a>`).join(' ');
  const labLinks = shown.map((module) => `<a href="${labs[module].url}">L${pad(module)}A/B</a>`).join(' ');
  // Столбец обещал «проверяете сами» по всем работам и после появления
  // автопроверки остался прежним: читатель не узнавал, что часть работ
  // кабинет засчитывает сам.
  const autoHere = shown.map((module) => autoCheckedLabs.get(module)).filter(Boolean);
  const labNote = autoHere.length ? `автопроверка: ${autoHere.map((lab) => escape(lab.id)).join(' ')}` : 'проверяете сами';
  const moduleCell = own.length
    ? `<span class="route-links">${links(own)}</span><span class="route-mark" data-route-state="none">—</span>`
    : `<span class="route-links">${links(shown)}</span><span class="route-note">модуль главы ${pad(moduleChapter[shown[0]])}</span>`;
  return `<tr data-route-row="${chapter.number}" data-own="${own.join(',')}">
    <th scope="row"><span>${pad(chapter.number)}</span><a href="${chapter.url}">${escape(chapter.title.replace(/^\d+\.\s*/, ''))}</a></th>
    <td data-route-cell="chapter"><span class="route-mark" data-route-state="none">—</span></td>
    <td data-route-cell="module">${moduleCell}</td>
    <td data-route-cell="labs"><span class="route-links">${labLinks}</span><span class="route-note">${labNote}</span></td>
  </tr>`;
}).join('');

const route = pageShell({
  title: 'Маршрут самостоятельного прохождения',
  eyebrow: 'Порядок работы · чек-лист · календарь',
  className: 'tool-page',
  description: 'Порядок самостоятельного прохождения курса, чек-лист по главам и календарь фактического прогресса.',
  body: `<header class="tool-intro"><h1>Маршрут самостоятельного прохождения</h1><p>Эта страница отвечает на три вопроса: в каком порядке идти, что считается пройденным и что уже сделано. Отметки в чек-листе и календаре появляются сами — из мини-тренажёров глав и зачёта модулей в учебном кабинете; вручную их выставить нельзя.</p></header>
<section class="compact-prose" aria-labelledby="route-order">
<h2 id="route-order">Порядок работы</h2>
<ol class="route-order">
<li><strong>Если администрировать не приходилось — начните с вводной части.</strong> Пять уроков <a href="/start/01/">«Начало»</a> объясняют, из чего собрана система и как про неё думать. Они читаются за вечер, стенд для них не нужен, а в конце каждого — мини-тренажёр из двух вопросов. У кого опыт есть — шаг пропускается.</li>
<li><strong>Соберите стенд по главе 00.</strong> Весь курс стоит на нём: без стенда лаборатории и работы практикума выполнить не на чем.</li>
<li><strong>Идите по главам подряд.</strong> Каждая опирается на предыдущие, а «Перед началом» прямо связывает новую тему с уже разобранной.</li>
<li><strong>Читайте главу целиком</strong> — до разобранного примера и типичной ошибки мышления. Они дают метод, а не факты.</li>
<li><strong>Выполните лабораторию главы</strong> на стенде, а не мысленно.</li>
<li><strong>Решите мини-тренажёр</strong> в конце главы: два вопроса, мгновенная проверка. Это первая отметка в календаре.</li>
<li><strong>Сдайте модуль U в кабинете</strong> — не в тот же день, а хотя бы через сутки: задания на механизм, расчёт и сценарий по шагам. Это вторая отметка. Дальше кабинет вернёт слабые задания сам через 2, 7 и 21 день.</li>
<li><strong>Сделайте обе работы практикума</strong> — A (воспроизвести механизм) и B (сломанный стенд). Работу B не пропускайте: навык формируется именно там.</li>
<li><strong>Запишите результат в свой репозиторий:</strong> учебник заводит его в разделе 0.17 и дальше опирается на него как на рабочий инструмент.</li>
</ol>
<p class="route-hint">Курс считается пройденным, когда сданы все 37 модулей, пройдены 28 из 28 программных проверок и итоговый контроль набирает не меньше 32 из 37.</p>
</section>
<section class="route-board" data-route-board aria-labelledby="route-check">
<div class="route-head"><h2 id="route-check">Чек-лист по главам</h2><p data-route-summary>Отметки появятся после первого решённого мини-тренажёра.</p></div>
<table class="route-table">
<thead><tr><th scope="col">Глава</th><th scope="col">Мини-тренажёр</th><th scope="col">Модуль</th><th scope="col">Практикум</th></tr></thead>
<tbody>${routeRows}</tbody>
</table>
<p class="route-note">У двадцати четырёх работ практикума есть автоматическая проверка — они названы в столбце и засчитываются кабинетом. У остальных критерий приёмки написан в самой работе, а подтверждением служит ваш репозиторий: кнопки «отметить сделанным» здесь нет намеренно — отметка, поставленная самому себе, ничего не доказывает.</p>
</section>
<section class="route-board" data-route-calendar aria-labelledby="route-calendar-title">
<div class="route-head"><h2 id="route-calendar-title">Календарь</h2><p>Дни, в которые что-то было впервые зачтено. Календарь только показывает: изменить дату через интерфейс нельзя.</p></div>
<div data-route-months class="route-months"></div>
<ol class="route-log" data-route-log></ol>
</section>
<section class="compact-prose" aria-labelledby="route-offline">
<h2 id="route-offline">Учебник без сети</h2>
<p>Прочитанные страницы браузер оставляет у себя и открывает их без интернета. Одной кнопкой можно положить в память сразу весь курс — 47 страниц и поиск по ним: после этого учебник работает там, где связи нет, а страницы открываются мгновенно.</p>
<div class="route-backup"><button type="button" class="button primary" data-offline-save>Сохранить учебник для работы без сети</button></div>
<p class="route-note" data-offline-status role="status">Около шести мегабайт. Копия обновится сама, когда выйдет новая версия учебника.</p>
</section>
<section class="compact-prose" aria-labelledby="route-backup">
<h2 id="route-backup">Резервная копия</h2>
<p>Весь прогресс хранится в этом браузере: очистка данных сайта, другой браузер или другое устройство означают пустой курс. Резервная копия собирает всё сразу — ответы кабинета, мини-тренажёры глав, календарь, заметки с выделениями и настройки чтения.</p>
<div class="route-backup"><button type="button" class="button primary" data-backup-save>Сохранить резервную копию</button><label class="file-label">Загрузить резервную копию<input type="file" accept="application/json,.json" class="hidden-input" data-backup-load></label></div>
<p class="route-note" data-backup-status role="status">Файл сохраняется на ваш компьютер и никуда не отправляется.</p>
</section>`,
});

const referenceCards = `<div class="reference-cards"><a href="/reference/archive/"><span>Аттестация</span><strong>Экзаменационный банк и рубрики</strong></a><a href="/assessment/"><span>Интерактив</span><strong>Автоматическая проверка</strong></a><a href="/curriculum/"><span>Навигация</span><strong>Все 34 главы курса</strong></a></div>`;
const reference = pageShell({ title: 'Справочник и приложения', eyebrow: 'Команды · runbook · глоссарий', body: `<header class="catalog-head"><h1>Справочник и приложения</h1><p>Материалы для работы рядом с терминалом и повторения после курса.</p></header>${referenceCards}<article class="prose">${rewriteLinks(source.slice(appendicesStart, selftestStart), '/reference/')}</article>` });
const archive = pageShell({ title: 'Аттестация и архив материалов', eyebrow: 'Экзамены · ключи · рубрики', body: `<header class="catalog-head"><h1>Аттестация и архив</h1><p>Полная справочная модель очной аттестации, исходный экзаменационный банк и преподавательские ключи.</p></header><article class="prose">${rewriteLinks(source.slice(assessmentReferenceStart, mainEnd), '/reference/archive/')}</article>` });
// Что нового. Учебник меняется, а читатель до сих пор не мог узнать, что
// изменилось с прошлого захода: «версия 6.0» в предисловии стоит неподвижно.
// Берём верхнюю запись CHANGELOG.md — вести её в двух местах никто не станет.
const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
const latest = changelog.match(/\n## ([^\n]+)\n([\s\S]*?)(?=\n## |$)/);
if (!latest) throw new Error('CHANGELOG.md: не найдено ни одной записи вида «## дата»');
const changelogItems = [...latest[2].matchAll(/^- (.+)$/gm)].map((match) => match[1]);
if (!changelogItems.length) throw new Error(`CHANGELOG.md: запись «${latest[1]}» без единого пункта`);
// Разметка в пунктах — только **жирный**: полноценный разбор markdown здесь
// не нужен и превратился бы в ещё один источник расхождений.
const inline = (text) => escape(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const built = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
const whatsNew = `<section class="compact-prose" aria-labelledby="whats-new">
<h2 id="whats-new">Что нового</h2>
<p class="route-note">Версия 6.0 · запись от ${escape(latest[1])} · сборка от ${escape(built)}</p>
<ul>${changelogItems.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>
</section>`;
const about = pageShell({ title: 'О курсе', eyebrow: 'Как учиться самостоятельно', body: `<article class="prose">${rewriteLinks(aboutSource, '/about/')}</article>${whatsNew}` });

const css = `
:root{--ink:#102733;--muted:#5b6d76;--navy:#071a24;--navy2:#0d2c38;--teal:#1aa698;--teal2:#8ce0d6;--paper:#f5f0e6;--white:#fffdf9;--line:#d9d4c8;--amber:#e2a947;--link:#087e75;--soft:#faf9f4;--code:#e4e2d9;--quote:#fff8e9;--success:#e9f5f3;--selected:#e7f6f3;--page:1600px;color-scheme:light}html[data-theme=dark]{--ink:#e8f0ed;--muted:#9fb1b2;--navy:#06151d;--navy2:#0d2a35;--teal:#45c8bb;--teal2:#94e5dc;--paper:#07171f;--white:#0d222b;--line:#29414a;--amber:#e2ae58;--link:#69d6ca;--soft:#102832;--code:#18323a;--quote:#2b281e;--success:#12362f;--selected:#113a36;color-scheme:dark}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;transition:background-color .2s,color .2s}.topbar{height:68px;background:var(--navy);color:white;display:flex;align-items:center;padding:0 max(24px,calc((100vw - var(--page))/2));gap:48px;position:sticky;top:0;z-index:20;border-bottom:1px solid #ffffff18}.brand{display:flex;align-items:baseline;gap:7px;color:white;text-decoration:none;letter-spacing:.08em}.brand span{font-size:11px;color:var(--teal2)}.brand strong{font-size:19px}.topbar>nav{display:flex;gap:28px}.topbar nav a{color:#d7e7e8;text-decoration:none;font-size:14px}.topbar nav a:hover{color:white}.theme-toggle{margin-left:auto;display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid #ffffff35;background:#ffffff0b;color:white;font:600 12px/1.2 inherit;cursor:pointer}.theme-toggle:hover{border-color:var(--teal2);background:#ffffff14}.theme-toggle:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}.theme-toggle [data-theme-icon]{font-size:16px}.mobile-menu{display:none}.page-layout{max-width:var(--page);margin:auto;min-height:calc(100vh - 68px)}.page-main{min-width:0;padding:54px clamp(24px,5vw,76px) 90px}.with-sidebar{display:grid;grid-template-columns:300px minmax(0,1fr)}.side-nav{height:calc(100vh - 68px);position:sticky;top:68px;overflow:auto;padding:34px 24px;background:#0b2430;color:white}.side-nav a{display:grid;grid-template-columns:35px 1fr;gap:8px;padding:8px 9px;color:#bcd0d3;text-decoration:none;font-size:12px;line-height:1.35;border-radius:5px}.side-nav a span{color:#6ec9bf;font-variant-numeric:tabular-nums}.side-nav a:hover,.side-nav a[aria-current=page]{background:#173b47;color:white}.side-nav .back-link{display:block;margin-bottom:22px;color:white}.nav-group{margin:20px 0}.nav-group p,.side-title{margin:0 8px 8px;color:#6f9199;font-size:10px;text-transform:uppercase;letter-spacing:.1em}.sidebar-scroll{padding-bottom:40px}.eyebrow{margin:0 0 12px;color:var(--teal);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.hero{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,.7fr);gap:72px;align-items:end;padding:58px 0 74px}.hero h1,.catalog-head h1,.tool-intro h1{font-family:Georgia,serif;font-size:clamp(42px,6vw,84px);line-height:.94;letter-spacing:-.04em;margin:0}.hero h1 em{color:var(--teal);font-weight:400}.hero>div>p{max-width:720px;font-size:19px;line-height:1.6;color:var(--muted)}.hero-actions{display:flex;gap:12px;margin-top:30px}.button{display:inline-block;border:1px solid #77979b;padding:12px 18px;text-decoration:none;color:var(--ink);font-weight:700;font-size:14px}.button.primary{background:var(--navy);color:white;border-color:#31505a}.hero-stats{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);background:var(--white)}.hero-stats div{padding:25px;border:1px solid var(--line)}.hero-stats strong{display:block;font-family:Georgia,serif;font-size:42px}.hero-stats span{font-size:12px;color:var(--muted)}.lead-note{max-width:720px;margin:0 0 26px;color:var(--muted);font-size:15px;line-height:1.65}.progress-card{background:var(--navy2);color:white;padding:26px 30px;display:flex;align-items:center;justify-content:space-between}.progress-card p{margin:6px 0;color:#b7d1d2}.progress-card a{color:var(--teal2)}.resume-line{margin:10px 0 0;font-size:14px}.resume-line em{color:#9fc3c4;font-style:normal;font-size:12px}.section-head{display:flex;align-items:end;justify-content:space-between;margin:70px 0 22px}.section-head h2{font-family:Georgia,serif;font-size:36px;margin:0}.section-head a{color:var(--ink)}.part-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.part-card{min-height:178px;padding:23px;background:var(--white);border:1px solid var(--line);text-decoration:none;color:var(--ink);transition:.18s}.part-card:hover,.chapter-card:hover{border-color:var(--teal);transform:translateY(-2px)}.part-card span{color:var(--teal);font-size:11px;font-weight:800;text-transform:uppercase}.part-card h2{font-family:Georgia,serif;font-size:23px}.part-card p{color:var(--muted);font-size:12px}.catalog-head{max-width:900px;margin-bottom:46px}.catalog-head h1,.tool-intro h1{font-size:clamp(40px,6vw,68px)}.catalog-head>p,.tool-intro>p{font-size:18px;line-height:1.6;color:var(--muted)}.search{display:block;margin-top:28px}.search span{display:block;font-size:12px;font-weight:700;margin-bottom:7px}.search input{width:min(560px,100%);padding:14px 16px;border:1px solid #69878b;background:var(--white);color:var(--ink);font:inherit}.catalog-part{display:grid;grid-template-columns:210px 1fr;gap:35px;border-top:1px solid var(--line);padding:32px 0}.catalog-part>div>p{color:var(--teal);font-size:11px;font-weight:800;text-transform:uppercase}.catalog-part h2{font-family:Georgia,serif;font-size:26px}.chapter-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.chapter-card{padding:18px;background:var(--white);border:1px solid var(--line);text-decoration:none;color:var(--ink)}.chapter-card>span{color:var(--teal);font-family:ui-monospace,monospace}.chapter-card h3{font-size:16px;line-height:1.35}.chapter-card p{font-size:11px;color:var(--muted)}.chapter-prose,.prose{max-width:900px;margin:auto}.prose h1{font-family:Georgia,serif;font-size:clamp(34px,5vw,58px);line-height:1.06;letter-spacing:-.025em;margin:0 0 36px}.prose h2{font-family:Georgia,serif;font-size:32px;margin:62px 0 18px;padding-top:10px;border-top:1px solid var(--line)}.prose h3{font-size:20px;margin:38px 0 12px}.prose h4{font-size:16px}.prose p,.prose li{font-size:16px;line-height:1.72}.prose p{margin:13px 0}.prose a{color:var(--link)}.prose pre{overflow:auto;background:var(--navy);color:#d9eeee;padding:18px;border-left:4px solid var(--teal);font-size:13px;line-height:1.55}.prose code{font-family:"Cascadia Code",Consolas,monospace;background:var(--code);padding:.08em .28em}.prose pre code{background:none;padding:0}.prose table{width:100%;border-collapse:collapse;margin:20px 0;background:var(--white)}.prose th,.prose td{padding:10px;border:1px solid var(--line);text-align:left}.prose th.num,.prose td.num{text-align:right}.prose blockquote{margin:24px 0;padding:5px 20px;border-left:4px solid var(--amber);background:var(--quote)}.prose details{margin:20px 0;padding:16px;border:1px solid var(--line);background:var(--white)}.prose img{max-width:100%}.pager{max-width:900px;margin:60px auto 0;display:grid;grid-template-columns:1fr auto 1fr;gap:14px;border-top:1px solid var(--line);padding-top:24px}.pager a{color:var(--ink);text-decoration:none;font-weight:700}.pager a:last-child{text-align:right}.assessment-link{color:var(--teal)!important}.tool-intro{max-width:950px;margin:0 auto 35px}.study-surface,.compact-prose{max-width:980px;margin:0 auto 38px;background:var(--white);border:1px solid var(--line);padding:clamp(18px,4vw,42px)}.study-app .controls{display:flex;flex-wrap:wrap;gap:8px;margin:15px 0}.study-app button,.study-surface button,.study-app select,.file-label{padding:10px 14px;border:1px solid #63858a;background:var(--white);color:var(--ink);cursor:pointer;font:inherit}.study-app .navbtn[aria-pressed=true]{background:var(--navy);color:white}.study-app .card,.quiz{padding:20px;margin:18px 0;border:1px solid var(--line);background:var(--soft)}.study-app label.option,.quiz label{display:block;padding:10px;margin:8px 0;background:var(--white);border:1px solid var(--line);cursor:pointer}.study-app label.option:has(input:checked){border-color:var(--teal);background:var(--selected)}.study-app .answer-field{display:block;width:100%;max-width:320px;padding:10px;margin-top:6px;background:var(--white);color:var(--ink);border:1px solid var(--line)}.study-app .result{padding:12px;border-left:4px solid var(--teal);background:var(--success)}.study-app .ok{color:var(--teal)}.study-app .bad{color:#e07961}.study-app progress{width:100%}.study-app table{width:100%;border-collapse:collapse}.study-app td,.study-app th{padding:9px;border:1px solid var(--line)}.study-app .hidden-input{display:none}.study-app .confidence{margin:14px 0 4px;padding:10px 12px;border:1px dashed var(--line);background:var(--white);display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px}.study-app .confidence legend{padding:0 6px;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.study-app label.conf-option{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid transparent;font-size:14px;cursor:pointer}.study-app label.conf-option:has(input:checked){border-color:var(--teal);background:var(--selected)}.study-app label.conf-option:has(input:disabled){opacity:.65;cursor:default}.study-app .reason-tier{margin:16px 0 4px;padding:14px 16px;border:1px solid var(--line);background:var(--white)}.study-app .reason-tier h4{margin:0 0 4px;font-size:15px}.study-app .reason-tier .note{margin:0 0 10px}.study-app .error-entry{border-left:4px solid #e07961}.study-app .error-entry.is-done{border-left-color:var(--teal);opacity:.72}.reference-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:900px;margin:0 auto 44px}.reference-cards a{padding:22px;background:var(--navy2);color:white;text-decoration:none}.reference-cards span{display:block;color:var(--teal2);font-size:11px;text-transform:uppercase;margin-bottom:8px}.reference-cards strong{font-family:Georgia,serif;font-size:20px}@media(max-width:900px){.topbar{gap:18px}.topbar>nav{display:none}.theme-toggle{margin-left:auto}.mobile-menu{display:block}.mobile-menu summary{cursor:pointer}.mobile-menu>div{position:absolute;right:16px;top:58px;background:var(--navy2);padding:18px;box-shadow:0 12px 30px #0008}.mobile-menu .brand{display:none}.mobile-menu nav{display:grid;gap:14px}.with-sidebar{display:block}.side-nav{display:none}.hero{grid-template-columns:1fr;gap:30px}.part-grid{grid-template-columns:1fr 1fr}.catalog-part{grid-template-columns:1fr}.chapter-grid{grid-template-columns:1fr}.reference-cards{grid-template-columns:1fr}.page-main{padding-top:35px}}@media(max-width:560px){.theme-toggle [data-theme-label]{display:none}.part-grid{grid-template-columns:1fr}.hero h1{font-size:44px}.hero-actions{flex-direction:column}.pager{grid-template-columns:1fr}.pager a:last-child{text-align:left}.study-surface{padding:14px}.topbar{padding:0 18px}}@media print{.topbar,.side-nav,.pager{display:none}.with-sidebar{display:block}.page-main{padding:0}.prose{width:auto;max-width:none}}
/* Chapter quick trainer */
.chapter-recall{max-width:900px;margin:68px auto 0;padding:clamp(22px,4vw,38px);background:var(--white);border:1px solid var(--line)}.chapter-recall h2{margin:0;font-family:Georgia,serif;font-size:clamp(28px,4vw,38px)}.chapter-recall header p:last-child{max-width:640px;margin:9px 0 0;color:var(--muted);line-height:1.55}.recall-field{display:block;margin:22px 0 8px}.recall-field span{display:block;margin-bottom:7px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.recall-field textarea{width:100%;padding:14px;border:1px solid var(--line);background:var(--soft);color:var(--ink);font:inherit;line-height:1.6;resize:vertical}.recall-field textarea:focus-visible{outline:2px solid var(--teal);outline-offset:2px}.recall-hint{margin:0 0 18px;font-size:13px;color:var(--muted)}.recall-topics{padding:16px 18px;border:1px solid var(--line);background:var(--soft)}.recall-topics summary{cursor:pointer;font-weight:750}.recall-topics ol{margin:14px 0 0;padding-left:20px;display:grid;gap:9px}.recall-topics li{line-height:1.5}.recall-topics label{display:inline-flex;align-items:flex-start;gap:9px;cursor:pointer}.recall-topics input{margin-top:.3em;accent-color:var(--teal)}.recall-topics li a{margin-left:10px;font-size:12px;color:var(--link)}.recall-note{margin:12px 0 0;font-size:13px;color:var(--muted)}.recall-score{margin:14px 0 0;font-weight:750}.chapter-trainer{max-width:900px;margin:68px auto 0;padding:clamp(22px,4vw,38px);background:var(--white);border:1px solid var(--line);box-shadow:0 16px 40px #06151d0c}.chapter-trainer>header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:1px solid var(--line)}.chapter-trainer h2{margin:0;font-family:Georgia,serif;font-size:clamp(28px,4vw,38px)}.chapter-trainer header p:last-child{max-width:610px;margin:9px 0 0;color:var(--muted);line-height:1.55}.chapter-trainer>header>strong{flex:0 0 auto;min-width:78px;padding:10px 12px;background:var(--navy2);color:white;text-align:center;font-variant-numeric:tabular-nums}.trainer-question{margin:24px 0 0;padding:0;border:0}.trainer-question legend{display:flex;gap:12px;width:100%;font-size:16px;font-weight:750;line-height:1.45}.trainer-question legend>span{display:grid;flex:0 0 28px;height:28px;place-items:center;background:var(--teal);color:#04191d;font-size:12px}.trainer-options{display:grid;gap:8px;margin:15px 0}.trainer-options label{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:var(--soft);border:1px solid var(--line);cursor:pointer;line-height:1.45}.trainer-options label:has(input:checked){border-color:var(--teal);background:var(--selected)}.trainer-options label.is-correct{border-color:#319480;background:var(--success)}.trainer-options label.is-wrong{border-color:#c45a43;background:var(--quote)}.trainer-options input{margin-top:.25em;accent-color:var(--teal)}.trainer-actions{display:flex;align-items:center;gap:14px}.trainer-actions button{padding:10px 16px;border:1px solid var(--navy);background:var(--navy);color:white;font:700 13px/1.2 inherit;cursor:pointer}.trainer-actions button:disabled{opacity:.55;cursor:not-allowed}.trainer-feedback{margin:0;font-size:13px;line-height:1.45}.trainer-feedback.is-correct{color:#137769}.trainer-feedback.is-wrong{color:#b04f3c}.chapter-trainer>footer{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:27px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.chapter-trainer>footer a{color:var(--link);font-weight:750;text-decoration:none}@media(max-width:560px){.chapter-trainer>header,.chapter-trainer>footer,.trainer-actions{align-items:stretch;flex-direction:column}.chapter-trainer>header>strong{align-self:flex-start}.trainer-feedback{min-height:0}}
/* Chapter practice bridge */
/* Маршрут прохождения: чек-лист и календарь только показывают факты. */
.route-order{margin:0;padding-left:22px}
.route-order li{margin:10px 0;line-height:1.6}
.route-hint{margin:20px 0 0;padding:14px 16px;background:var(--soft);border-left:3px solid var(--teal);line-height:1.55}
.route-board{max-width:980px;margin:0 auto 38px;padding:clamp(18px,4vw,34px);background:var(--white);border:1px solid var(--line)}
.route-head{display:flex;align-items:baseline;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
.route-head h2{margin:0;font-family:Georgia,serif;font-size:clamp(22px,3vw,30px)}
.route-head p{margin:0;color:var(--muted);font-size:13px;max-width:520px;line-height:1.5}
.route-table{width:100%;border-collapse:collapse;font-size:13.5px}
.route-table th,.route-table td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.route-table thead th{border-bottom:2px solid var(--line);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.route-table tbody th{font-weight:600;max-width:330px}
.route-table tbody th span{display:inline-block;min-width:26px;color:var(--link);font-variant-numeric:tabular-nums}
.route-table a{color:var(--link);text-decoration:none;margin-right:7px}
.route-table a:hover{text-decoration:underline}
.route-table tr[data-route-done=all]{background:var(--success)}
.route-mark{display:inline-block;padding:2px 8px;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;border:1px solid var(--line);background:var(--soft);color:var(--muted)}
.route-mark[data-route-state=done]{border-color:#2f9a86;background:var(--success);color:var(--ink);font-weight:650}
.route-mark[data-route-state=partial]{border-color:var(--amber);background:var(--quote);color:var(--ink)}
.route-links{display:block;margin-bottom:5px}
.route-note{margin:16px 0 0;color:var(--muted);font-size:12.5px;line-height:1.5}
td .route-note{display:block;margin:4px 0 0;font-size:11.5px}
.route-months{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:18px}
.route-month{border:1px solid var(--line);padding:12px}
.route-month h3{margin:0 0 10px;font-size:13px;font-weight:700}
.route-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.route-grid span{display:grid;place-items:center;aspect-ratio:1;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;background:var(--soft)}
.route-grid span.is-empty{background:none}
.route-grid span.is-weekend{color:#a2726a}
.route-grid span.has-events{background:var(--teal);color:#04191d;font-weight:750}
.route-grid span.is-head{background:none;color:var(--muted);font-size:10px;text-transform:uppercase}
.route-log{margin:24px 0 0;padding:0;list-style:none;display:grid;gap:10px}
.route-log li{display:grid;grid-template-columns:104px 1fr;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--line);font-size:13px;line-height:1.5}
.route-log time{color:var(--link);font-variant-numeric:tabular-nums}
.route-log p{margin:0}
.route-empty{color:var(--muted);font-size:13px;line-height:1.55}
.route-backup{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:18px}
@media(max-width:700px){
  .route-table{font-size:12.5px}
  .route-table th,.route-table td{padding:7px 6px}
  .route-table tbody th{max-width:none}
  .route-log li{grid-template-columns:1fr;gap:2px}
}
/* Навигация по разделам страницы: липкая колонка справа на широком экране,
   сворачиваемый блок сверху на узком. */
.section-rail{margin:0 0 26px}
.section-rail details{border:1px solid var(--line);background:var(--white)}
.section-rail summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 15px;cursor:pointer;font-weight:750;font-size:13px;list-style:none}
.section-rail summary::-webkit-details-marker{display:none}
.section-rail summary::after{content:'▾';color:var(--muted);transition:transform var(--duration-quick) var(--ease-out)}
.section-rail details[open] summary::after{transform:rotate(180deg)}
.section-rail summary strong{min-width:22px;padding:2px 7px;background:var(--soft);color:var(--muted);font-size:11px;text-align:center;font-variant-numeric:tabular-nums}
.section-rail ol{margin:0;padding:4px 0 10px;list-style:none;counter-reset:none}
.section-rail li{margin:0}
.section-rail a{display:grid;grid-template-columns:44px 1fr;gap:8px;padding:7px 15px;color:var(--muted);text-decoration:none;font-size:12.5px;line-height:1.4;border-left:2px solid transparent}
.section-rail a span{color:var(--link);font-variant-numeric:tabular-nums}
.section-rail a:hover{color:var(--ink);background:var(--soft)}
.section-rail a[aria-current=true]{color:var(--ink);border-left-color:var(--teal);background:var(--selected);font-weight:650}
.section-rail a:focus-visible{outline:2px solid var(--teal);outline-offset:-2px}
@media(max-width:1499px){
  .section-rail{position:sticky;top:68px;z-index:15;margin:0 0 22px}
  .section-rail details{box-shadow:0 8px 20px #06151d1f}
  .section-rail details[open] ol{max-height:min(56vh,420px);overflow:auto;overscroll-behavior:contain}
}
@media(min-width:1500px){
  .page-main:has(.section-rail){display:grid;grid-template-columns:minmax(0,1fr) 250px;column-gap:clamp(24px,3vw,48px);align-items:start}
  .page-main:has(.section-rail)>*{grid-column:1;min-width:0}
  .page-main .section-rail{grid-column:2;grid-row:1/span 500;position:sticky;top:96px;max-height:calc(100vh - 132px);overflow:auto;margin:0;overscroll-behavior:contain}
  .section-rail details{border:0;border-left:1px solid var(--line);background:none}
  .section-rail summary{padding:0 15px 10px;color:var(--muted);font-size:11px;letter-spacing:.1em;text-transform:uppercase}
  .section-rail summary::after{display:none}
}
.chapter-practice{max-width:900px;margin:34px auto 0;padding:clamp(20px,3.4vw,32px);background:var(--soft);border:1px solid var(--line)}.chapter-practice header{margin-bottom:18px}.chapter-practice h2{margin:4px 0 0;font-family:Georgia,serif;font-size:clamp(22px,3vw,28px)}.practice-grid{display:grid;gap:10px}.practice-grid a{display:grid;grid-template-columns:58px 1fr;align-items:baseline;gap:4px 14px;padding:14px 16px;background:var(--white);border:1px solid var(--line);color:inherit;text-decoration:none}.practice-grid a:hover{border-color:var(--teal)}.practice-grid span{grid-row:1/3;align-self:center;font-weight:750;font-size:13px;color:var(--link);font-variant-numeric:tabular-nums}.practice-grid strong{font-size:15px;line-height:1.4}.practice-grid em{color:var(--muted);font-size:12.5px;font-style:normal;line-height:1.4}.practice-note{margin:16px 0 0;color:var(--muted);font-size:12.5px;line-height:1.5}.module-lab{margin:26px 0 0;padding:18px 20px;background:var(--white);border:1px solid var(--line)}.module-lab h3{margin:0 0 10px;font-family:Georgia,serif;font-size:20px}.module-lab h2{font-size:18px;margin:0 0 8px}.module-lab p{font-size:14.5px;line-height:1.6}.module-lab pre{overflow:auto;background:var(--navy);color:#d9eeee;padding:12px 14px;font-size:12.5px}.lab-card{border-left:3px solid var(--teal)}.lab-card h4{margin:0 0 6px;font-size:16px}@media(max-width:560px){.practice-grid a{grid-template-columns:1fr}.practice-grid span{grid-row:auto}}
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
/* ── Токены движения (transitions.dev) и чтения ──────────────────────────── */
:root{
--duration-stagger:40ms;--duration-micro:80ms;--duration-quick:150ms;--duration-fast:250ms;--duration-medium:350ms;--duration-slow:400ms;--duration-very-slow:500ms;
--ease-smooth-out:cubic-bezier(0.22,1,0.36,1);--ease-in-out:ease-in-out;--ease-out:ease-out;--ease-linear:linear;--ease-bounce:cubic-bezier(0.34,1.36,0.64,1);
--distance-micro:4px;--distance-small:6px;--distance-base:8px;--distance-medium:12px;
--scale-large:0.96;--scale-small:0.98;--blur-small:2px;--blur-medium:3px;
--modal-open-dur:250ms;--modal-close-dur:150ms;--modal-scale:0.96;--modal-scale-close:0.96;--modal-ease:cubic-bezier(0.22,1,0.36,1);
--panel-open-dur:400ms;--panel-close-dur:350ms;--panel-blur:2px;--panel-ease:cubic-bezier(0.22,1,0.36,1);
--toast-open:350ms;--toast-close:250ms;--toast-distance:16px;--toast-blur:2px;--toast-scale:0.97;--toast-ease:cubic-bezier(0.22,1,0.36,1);
--stagger-dur:500ms;--stagger-distance:12px;--stagger-stagger:40ms;--stagger-blur:3px;--stagger-ease:cubic-bezier(0.22,1,0.36,1);
--acc-expand:250ms;--acc-collapse:250ms;--acc-chevron:250ms;--acc-ease:cubic-bezier(0.22,1,0.36,1);
--tt-in-dur:150ms;--tt-out-dur:50ms;--tt-scale:0.98;--tt-delay:80ms;--tt-in-ease:ease-out;--tt-out-ease:ease-out;
--shake-distance:6px;--shake-overshoot:4px;--shake-dur-a:80ms;--shake-dur-b:60ms;--shake-ease:cubic-bezier(0.22,1,0.36,1);
--digit-dur:500ms;--digit-distance:8px;--digit-stagger:70ms;--digit-blur:2px;--digit-ease:cubic-bezier(0.34,1.45,0.64,1);
--pulse-dur:1000ms;--pulse-min:0.5;--reveal-dur:400ms;--reveal-blur:2px;--reveal-ease:ease-in-out;
--check-dur:500ms;--check-ease:cubic-bezier(0.22,1,0.36,1);
--header-h:68px;--reading-size:17px;--reading-measure:74ch}

/* ── Типографика ─────────────────────────────────────────────────────────── */
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-size-adjust:100%}
h1,h2,h3,h4{text-wrap:balance}
.prose p,.prose li,.catalog-head>p,.tool-intro>p,.hero>div>p{text-wrap:pretty}
/* Ширина строки задана в знаках, но она верхняя граница, а не размер: рядом
   стоит рейл разделов, и на ноутбуке колонки под неё уже не хватает. Через
   max-width текст этого не замечал и уезжал под рейл — здесь нужен width,
   тогда 100% доступного места побеждает заданную меру. */
.prose{width:min(100%,900px,var(--reading-measure))}
.prose p,.prose li{font-size:var(--reading-size);line-height:1.7}
.prose h1{line-height:1.06}
.prose h2{line-height:1.15;text-wrap:balance}
.prose h3{line-height:1.25}
.prose a{text-underline-position:from-font;text-decoration-thickness:from-font;text-underline-offset:2px;text-decoration-skip-ink:auto}
.prose pre{overflow-x:auto;overscroll-behavior-x:contain}
.prose code{overflow-wrap:break-word}
.prose table{display:block;overflow-x:auto;max-width:100%}
.prose abbr[title]{text-decoration:underline dotted;text-underline-offset:2px;cursor:help}
[data-trainer-score],[data-notes-count],[data-notes-badge],.hero-stats strong,.side-nav a span{font-variant-numeric:tabular-nums}
.search-field input,.study-app .answer-field,.search input{font-size:max(16px,1rem)}

/* ── Доступность ─────────────────────────────────────────────────────────── */
:where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{outline:2px solid var(--teal);outline-offset:2px;border-radius:2px}
.topbar :focus-visible{outline-color:var(--teal2)}
:is(h1,h2,h3,h4)[id],[id]:target{scroll-margin-top:calc(var(--header-h) + 18px)}
.skip-link{position:absolute;left:12px;top:-60px;z-index:80;padding:11px 16px;background:var(--white);color:var(--ink);border:1px solid var(--teal);font:700 14px/1.2 inherit;text-decoration:none;transition:top var(--duration-quick) var(--ease-smooth-out)}
.skip-link:focus{top:12px}
.topbar button,.topbar a{min-height:40px;display:inline-flex;align-items:center}
.topbar nav a{padding:9px 2px}
.icon-button{min-width:40px;min-height:40px;display:inline-flex;align-items:center;justify-content:center}
.trainer-options label{min-height:44px;align-items:center}
.notes-panel,.search-results,.side-nav{overscroll-behavior:contain}

/* ── Полнотекстовый поиск ────────────────────────────────────────────────── */
.visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.topbar>nav{margin-right:auto}
.topbar nav a,.theme-toggle,.notes-toggle,.brand{white-space:nowrap}
.topbar{gap:clamp(16px,3vw,44px)}
.read-size{display:inline-flex;align-items:stretch;gap:1px;padding:1px;border:1px solid #ffffff35;background:#ffffff0b}
.read-size[hidden]{display:none}
.read-size button{min-width:34px;padding:0 8px;border:0;background:transparent;color:#cfe3e4;font-family:Georgia,serif;line-height:1;cursor:pointer}
.read-size button:nth-child(1){font-size:12px}
.read-size button:nth-child(2){font-size:15px}
.read-size button:nth-child(3){font-size:18px}
.read-size button:hover{color:white;background:#ffffff14}
.read-size button[aria-pressed=true]{background:var(--teal);color:#04191d}
.search-toggle{display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid #ffffff35;background:#ffffff0b;color:white;font:600 12px/1.2 inherit;cursor:pointer;white-space:nowrap}
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
.search-hit mark{background:var(--teal2);color:#04191d;padding:0 1px;border-radius:2px}
.search-skeleton{padding:6px 0}
.search-skeleton div{height:13px;margin:13px 16px;background:var(--code);border-radius:3px;animation:t-skel-pulse var(--pulse-dur) ease-in-out infinite}
.search-skeleton div:nth-child(2n){width:62%}
@keyframes t-skel-pulse{0%,100%{opacity:1}50%{opacity:var(--pulse-min)}}

/* ── Анимации (transitions.dev) ──────────────────────────────────────────── */
/* Модальная панель: поиск. Открытие — рост от --modal-scale, закрытие мягче. */
.t-modal{transform-origin:center;transform:scale(var(--modal-scale));opacity:0;pointer-events:none;transition:transform var(--modal-open-dur) var(--modal-ease),opacity var(--modal-open-dur) var(--modal-ease);will-change:transform,opacity}
.t-modal.is-open{transform:scale(1);opacity:1;pointer-events:auto}
.t-modal.is-closing{transform:scale(var(--modal-scale-close));opacity:0;pointer-events:none;transition:transform var(--modal-close-dur) var(--modal-ease),opacity var(--modal-close-dur) var(--modal-ease)}
.search-overlay{opacity:0;transition:opacity var(--modal-close-dur) var(--modal-ease)}
.search-overlay.is-open{opacity:1;transition:opacity var(--modal-open-dur) var(--modal-ease)}

/* Всплывающее сообщение: поднимается снизу с кросс-размытием, уходит быстрее. */
.t-toast{opacity:0;transform:translateY(var(--toast-distance)) scale(var(--toast-scale));filter:blur(var(--toast-blur));will-change:transform,opacity,filter;transition:opacity var(--toast-close) var(--toast-ease),transform var(--toast-close) var(--toast-ease),filter var(--toast-close) var(--toast-ease)}
.t-toast.is-open{opacity:1;transform:translateY(0) scale(1);filter:blur(0);transition:opacity var(--toast-open) var(--toast-ease),transform var(--toast-open) var(--toast-ease),filter var(--toast-open) var(--toast-ease)}

/* Ступенчатое появление шапки страницы: заголовок раньше подзаголовка. */
.t-stagger-line{opacity:0;transform:translateY(var(--stagger-distance));filter:blur(var(--stagger-blur));transition:opacity var(--stagger-dur) var(--stagger-ease),transform var(--stagger-dur) var(--stagger-ease),filter var(--stagger-dur) var(--stagger-ease);will-change:transform,opacity,filter}
.t-stagger.is-shown .t-stagger-line{opacity:1;transform:translateY(0);filter:blur(0)}

/* Раскрывающийся блок: высота через grid-rows, без измерений в JS. */
.t-acc-panel{display:grid;grid-template-rows:0fr;transition:grid-template-rows var(--acc-collapse) var(--acc-ease)}
.t-acc[data-open="true"] .t-acc-panel{grid-template-rows:1fr;transition:grid-template-rows var(--acc-expand) var(--acc-ease)}
.t-acc-panel-inner{overflow:hidden;opacity:0;filter:blur(2px);transition:opacity var(--acc-collapse) var(--acc-ease),filter var(--acc-collapse) var(--acc-ease)}
.t-acc[data-open="true"] .t-acc-panel-inner{opacity:1;filter:blur(0);transition:opacity var(--acc-expand) var(--acc-ease),filter var(--acc-expand) var(--acc-ease)}
.t-acc>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;min-height:40px;font-weight:700}
.t-acc>summary::-webkit-details-marker{display:none}
.t-acc-chevron{display:inline-flex;flex:0 0 auto;color:var(--teal);transform:scaleY(1);transform-origin:center;transition:transform var(--acc-chevron) var(--acc-ease)}
.t-acc-chevron path{vector-effect:non-scaling-stroke}
.t-acc[data-open="true"] .t-acc-chevron{transform:scaleY(-1)}

/* Карточка определения и панель выделения: короткое появление, мгновенный уход. */
.define-card:not([hidden]),.selection-toolbar:not([hidden]){animation:t-tt-in var(--tt-in-dur) var(--tt-in-ease) var(--tt-delay) both}
@keyframes t-tt-in{from{opacity:0;transform:scale(var(--tt-scale))}to{opacity:1;transform:scale(1)}}
.reader-toast.t-toast.is-visible{opacity:1;transform:translateY(0) scale(1);filter:blur(0);transition:opacity var(--toast-open) var(--toast-ease),transform var(--toast-open) var(--toast-ease),filter var(--toast-open) var(--toast-ease)}

/* Мини-тренажёр: верный ответ — рисуемая галочка, неверный — короткая тряска. */
.trainer-question{transition:transform 0s}
.trainer-question.is-shaking{animation:t-input-shake calc(var(--shake-dur-a)*2 + var(--shake-dur-b)*2) linear}
@keyframes t-input-shake{0%{transform:translateX(0);animation-timing-function:var(--shake-ease)}28.57%{transform:translateX(var(--shake-distance));animation-timing-function:var(--shake-ease)}57.14%{transform:translateX(calc(var(--shake-distance)*-1));animation-timing-function:var(--shake-ease)}78.57%{transform:translateX(var(--shake-overshoot));animation-timing-function:var(--shake-ease)}100%{transform:translateX(0)}}
.trainer-check{flex:0 0 auto;width:22px;height:22px;opacity:0}
.trainer-check.is-shown{animation:t-check-in var(--check-dur) var(--check-ease) both}
.trainer-check path{stroke:var(--teal);stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:24;stroke-dashoffset:24}
.trainer-check.is-shown path{animation:t-check-draw var(--check-dur) var(--check-ease) var(--duration-micro) forwards}
@keyframes t-check-in{0%{opacity:0;transform:rotate(-80deg) scale(.6);filter:blur(8px)}100%{opacity:1;transform:rotate(0) scale(1);filter:blur(0)}}
@keyframes t-check-draw{to{stroke-dashoffset:0}}
.trainer-options label{transition:border-color var(--duration-quick) var(--ease-out),background-color var(--duration-quick) var(--ease-out)}

/* Счёт тренажёра: цифры вкатываются с размытием при изменении. */
.t-digit{display:inline-block;will-change:transform,opacity,filter}
.t-digit-group.is-animating .t-digit{animation:t-digit-pop-in var(--digit-dur) var(--digit-ease) both}
.t-digit-group.is-animating .t-digit[data-stagger="1"]{animation-delay:var(--digit-stagger)}
@keyframes t-digit-pop-in{0%{transform:translateY(var(--digit-distance));opacity:0;filter:blur(var(--digit-blur))}100%{transform:translateY(0);opacity:1;filter:blur(0)}}

/* Отклик на нажатие и наведение — 0.96 по better-ui. */
.button,.theme-toggle,.notes-toggle,.search-toggle,.study-app button,.study-surface button,.trainer-actions button,.icon-button{transition:transform var(--duration-quick) var(--ease-smooth-out),background-color var(--duration-quick) var(--ease-out),border-color var(--duration-quick) var(--ease-out),color var(--duration-quick) var(--ease-out)}
.button:active,.theme-toggle:active,.notes-toggle:active,.search-toggle:active,.study-app button:active,.study-surface button:active,.trainer-actions button:active,.icon-button:active{transform:scale(0.96)}
.part-card,.chapter-card,.reference-cards a,.practice-grid a,.search-hit{transition:transform var(--duration-fast) var(--ease-smooth-out),border-color var(--duration-fast) var(--ease-out),background-color var(--duration-fast) var(--ease-out),box-shadow var(--duration-fast) var(--ease-out)}
.side-nav a{transition:background-color var(--duration-quick) var(--ease-out),color var(--duration-quick) var(--ease-out)}

/* Индикатор прочитанного и переход между страницами. */
.read-progress{position:fixed;left:0;top:var(--header-h);z-index:19;height:3px;width:100%;transform:scaleX(0);transform-origin:0 50%;background:var(--teal);opacity:.85;will-change:transform}
@view-transition{navigation:auto}
::view-transition-old(root){animation:t-page-out var(--duration-quick) var(--ease-smooth-out) both}
::view-transition-new(root){animation:t-page-in var(--duration-fast) var(--ease-smooth-out) both}
@keyframes t-page-out{to{opacity:0;filter:blur(var(--blur-medium));transform:translateY(calc(var(--distance-base)*-1))}}
@keyframes t-page-in{from{opacity:0;filter:blur(var(--blur-medium));transform:translateY(var(--distance-base))}}

@media(prefers-reduced-motion:reduce){
html{scroll-behavior:auto}
.t-modal,.search-overlay,.t-toast,.t-stagger-line,.t-acc-panel,.t-acc-panel-inner,.t-acc-chevron,.define-card,.trainer-options label,.button,.theme-toggle,.notes-toggle,.search-toggle,.part-card,.chapter-card,.reference-cards a,.practice-grid a,.search-hit,.side-nav a,.icon-button,.read-progress{transition:none!important}
.trainer-question.is-shaking,.trainer-check.is-shown,.trainer-check.is-shown path,.t-digit-group.is-animating .t-digit,.search-skeleton div{animation:none!important}
.trainer-check.is-shown{opacity:1}
.trainer-check.is-shown path{stroke-dashoffset:0}
.button:active,.theme-toggle:active,.notes-toggle:active,.search-toggle:active,.trainer-actions button:active,.icon-button:active{transform:none}
::view-transition-old(root),::view-transition-new(root){animation:none!important}
}
@media(max-width:900px){.topbar{gap:12px}.topbar .brand{margin-right:auto}.read-size{display:none}.search-toggle span:nth-child(2),.search-toggle kbd{display:none}.notes-toggle span:nth-child(2){display:none}.notes-panel{top:68px}.selection-toolbar{left:10px!important;right:10px;bottom:12px;top:auto!important;justify-content:center;flex-wrap:wrap}}@media(max-width:560px){.notes-toggle{padding:8px}.theme-toggle{padding:8px}.notes-panel{padding:19px}.notes-backdrop{display:none}.selection-toolbar>button:not(.color-dot){font-size:10px}}@media print{.notes-toggle,.notes-panel,.notes-backdrop,.selection-toolbar,.reader-toast{display:none!important}.reader-highlight{background:transparent!important;color:inherit;padding:0}}
/* --- Телефоны -------------------------------------------------------------
   Страница обязана помещаться в ширину экрана. Иначе браузер сам расширяет
   область просмотра под самый широкий элемент и уменьшает масштаб: текст
   становится мельче задуманного, и это видно на всех страницах сразу.
   Ширину задавали панель сверху (её нельзя было сжать уже 355px) и таблица
   маршрута (433px), из-за которой страница не помещалась даже в 430px. */
@media(max-width:900px){
 .topbar{gap:10px;padding:0 14px}
 .brand{min-width:0}
 /* Кнопки панели — цели для пальца, а не для указателя: 44px по обеим сторонам. */
 .search-toggle,.theme-toggle,.notes-toggle{min-width:44px;min-height:44px;justify-content:center}
 .mobile-menu summary{display:inline-flex;align-items:center;min-height:44px;padding:0 2px}
 /* Длинное имя файла или адрес не должны раздвигать страницу. */
 .prose,.compact-prose,.route-board,.study-surface{overflow-wrap:break-word}
 /* Широкая таблица прокручивается внутри себя, а не тянет за собой страницу. */
 .prose table{display:block;overflow-x:auto;max-width:100%}
 .study-app select{max-width:100%}
}
@media(max-width:400px){
 .topbar{gap:6px;padding:0 10px}
 .brand span{display:none}
 /* Логотип перестаёт наезжать на кнопки: он сжимается, а не выходит за свои границы. */
 .brand{overflow:hidden}
 /* «инфраструктура» набором в 44px занимает 300px и одна задаёт ширину страницы. */
 .hero h1{font-size:34px}
 .section-head h2{font-size:28px}
 .catalog-head h1,.tool-intro h1{font-size:34px}
}
/* Длинное слово в заголовке не должно расталкивать страницу. Автоматических
   переносов здесь нет: браузер расставляет их не только по нужде, но и ради
   плотности строки, и обычный заголовок разрывается без всякой причины
   («Как устро-ен учебник»). Разрыв нужен ровно в одном случае — слово шире
   колонки, и его делает overflow-wrap. */
.hero h1,.catalog-head h1,.tool-intro h1,.prose h1,.prose h2,.prose h3{overflow-wrap:break-word;hyphens:manual}
@media(max-width:320px){
 /* Логотип должен помещаться целиком: обрезанное слово читается как поломка. */
 .topbar{gap:4px;padding:0 8px}
 .brand strong{font-size:17px}
}
/* Чек-лист маршрута на телефоне разворачивается в карточки: четыре колонки
   не сжимаются ниже 433px, а горизонтальная прокрутка для списка, по которому
   ведут учёт, неудобна. Подписи берутся из data-атрибутов, разметка та же. */
@media(max-width:600px){
 .route-table,.route-table tbody,.route-table tr,.route-table tbody th,.route-table td{display:block}
 .route-table thead{display:none}
 .route-table tr{border:1px solid var(--line);margin:0 0 10px;padding:11px 13px}
 .route-table tbody th{max-width:none;padding:0 0 9px;font-size:15px;border-bottom:1px solid var(--line)}
 .route-table td{display:flex;gap:10px;align-items:baseline;padding:7px 0;border-bottom:0}
 .route-table td::before{flex:0 0 96px;color:var(--muted);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase}
 .route-table td[data-route-cell=chapter]::before{content:'Тренажёр'}
 .route-table td[data-route-cell=module]::before{content:'Модуль'}
 .route-table td[data-route-cell=labs]::before{content:'Практикум'}
 .route-table a{display:inline-block;padding:3px 0;margin-right:10px}
 .route-months{grid-template-columns:1fr}
}
/* На самых узких экранах слово «Разделы» уступает место значку. Слово остаётся
   в разметке скрытым для глаза, но доступным программам чтения с экрана —
   у кнопки должно оставаться название. */
.mobile-menu summary::before{content:'\\2630';margin-right:8px;font-size:19px;line-height:1}
@media(max-width:360px){
 .mobile-menu .menu-label{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
 .mobile-menu summary::before{margin-right:0}
 .mobile-menu summary{min-width:44px;justify-content:center}
}
/* Поле выбора файла пряталось только внутри кабинета, поэтому на странице
   маршрута рядом с оформленной кнопкой торчал системный элемент выбора. */
.hidden-input{display:none}
@media(max-width:380px){
 /* На самых узких экранах подпись строки чек-листа встаёт над значением. */
 .route-table td{display:block}
 .route-table td::before{display:block;margin-bottom:3px}
}
/* Блок кода прокручивается внутри себя везде, а не только в тексте главы:
   в кабинете и на служебных страницах он тоже длиннее экрана телефона. */
.study-surface pre,.compact-prose pre,.route-board pre,.study-app pre{overflow:auto;max-width:100%}
@media(max-width:420px){
 /* Две колонки чисел на титуле не сжимаются ниже 304px — на узком экране одна. */
 .hero-stats{grid-template-columns:1fr}
 .hero-stats div{padding:18px}
}
@media(max-width:600px){
 /* Кнопки резервной копии — в столбец: рядом они требуют ширины, которой нет. */
 .route-backup{flex-direction:column;align-items:stretch}
 .route-backup>*{min-width:0;max-width:100%;text-align:center}
}
/* Строка «заголовок слева — ссылка справа» на телефоне не работает: ссылка
   сжимается в узкую колонку и её текст встаёт вплотную к заголовку. Ширина, при
   которой это начинается, зависит от установленных шрифтов, поэтому полагаться
   на «должно поместиться» нельзя — на телефоне такие пары идут в столбец. */
@media(max-width:760px){
 .section-head,.progress-card,.chapter-trainer>header,.chapter-trainer>footer,.route-head{flex-direction:column;align-items:flex-start;gap:12px}
 .section-head a,.progress-card a,.chapter-trainer>footer a{align-self:flex-start}
 /* Разделы кабинета читаются как набор кнопок в два столбца, а не как строка,
    рвущаяся в произвольных местах. */
    Колонки задаём через minmax(0,1fr): у обычного 1fr нижняя граница — ширина
    самого длинного слова в кнопке, поэтому на экране 280–320px две такие
    колонки не помещались и страница разъезжалась вбок. */
 .study-app .controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
 .study-app .controls>*{width:100%;min-width:0;justify-content:center;text-align:center;overflow-wrap:break-word}
 .study-app .controls select{grid-column:1/-1}
}
/* Шапка кабинета читалась как сплошной серый текст: у блока состояния и у
   заметки о хранении не было ни одного правила, и они выглядели так же, как
   вводный абзац. Разводим три вещи — что это, где вы сейчас, чем управлять. */
.study-app>h2{margin:0 0 8px;font-family:Georgia,serif;font-size:clamp(23px,4vw,31px);line-height:1.15}
.study-app>p:first-of-type{margin:0 0 16px;color:var(--muted);font-size:13.5px;line-height:1.55}
.study-app .status-box{display:grid;gap:7px;margin:0 0 10px;padding:15px 17px;background:var(--soft);border:1px solid var(--line);border-left:3px solid var(--teal)}
.study-app .status-box strong{font-size:16px;line-height:1.3}
.study-app .status-box div{color:var(--muted);font-size:13px;line-height:1.5;font-variant-numeric:tabular-nums}
.study-app .status-box progress{height:8px}
.study-app #storage-status{margin:0 0 16px;font-size:12.5px;line-height:1.5;color:var(--muted)}
/* Полоса разделов — это навигация, а не россыпь кнопок: собираем её в блок. */
.study-app .controls:has(.navbtn){gap:6px;padding:7px;background:var(--soft);border:1px solid var(--line)}
.study-app .navbtn{border-color:transparent;background:transparent;font-weight:650}
.study-app .navbtn:hover{background:var(--white)}
.study-app .navbtn[aria-pressed=true]{background:var(--navy);color:white;border-color:var(--navy)}
#study-panel{margin-top:22px;padding-top:4px}
/* Метка выбора файла была строчной: её вертикальные отступы налезали на
   соседнюю строку и на таблицу под ней. */
.file-label{display:inline-flex;align-items:center;justify-content:center;vertical-align:top}
.study-app button,.study-surface button{vertical-align:top}
/* Мелкие цели нажатия в читательских инструментах и кабинете. */
/* Ссылка-строка и флажок — такие же цели для пальца, как кнопка: добавляем
   высоту отступами, чтобы не менять выравнивание текста. */
@media(max-width:900px){
 .pager a{display:block;padding:9px 0}
 .section-head a{display:inline-block;padding:9px 0}
 .chapter-trainer>footer a{display:inline-block;padding:9px 0}
 .section-rail a{min-height:40px;align-content:center}
 .recall-topics label{padding:8px 0}
 .recall-topics li a{display:inline-block;padding:6px 0}
 .route-table a{padding:8px 0;margin-right:14px}
 .selection-toolbar>button:not(.color-dot){font-size:11.5px}
}
.color-dot{width:34px!important;height:34px!important}
.undo-highlight{min-height:40px}
.text-button{padding:9px 4px}
.study-app .controls a{display:inline-flex;align-items:center;min-height:40px;padding:0 4px}
.study-app label.conf-option{min-height:40px}
.route-table thead th{font-size:12px}
td .route-note{font-size:12px}
.route-grid span.is-head{font-size:11px}
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
// Заметки и выделения переносятся между браузерами файлом резервной копии, и
// файл может прийти от постороннего: путь из него попадает в href ссылки
// «источник». Пропускаем только внутренние адреса — «javascript:…» здесь
// выполнился бы по щелчку и получил бы доступ ко всему прогрессу на домене.
const safePath=value=>{const path=String(value??'');return /^\\/(?:$|[^\\/\\s<>])/.test(path)?path:'#'};
const copyText=async text=>{if(!text)return false;try{await navigator.clipboard.writeText(text)}catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)return false}showToast('Скопировано в буфер обмена');return true};
const openNotes=()=>{readerPanel?.classList.add('is-open');readerPanel?.setAttribute('aria-hidden','false');readerToggle?.setAttribute('aria-expanded','true');if(readerBackdrop)readerBackdrop.hidden=false;if(!activeSelection)setTimeout(()=>readerInput?.focus(),40)};
const closeNotes=()=>{readerPanel?.classList.remove('is-open');readerPanel?.setAttribute('aria-hidden','true');readerToggle?.setAttribute('aria-expanded','false');if(readerBackdrop)readerBackdrop.hidden=true;readerToggle?.focus()};
readerToggle?.addEventListener('click',openNotes);document.querySelectorAll('[data-notes-close]').forEach(button=>button.addEventListener('click',closeNotes));document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(readerPanel?.classList.contains('is-open'))closeNotes();if(!readerToolbar?.hidden){getSelection()?.removeAllRanges();clearSelectionUi()}});
const removeHighlightMarks=id=>{document.querySelectorAll('[data-reading-highlight]').forEach(mark=>{if(mark.dataset.readingHighlight!==id)return;const parent=mark.parentNode;mark.replaceWith(...mark.childNodes);parent?.normalize()})};
const deleteHighlight=(id,message='Выделение отменено')=>{readerState.highlights=readerState.highlights.filter(item=>item.id!==id);removeHighlightMarks(id);saveReader();renderReader();clearSelectionUi();showToast(message)};
const applyHighlight=record=>{if(record.path!==readerPath)return false;const root=readerRoots[record.rootIndex];if(!root)return false;let start=Number(record.start),end=Number(record.end),full=root.textContent||'';if(full.slice(start,end)!==record.text){start=full.indexOf(record.text);end=start+record.text.length}if(start<0||end<=start)return false;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),segments=[];let position=0,node;while((node=walker.nextNode())){const nodeStart=position,nodeEnd=position+node.data.length;if(nodeEnd>start&&nodeStart<end)segments.push({node,from:Math.max(0,start-nodeStart),to:Math.min(node.data.length,end-nodeStart)});position=nodeEnd}segments.reverse().forEach((segment,index)=>{const range=document.createRange();range.setStart(segment.node,segment.from);range.setEnd(segment.node,segment.to);const mark=document.createElement('mark');mark.className='reader-highlight';mark.dataset.readingHighlight=record.id;mark.dataset.color=record.color;if(index===segments.length-1)mark.id='reader-highlight-'+record.id;range.surroundContents(mark)});return segments.length>0};
readerState.highlights.filter(item=>item.path===readerPath).sort((a,b)=>Number(a.start)-Number(b.start)).forEach(applyHighlight);
const itemLabel=item=>item.kind==='note'?'Заметка':item.kind==='quote'?'Цитата':'Маркер';
const renderReader=()=>{const entries=[...readerState.notes,...readerState.highlights.map(item=>({...item,kind:'highlight'}))].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),count=entries.length;document.querySelectorAll('[data-notes-count]').forEach(node=>node.textContent=String(count));document.querySelectorAll('[data-notes-badge]').forEach(node=>{node.textContent=String(count);node.hidden=!count});document.querySelectorAll('[data-copy-all]').forEach(node=>node.disabled=!count);document.querySelectorAll('[data-undo-highlight]').forEach(node=>node.disabled=!readerState.highlights.length);if(!readerList)return;if(!count){readerList.innerHTML='<p class="notes-empty">Здесь появятся ваши заметки, цитаты и цветные выделения.</p>';return}readerList.innerHTML=entries.map(item=>{const href=safePath(item.path)+(item.kind==='highlight'?'#reader-highlight-'+item.id:'');return '<article class="note-item"><div class="note-item-head"><span class="note-kind">'+itemLabel(item)+'</span><time datetime="'+escapeText(item.createdAt)+'">'+new Date(item.createdAt).toLocaleDateString('ru-RU')+'</time></div><p>'+escapeText(item.text)+'</p><a class="note-item-source" href="'+escapeText(href)+'">'+escapeText(item.title||item.path)+'</a><div class="note-item-actions"><button type="button" data-copy-item="'+escapeText(item.id)+'" data-item-kind="'+escapeText(item.kind)+'">Копировать</button><button type="button" class="danger" data-delete-item="'+escapeText(item.id)+'" data-item-kind="'+escapeText(item.kind)+'">Удалить</button></div></article>'}).join('')};
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
const renderCourseProgress=()=>{const correct=Object.values(records).filter(x=>x?.correct).length,best=Math.max(0,...history.map(x=>Number(x.correct||0)));document.querySelectorAll('[data-progress-title]').forEach(x=>x.textContent=correct?correct+' проверок выполнено верно':'Маршрут ещё не начат');document.querySelectorAll('[data-progress-copy]').forEach(x=>x.textContent='Python: '+Number(state?.practice?.passed||0)+'/28 · итоговый тест: '+best+'/37');return{correct,best}};
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
const defChapterHref=entry=>entry.chapter===null?null:'${BASE}/chapters/'+String(entry.chapter).padStart(2,'0')+'/#b'+String(entry.chapter).padStart(2,'0');
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
/* Шкала времени прохождения. Запись только добавляется: дата первого зачёта
   больше не меняется, интерфейса правки нет. Та же пара функций дословно
   повторена в скрипте учебного кабинета — при правке менять обе. */
const TIMELINE_KEY='server-infrastructure-timeline-v1';
const readTimeline=()=>{try{const value=JSON.parse(localStorage.getItem(TIMELINE_KEY)||'null');return value&&value.events&&typeof value.events==='object'&&!Array.isArray(value.events)?value:{schema:'course-timeline',events:{}}}catch{return{schema:'course-timeline',events:{}}}};
const stampTimeline=key=>{const line=readTimeline();if(line.events[key])return false;const now=new Date();line.events[key]=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);try{localStorage.setItem(TIMELINE_KEY,JSON.stringify(line));return true}catch{return false}};
const RECALL_KEY='server-infrastructure-recall-v1';
/* Свободное воспроизведение: черновик и отметки читателя. Ничего не засчитывает —
   в шкалу времени эти отметки намеренно не идут: то, что отмечаешь себе сам, ничего не доказывает. */
const recallStore=(()=>{try{const raw=JSON.parse(localStorage.getItem(RECALL_KEY)||'null');return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}}catch{return{}}})();
const saveRecall=()=>{try{localStorage.setItem(RECALL_KEY,JSON.stringify(recallStore))}catch{}};
document.querySelectorAll('[data-chapter-recall]').forEach(block=>{
 const key=block.dataset.chapterRecall,area=block.querySelector('[data-recall-text]'),list=block.querySelector('[data-recall-list]'),score=block.querySelector('[data-recall-score]');
 const boxes=[...block.querySelectorAll('[data-recall-topic]')];
 const saved=recallStore[key]||{text:'',topics:[]};
 area.value=typeof saved.text==='string'?saved.text:'';
 boxes.forEach((box,index)=>{box.checked=Array.isArray(saved.topics)&&saved.topics.includes(index)});
 const refresh=()=>{const done=boxes.filter(box=>box.checked).length;score.textContent='Отмечено: '+done+' из '+boxes.length+'.'+(done&&done<boxes.length?' Неотмеченное — это и есть материал для повторного чтения.':'')};
 const persist=()=>{recallStore[key]={text:area.value,topics:boxes.flatMap((box,index)=>box.checked?[index]:[])};saveRecall()};
 let timer=0;
 area.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(persist,400)});
 boxes.forEach(box=>box.addEventListener('change',()=>{persist();refresh()}));
 /* Список тем открывается только после того, как пересказ написан: иначе упражнение
    снова превращается в узнавание готовых формулировок. */
 list.addEventListener('toggle',()=>{if(list.open&&area.value.trim().length<80){list.open=false;block.querySelector('[data-recall-hint]').textContent='Сначала напишите пересказ: список тем — это уже подсказка, и открытый заранее он лишает упражнение смысла.'}});
 refresh();
});
const QUICK_KEY='server-infrastructure-chapter-trainers-v1';
const readQuick=()=>{try{const value=JSON.parse(localStorage.getItem(QUICK_KEY)||'null');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return{}}};
const quickRecords=readQuick(),saveQuick=()=>{try{localStorage.setItem(QUICK_KEY,JSON.stringify(quickRecords));return true}catch{return false}};
const recordQuickCheck=(id,correct)=>{const old=quickRecords[id];quickRecords[id]={correct,attempts:(old?.attempts||0)+1,last:Date.now()};saveQuick()};
const answerDigest=(id,index)=>{let hash=0x811c9dc5;for(const character of id+'|'+index+'|sic6')hash=Math.imul(hash^character.charCodeAt(0),0x01000193)>>>0;return hash.toString(36)};
const answerIndex=question=>{const id=question.dataset.trainerQuestion,digest=question.dataset.answer,total=question.querySelectorAll('input[type=radio]').length;for(let index=0;index<total;index+=1)if(answerDigest(id,index)===digest)return index;return -1};
/* Длительности читаются из тех же токенов движения, что и CSS, чтобы не разъезжались. */
const motionMs=(name,fallback)=>{const value=parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));return Number.isFinite(value)?value:fallback};
document.querySelectorAll('[data-chapter-trainer]').forEach(trainer=>{const questions=[...trainer.querySelectorAll('[data-trainer-question]')],score=trainer.querySelector('[data-trainer-score]'),summary=trainer.querySelector('[data-trainer-summary]');const renderScore=done=>{const group=document.createElement('span');group.className='t-digit-group';const digit=document.createElement('span');digit.className='t-digit';digit.textContent=String(done);group.append(digit);score.replaceChildren(group,document.createTextNode(' / '+questions.length));void group.offsetWidth;group.classList.add('is-animating')};const refresh=()=>{const done=questions.filter(question=>quickRecords[question.dataset.trainerQuestion]?.correct).length;renderScore(done);summary.textContent=done===questions.length?(trainer.dataset.trainerDone||'Глава закреплена. Можно переходить дальше.'):done?'Верно: '+done+' из '+questions.length+'. Завершите мини-тренажёр.':'Ответьте на оба вопроса.';trainer.classList.toggle('is-complete',done===questions.length);if(done===questions.length)stampTimeline('chapter:'+trainer.dataset.chapterTrainer)};questions.forEach(question=>{const id=question.dataset.trainerQuestion,answer=answerIndex(question),button=question.querySelector('[data-trainer-check]'),feedback=question.querySelector('[data-trainer-feedback]'),inputs=[...question.querySelectorAll('input[type=radio]')],labels=[...question.querySelectorAll('.trainer-options label')];const check=document.createElement('span');check.className='trainer-check';check.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5"/></svg>';button.after(check);const showResult=(correct,restored=false)=>{labels.forEach(label=>label.classList.remove('is-correct','is-wrong'));labels[answer]?.classList.add('is-correct');const chosen=inputs.find(input=>input.checked);if(chosen&&!correct)chosen.closest('label')?.classList.add('is-wrong');feedback.hidden=false;feedback.className='trainer-feedback '+(correct?'is-correct':'is-wrong');feedback.textContent=(restored?'Ранее отвечено верно. ':correct?'Верно. ':'Пока неверно. ')+feedback.dataset.explanation;if(correct){check.classList.remove('is-shown');void check.offsetWidth;check.classList.add('is-shown')}else{const shakeMs=motionMs('--shake-dur-a',80)*2+motionMs('--shake-dur-b',60)*2;question.classList.remove('is-shaking');void question.offsetWidth;question.classList.add('is-shaking');setTimeout(()=>question.classList.remove('is-shaking'),shakeMs+20)}if(correct){inputs.forEach(input=>input.disabled=true);button.disabled=true;button.textContent='Засчитано'}else{button.textContent='Проверить ещё раз'}};if(quickRecords[id]?.correct){inputs[answer].checked=true;showResult(true,true)}button.addEventListener('click',()=>{const selected=inputs.find(input=>input.checked);if(!selected){feedback.hidden=false;feedback.className='trainer-feedback is-wrong';feedback.textContent='Сначала выберите вариант ответа.';return}const correct=Number(selected.value)===answer;recordQuickCheck(id,correct);showResult(correct);refresh()})});refresh()});
/* Полнотекстовый поиск. Индекс лежит отдельным файлом и загружается один раз при
   первом открытии панели, поэтому страница не тяжелеет от 76 тысяч слов. */
const searchOverlay=document.querySelector('[data-search-overlay]'),searchInput=document.querySelector('[data-search-input]'),searchStatus=document.querySelector('[data-search-status]'),searchResults=document.querySelector('[data-search-results]');
const fold=text=>String(text).toLowerCase().replace(/ё/g,'е');
let searchIndex=null,searchRequest=null,searchTimer=0,searchReturnFocus=null;
const loadSearchIndex=()=>{
  if(searchIndex)return Promise.resolve(searchIndex);
  if(!searchRequest)searchRequest=fetch('${BASE}/assets/search.json').then(response=>{if(!response.ok)throw new Error('HTTP '+response.status);return response.json()}).then(data=>{searchIndex=data.s.map(row=>{const page=data.p[row[0]];return{u:page[0],t:page[1],a:row[1],h:row[2],x:row[3],f:fold(row[2]+' '+row[3])}});return searchIndex});
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
    const href='${BASE}'+entry.u+(entry.a?'#'+entry.a:'');
    const source=entry.t===entry.h?'':'<em>'+escapeText(entry.t)+'</em>';
    return '<a class="search-hit" href="'+escapeText(href)+'"><strong>'+markTerms(entry.h,terms)+'</strong>'+source+'<p>'+markTerms(excerpt(entry.x,terms),terms)+'</p></a>';
  }).join('');
};
const scheduleSearch=()=>{
  clearTimeout(searchTimer);
  const query=searchInput.value.trim();
  if(query.length<2){searchResults.innerHTML='';searchStatus.textContent='Введите не меньше двух символов.';return}
  searchTimer=setTimeout(()=>{
    searchStatus.textContent='Ищем…';
    if(!searchIndex)searchResults.innerHTML='<div class="search-skeleton">'+'<div></div>'.repeat(6)+'</div>';
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
const searchPanel=searchOverlay?.querySelector('.search-panel');
const backgroundLayers=()=>[document.querySelector('.topbar'),document.querySelector('.page-layout')].filter(Boolean);
const closeSearch=()=>{
  if(!searchOverlay||searchOverlay.hidden)return;
  searchOverlay.classList.remove('is-open');
  searchPanel.classList.remove('is-open');
  searchPanel.classList.add('is-closing');
  setTimeout(()=>{searchPanel.classList.remove('is-closing');searchOverlay.hidden=true},motionMs('--modal-close-dur',150));
  backgroundLayers().forEach(layer=>{layer.inert=false});
  searchReturnFocus?.focus?.();
};
const openSearch=()=>{
  if(!searchOverlay||!searchOverlay.hidden)return;
  searchReturnFocus=document.activeElement;
  searchOverlay.hidden=false;
  backgroundLayers().forEach(layer=>{layer.inert=true});
  requestAnimationFrame(()=>{searchOverlay.classList.add('is-open');searchPanel.classList.add('is-open')});
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
/* Страница маршрута: чек-лист, календарь и резервная копия. Все отметки
   выводятся из фактического прогресса — интерфейса, который проставляет дату,
   здесь нет. */
const BACKUP_KEYS=['server-infrastructure-selfstudy-v6','server-infrastructure-place-v1','server-infrastructure-chapter-trainers-v1','server-infrastructure-recall-v1','server-infrastructure-timeline-v1','server-infrastructure-reader-v1','server-infrastructure-reading-v1','server-infrastructure-theme','server-infrastructure-quiz-a1-v1'];
const routeBoard=document.querySelector('[data-route-board]');
if(routeBoard){
  const MONTHS=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  const readJSON=key=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};
  const humanDate=iso=>{const [y,m,d]=iso.split('-').map(Number);return d+' '+MONTHS[m-1].slice(0,3)+' '+y};
  const events=readTimeline().events;
  const quick=readJSON('server-infrastructure-chapter-trainers-v1')||{};
  const study=readJSON('server-infrastructure-selfstudy-v6');
  const rows=[...routeBoard.querySelectorAll('[data-route-row]')];
  let doneChapters=0,doneModules=0,totalModules=0;
  for(const row of rows){
    const number=Number(row.dataset.routeRow),modules=row.dataset.own?row.dataset.own.split(',').map(Number):[];
    const chapterMark=row.querySelector('[data-route-cell=chapter] .route-mark');
    const stamped=events['chapter:'+number];
    const attempts=Object.entries(quick).filter(([id])=>id.startsWith('Q'+String(number).padStart(2,'0')+'-'));
    if(stamped){chapterMark.textContent=humanDate(stamped);chapterMark.dataset.routeState='done';doneChapters++}
    else if(attempts.length){chapterMark.textContent='в работе';chapterMark.dataset.routeState='partial'}
    const moduleMark=row.querySelector('[data-route-cell=module] .route-mark');
    if(!moduleMark)continue;
    const dates=modules.map(module=>events['module:'+module]).filter(Boolean);
    totalModules+=modules.length;doneModules+=dates.length;
    if(dates.length===modules.length&&modules.length){moduleMark.textContent=humanDate(dates.sort().at(-1));moduleMark.dataset.routeState='done'}
    else if(dates.length){moduleMark.textContent=dates.length+' из '+modules.length;moduleMark.dataset.routeState='partial'}
    if(stamped&&dates.length===modules.length&&modules.length)row.dataset.routeDone='all';
  }
  const summary=routeBoard.querySelector('[data-route-summary]');
  if(summary&&(doneChapters||doneModules))summary.textContent='Глав закреплено: '+doneChapters+' из '+rows.length+' · модулей сдано: '+doneModules+' из '+totalModules+(study?'':' · кабинет ещё не открывали');
  /* Календарь: только вывод. Показываем месяцы от первой отметки до текущего. */
  const calendar=document.querySelector('[data-route-calendar]'),monthsBox=calendar?.querySelector('[data-route-months]'),log=calendar?.querySelector('[data-route-log]');
  if(monthsBox&&log){
    const names={};for(let lesson=1;lesson<=${lessons.length};lesson+=1)names['chapter:s'+lesson]='Урок '+lesson+' закреплён';document.querySelectorAll('[data-route-row]').forEach(row=>{names['chapter:'+row.dataset.routeRow]='Глава '+String(row.dataset.routeRow).padStart(2,'0')+' закреплена';row.dataset.own.split(',').filter(Boolean).forEach(module=>{names['module:'+module]='Модуль U'+String(module).padStart(2,'0')+' сдан'})});
    const byDay=new Map();
    for(const [key,date] of Object.entries(events)){if(!byDay.has(date))byDay.set(date,[]);byDay.get(date).push(names[key]||key)}
    const days=[...byDay.keys()].sort();
    if(!days.length){monthsBox.innerHTML='<p class="route-empty">Отметок пока нет. Первая появится, когда мини-тренажёр главы будет решён полностью.</p>';}
    else{
      const first=new Date(days[0]+'T00:00:00'),last=new Date();
      const cells=[];let cursor=new Date(first.getFullYear(),first.getMonth(),1);
      const limit=new Date(last.getFullYear(),last.getMonth(),1);
      while(cursor<=limit&&cells.length<24){cells.push(new Date(cursor));cursor.setMonth(cursor.getMonth()+1)}
      monthsBox.innerHTML=cells.map(month=>{
        const year=month.getFullYear(),index=month.getMonth();
        const total=new Date(year,index+1,0).getDate(),shift=(new Date(year,index,1).getDay()+6)%7;
        const head=['пн','вт','ср','чт','пт','сб','вс'].map(day=>'<span class="is-head">'+day+'</span>').join('');
        const blanks='<span class="is-empty"></span>'.repeat(shift);
        const body=Array.from({length:total},(_,i)=>{
          const day=i+1,iso=year+'-'+String(index+1).padStart(2,'0')+'-'+String(day).padStart(2,'0'),list=byDay.get(iso);
          const weekend=[5,6].includes((shift+i)%7);
          return '<span class="'+(list?'has-events':weekend?'is-weekend':'')+'"'+(list?' title="'+list.join('; ').replace(/"/g,'')+'"':'')+'>'+day+'</span>';
        }).join('');
        return '<div class="route-month"><h3>'+MONTHS[index]+' '+year+'</h3><div class="route-grid">'+head+blanks+body+'</div></div>';
      }).join('');
      log.replaceChildren(...days.slice().reverse().map(date=>{
        const item=document.createElement('li'),time=document.createElement('time');
        time.dateTime=date;time.textContent=humanDate(date);
        const text=document.createElement('p');text.textContent=byDay.get(date).join(', ');
        item.append(time,text);return item;
      }));
    }
  }
  /* Резервная копия: один файл на всё локальное состояние учебника. */
  const backupStatus=document.querySelector('[data-backup-status]');
  const say=text=>{if(backupStatus)backupStatus.textContent=text};
  document.querySelector('[data-backup-save]')?.addEventListener('click',()=>{
    const data={};let kept=0;
    for(const key of BACKUP_KEYS){const value=localStorage.getItem(key);if(value!==null){data[key]=value;kept++}}
    const file=JSON.stringify({schema:'course-backup',version:1,exportedAt:new Date().toISOString(),data},null,2);
    const url=URL.createObjectURL(new Blob([file],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='course-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    say(kept?'Сохранено разделов состояния: '+kept+'. Держите файл вне этого браузера.':'Сохранять нечего: прогресса в этом браузере пока нет.');
  });
  document.querySelector('[data-backup-load]')?.addEventListener('change',async event=>{
    const input=event.target,file=input.files?.[0];
    if(!file)return;
    try{
      if(file.size>10*1024*1024)throw new Error('файл больше допустимых 10 MiB');
      const parsed=JSON.parse(await file.text());
      if(parsed?.schema!=='course-backup'||!parsed.data||typeof parsed.data!=='object')throw new Error('это не резервная копия учебника');
      const keys=Object.keys(parsed.data).filter(key=>BACKUP_KEYS.includes(key));
      if(!keys.length)throw new Error('в файле нет известных разделов состояния');
      for(const key of keys)if(typeof parsed.data[key]!=='string')throw new Error('раздел '+key+' повреждён');
      if(!confirm('Заменить прогресс в этом браузере данными из файла? Разделов: '+keys.length+'. Текущий прогресс будет потерян — сохраните его копию заранее.'))return;
      for(const key of keys)localStorage.setItem(key,parsed.data[key]);
      say('Загружено разделов: '+keys.length+'. Обновляем страницу…');
      setTimeout(()=>location.reload(),400);
    }catch(error){say('Загрузить не удалось: '+error.message+'.')}
    finally{input.value=''}
  });
}
/* Навигация по разделам страницы: на широком экране список раскрыт всегда,
   на узком остаётся свёрнутым, чтобы не отодвигать текст. Текущий раздел
   подсвечивается по мере прокрутки. */
const sectionRail=document.querySelector('[data-section-rail]'),sectionDetails=sectionRail?.querySelector('[data-section-details]');
if(sectionRail&&sectionDetails){
  const wide=matchMedia('(min-width: 1240px)');
  const syncRail=()=>{sectionDetails.open=wide.matches};
  syncRail();
  wide.addEventListener('change',syncRail);
  const links=new Map([...sectionRail.querySelectorAll('[data-section-link]')].map(a=>[decodeURIComponent(a.getAttribute('href').slice(1)),a]));
  sectionRail.addEventListener('click',event=>{if(event.target.closest('a')&&!wide.matches)sectionDetails.open=false});
  const targets=[...links.keys()].map(id=>document.getElementById(id)).filter(Boolean);
  if(targets.length&&'IntersectionObserver'in window){
    let current=null;
    const mark=id=>{if(id===current)return;links.get(current)?.removeAttribute('aria-current');const next=links.get(id);if(!next)return;next.setAttribute('aria-current','true');current=id;if(wide.matches){const box=sectionRail.getBoundingClientRect(),item=next.getBoundingClientRect();if(item.top<box.top||item.bottom>box.bottom)next.scrollIntoView({block:'nearest'})}};
    const seen=new Set();
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){if(entry.isIntersecting)seen.add(entry.target.id);else seen.delete(entry.target.id)}
      const visible=targets.filter(target=>seen.has(target.id));
      if(visible.length)mark(visible[0].id);
      else{const above=targets.filter(target=>target.getBoundingClientRect().top<120);if(above.length)mark(above[above.length-1].id)}
    },{rootMargin:'-88px 0px -70% 0px',threshold:0});
    targets.forEach(target=>observer.observe(target));
  }
}
/* Индикатор прочитанного: доля прокрученного основного текста. */
const readProgress=document.querySelector('[data-read-progress]'),readMain=document.querySelector('.page-main');
if(readProgress&&readMain){
  let progressPending=false;
  const drawProgress=()=>{
    progressPending=false;
    const start=readMain.offsetTop,height=readMain.offsetHeight-innerHeight;
    const done=height>60?Math.min(1,Math.max(0,(scrollY-start)/height)):0;
    readProgress.style.transform='scaleX('+done.toFixed(4)+')';
  };
  addEventListener('scroll',()=>{if(!progressPending){progressPending=true;requestAnimationFrame(drawProgress)}},{passive:true});
  addEventListener('resize',drawProgress,{passive:true});
  drawProgress();
}

/* Работа без сети: обслуживающий скрипт регистрируется тихо. Если браузер его
   не поддерживает или страница открыта не по http(s), сайт работает как прежде. */
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))addEventListener('load',()=>{navigator.serviceWorker.register('${BASE}/sw.js').catch(()=>{})});
const offlineSave=document.querySelector('[data-offline-save]'),offlineStatus=document.querySelector('[data-offline-status]');
if(offlineSave&&offlineStatus){
  if(!('serviceWorker' in navigator)){offlineSave.disabled=true;offlineStatus.textContent='Этот браузер не умеет хранить страницы для работы без сети.'}
  else{
    navigator.serviceWorker.addEventListener('message',event=>{
      const data=event.data||{};
      if(data.type==='save-progress')offlineStatus.textContent='Сохранено '+data.done+' из '+data.total+'…';
      if(data.type==='save-done'){offlineSave.disabled=false;offlineStatus.textContent=data.failed?('Сохранено, но '+data.failed+' файлов скачать не удалось. Повторите при устойчивой связи.'):('Готово: '+data.total+' файлов в памяти браузера — все страницы курса и поиск по ним. Учебник открывается без сети.')}
    });
    offlineSave.addEventListener('click',async()=>{
      offlineSave.disabled=true;offlineStatus.textContent='Сохраняем…';
      const registration=await navigator.serviceWorker.ready.catch(()=>null);
      if(!registration||!registration.active){offlineStatus.textContent='Хранилище ещё готовится. Обновите страницу и повторите.';offlineSave.disabled=false;return}
      registration.active.postMessage({type:'save-all'});
    });
  }
}

/* Место чтения. Курс на 123 000 слов читают месяцами, и до сих пор не было
   единственного, что нужно после перерыва: вернуться туда, где остановился.
   Хранится одна запись — адрес, заголовок страницы, ближайший раздел и доля
   прочитанного; пишется не чаще раза в секунду и при уходе со страницы. */
const PLACE_KEY='server-infrastructure-place-v1';
const placeMain=document.querySelector('.chapter-prose');
if(placeMain){
  const pageTitle=document.querySelector('.prose h1')?.textContent.trim()||document.title.split(' · ')[0];
  const marks=[...document.querySelectorAll('.chapter-prose h2[id]')];
  let placeSaved=0;
  const savePlace=()=>{
    placeSaved=Date.now();
    const top=scrollY+120;
    let near=null;for(const mark of marks){if(mark.offsetTop<=top)near=mark;else break}
    const height=placeMain.offsetHeight-innerHeight;
    const done=height>60?Math.min(1,Math.max(0,(scrollY-placeMain.offsetTop)/height)):0;
    const place={u:location.pathname,t:pageTitle,h:near?near.textContent.trim():'',a:near?near.id:'',p:Math.round(done*100),d:new Date().toISOString().slice(0,10)};
    try{localStorage.setItem(PLACE_KEY,JSON.stringify(place))}catch{}
  };
  addEventListener('scroll',()=>{if(Date.now()-placeSaved>1000)savePlace()},{passive:true});
  addEventListener('pagehide',savePlace);
  savePlace();
}
const resumeLine=document.querySelector('[data-resume-line]');
if(resumeLine){
  let place=null;try{place=JSON.parse(localStorage.getItem(PLACE_KEY)||'null')}catch{}
  // Адрес берём только свой: чужая строка в хранилище не должна становиться ссылкой.
  if(place&&typeof place.u==='string'&&place.u.length<80&&place.u.startsWith('/')&&place.u.endsWith('/')&&!place.u.includes('//')&&!place.u.includes('..')){
    const link=resumeLine.querySelector('[data-resume-link]');
    link.setAttribute('href',place.u+(place.a?'#'+encodeURIComponent(place.a):''));
    const short=text=>{const value=String(text).replace(/^(?:[0-9]+(?:[.][0-9]+)*[.]|Урок [0-9]+[.])[ ]*/,'');return value.length>54?value.slice(0,53).trimEnd()+'…':value};
    link.textContent=short(place.t)+(place.h?' · '+short(place.h):'');
    resumeLine.querySelector('[data-resume-note]').textContent=place.p>0?'прочитано '+place.p+'%':'начато';
    resumeLine.hidden=false;
  }
}

/* Размер текста: три ступени, выбор сохраняется в этом браузере. */
const READ_KEY='server-infrastructure-reading-v1';
const readSizes={s:'15.5px',m:'17px',l:'19px'},readMeasures={s:'76ch',m:'74ch',l:'70ch'};
const readGroup=document.querySelector('[data-read-size-group]');
if(readGroup&&document.querySelector('.prose')){
  readGroup.hidden=false;
  const applyReadSize=step=>{
    const size=readSizes[step]?step:'m';
    document.documentElement.style.setProperty('--reading-size',readSizes[size]);
    document.documentElement.style.setProperty('--reading-measure',readMeasures[size]);
    readGroup.querySelectorAll('[data-read-size]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.readSize===size)));
  };
  let saved='m';
  try{saved=localStorage.getItem(READ_KEY)||'m'}catch{}
  applyReadSize(saved);
  readGroup.addEventListener('click',event=>{
    const button=event.target.closest('[data-read-size]');
    if(!button)return;
    applyReadSize(button.dataset.readSize);
    try{localStorage.setItem(READ_KEY,button.dataset.readSize)}catch{}
  });
}

/* Ступенчатое появление шапки страницы — по одному смысловому блоку. */
const staggerHost=document.querySelector('.page-main');
if(staggerHost){
  const lines=[staggerHost.querySelector(':scope > .eyebrow'),staggerHost.querySelector('h1'),staggerHost.querySelector('h1 + p, .chapter-lead, .catalog-head > p, .tool-intro > p')].filter(Boolean);
  if(lines.length){
    staggerHost.classList.add('t-stagger');
    lines.forEach((line,order)=>{line.classList.add('t-stagger-line');line.style.transitionDelay=(order*40)+'ms'});
    requestAnimationFrame(()=>staggerHost.classList.add('is-shown'));
  }
}

/* Раскрывающиеся блоки учебника: высота через grid-rows, шеврон переворачивается. */
const chevron='<span class="t-acc-chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
document.querySelectorAll('.prose details').forEach(details=>{
  const summary=details.querySelector('summary');
  if(!summary)return;
  const panel=document.createElement('div');
  panel.className='t-acc-panel';
  const inner=document.createElement('div');
  inner.className='t-acc-panel-inner';
  while(summary.nextSibling)inner.append(summary.nextSibling);
  panel.append(inner);
  details.append(panel);
  details.classList.add('t-acc');
  summary.insertAdjacentHTML('afterbegin',chevron);
  details.dataset.open=String(details.open);
  summary.addEventListener('click',event=>{
    event.preventDefault();
    if(details.open){
      details.dataset.open='false';
      setTimeout(()=>{details.open=false},motionMs('--acc-collapse',250));
    }else{
      details.open=true;
      requestAnimationFrame(()=>{details.dataset.open='true'});
    }
  });
});

const search=document.querySelector('[data-course-search]');if(search)search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();document.querySelectorAll('[data-course-card]').forEach(card=>card.hidden=q&&!card.dataset.courseCard.includes(q));document.querySelectorAll('[data-course-group]').forEach(group=>group.hidden=![...group.querySelectorAll('[data-course-card]')].some(card=>!card.hidden));});
const context=document.modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}};
register({name:'get_course_progress',title:'Показать прогресс курса',description:'Возвращает краткий прогресс самостоятельного обучения в этом браузере.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>({answeredChecks:Object.keys(records).length,correctChecks:progressTotals.correct,programmingTestsPassed:Number(state?.practice?.passed||0),bestFinalExam:progressTotals.best})});
register({name:'open_course_module',title:'Открыть модуль курса',description:'Переходит на отдельную страницу одной из 34 глав курса.',inputSchema:{type:'object',properties:{module:{type:'integer',minimum:0,maximum:33}},required:['module'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:input=>{const n=input?.module;if(!Number.isInteger(n)||n<0||n>33)throw Error('Номер модуля должен быть целым числом от 0 до 33.');location.href='${BASE}/chapters/'+String(n).padStart(2,'0')+'/';return{openedModule:n};}});
})();`;

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'assets'), { recursive: true });
await Promise.all([
  writeFile(resolve(output, 'index.html'), finishPage(home, '/')),
  writeFile(resolve(output, 'curriculum', 'index.html'), finishPage(curriculum, '/curriculum/')).catch(async () => { await mkdir(resolve(output, 'curriculum'), { recursive: true }); await writeFile(resolve(output, 'curriculum', 'index.html'), finishPage(curriculum, '/curriculum/')); }),
  writeFile(resolve(output, 'assets', 'site.css'), css),
  writeFile(resolve(output, 'assets', 'site.js'), js),
  cp(resolve(root, 'public', 'favicon.svg'), resolve(output, 'assets', 'favicon.svg')),
]);

const outputs = [
  ...lessons.map((item) => [item.url, lessonPage(item)]),
  ...chapters.map((item) => [item.url, chapterPage(item)]),
  ['/about/', about], ['/route/', route], ['/assessment/', assessment], ['/assessment/a1/', a1], ['/reference/', reference], ['/reference/archive/', archive],
];
for (const [url, html] of outputs) {
  const file = resolve(output, url.slice(1), 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, finishPage(html, url));
}

// ---------- Индекс полнотекстового поиска ----------
// Единица поиска — раздел, а не страница: результат ведёт сразу к нужному месту главы.
// Индекс собирается из готовых страниц, поэтому он не может разойтись с тем, что читает
// читатель. Мини-тренажёр из индекса исключён: его вопросы — не текст учебника.
const searchDocuments = [];
const indexPage = (url, html) => {
  const title = strip(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? url).replace(/\s*·\s*Серверная инфраструктура$/, '');
  const mainMatch = html.match(/<main class="page-main"[^>]*>([\s\S]*)<\/main>/);
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
  // strip() подставляет пробел вместо тега, поэтому «текст <em>ссылки</em>.» превращается
  // в «текст ссылки .» — в выдержке это выглядит как опечатка, чиним при сборке индекса.
  const readable = (html) => decode(strip(html)).replace(/\s+([,.;:!?»…])/g, '$1').replace(/([«(])\s+/g, '$1').replace(/\s+/g, ' ').trim();
  for (const block of blocks) {
    const text = readable(block.body);
    if (text.length < 40) continue;
    const heading = readable(block.heading);
    searchDocuments.push([url, title, block.anchor, heading, text]);
  }
  // Страница целиком из интерактивных блоков (тренажёр A1) не даёт ни одного раздела —
  // она всё равно должна находиться по названию, иначе маршрут выпадает из поиска.
  if (searchDocuments.length === before) searchDocuments.push([url, title, '', title, readable(main)]);
};
indexPage('/', home);
indexPage('/curriculum/', curriculum);
for (const [url, html] of outputs) indexPage(url, html);
if (searchDocuments.length < 400) throw new Error(`Search index too small: ${searchDocuments.length} sections`);
// Адрес и заголовок страницы повторялись в каждом из 1567 разделов: страница
// вынесена в отдельную таблицу, раздел стал массивом вместо объекта с ключами.
// Текст раздела не режется — поиск полнотекстовый, и обрезка стоила бы находок.
const searchPages = [];
const searchPageIndex = new Map();
const searchRows = searchDocuments.map(([url, title, anchor, heading, text]) => {
  const key = url + '\u0000' + title;
  if (!searchPageIndex.has(key)) { searchPageIndex.set(key, searchPages.length); searchPages.push([url, title]); }
  return [searchPageIndex.get(key), anchor, heading, text];
});
await writeFile(resolve(output, 'assets', 'search.json'), JSON.stringify({ v: 2, p: searchPages, s: searchRows }));

// ---------- Работа без сети ----------
// Книга обещает, что интернет нужен только для внешних ссылок, а сайт этого не
// давал: при обрыве связи открывалась только уже загруженная вкладка, и индекс
// поиска в 1,6 МБ скачивался заново в каждой новой сессии. Обслуживающий скрипт
// отдаёт из кэша и обновляет в фоне, а кнопка на «Маршруте» кладёт в память все
// страницы сразу. Версия кэша считается по исходнику и собранным файлам: новая
// публикация обязана вытеснить старую копию, иначе читатель останется на ней.
const routeList = ['/', '/curriculum/', ...outputs.map(([url]) => url)].map((url) => `${BASE}${url}`);
const buildId = sha256(source + css + js).slice(0, 12);
const serviceWorker = `/* Собирается build-static.mjs. Правьте генератор, а не этот файл. */
const VERSION='${buildId}';
const CACHE='course-'+VERSION;
const ROUTES=${JSON.stringify(routeList)};
const SHELL=['${BASE}/assets/site.css','${BASE}/assets/site.js','${BASE}/assets/favicon.svg','${BASE}/'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()).catch(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
/* Отдаём копию сразу и обновляем её в фоне: страница открывается мгновенно и
   без сети, а следующее открытие уже получает свежую версию. */
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(request,{ignoreSearch:true});
    const network=fetch(request).then(response=>{
      if(response&&response.ok&&response.type==='basic')cache.put(request,response.clone()).catch(()=>{});
      return response;
    }).catch(()=>null);
    if(cached){event.waitUntil(network);return cached}
    const response=await network;
    return response||new Response('Нет сети, и копии этой страницы в памяти браузера тоже нет.',{status:504,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());
});
/* Сохранение всего учебника по кнопке: скачиваем по одному адресу и говорим
   странице, сколько уже готово, — иначе кнопка на несколько мегабайт молчит. */
self.addEventListener('message',event=>{
  if(event.data&&event.data.type==='save-all'){
    const client=event.source;
    event.waitUntil((async()=>{
      const cache=await caches.open(CACHE);
      const all=[...ROUTES,'${BASE}/assets/search.json',...SHELL];
      let done=0,failed=0;
      for(const address of all){
        try{const response=await fetch(address,{cache:'reload'});if(response.ok)await cache.put(address,response.clone());else failed+=1}catch{failed+=1}
        done+=1;
        if(client)client.postMessage({type:'save-progress',done,total:all.length});
      }
      if(client)client.postMessage({type:'save-done',total:all.length,failed});
    })());
  }
});
`;
await writeFile(resolve(output, 'sw.js'), serviceWorker);

// Карта сайта и robots: без них поисковик обходит 47 страниц наугад, а часть
// маршрутов (например работы практикума за параметром) не находит вовсе.
// Карта требует абсолютных адресов, поэтому выпускается только при SITE_URL.
if (SITE) {
  const urls = ['/', '/curriculum/', ...outputs.map(([url]) => url)]
    .map((url) => `  <url><loc>${SITE}${url}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>`)
    .join('\n');
  await writeFile(resolve(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}
await writeFile(resolve(output, 'robots.txt'), `User-agent: *\nAllow: /\n${SITE ? `Sitemap: ${SITE}/sitemap.xml\n` : ''}`);

const htmlFiles = ['index.html', 'curriculum/index.html', ...outputs.map(([url]) => `${url.slice(1)}index.html`)];
for (const relative of htmlFiles) {
  const html = await readFile(resolve(output, relative), 'utf8');
  if (!html.includes('<title>') || !html.includes('/assets/site.css')) throw new Error(`Invalid generated page: ${relative}`);
}
const manifest = { generatedAt: new Date().toISOString(), sourceSha256: sha256(source), routes: htmlFiles.length, chapters: chapters.length, labs: labs.length };
await writeFile(resolve(output, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Multipage site built: ${htmlFiles.length} routes, ${chapters.length} chapters, ${labs.length} lab modules.`);
