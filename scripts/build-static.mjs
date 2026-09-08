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
const followingScript = (id) => {
  const element = scriptElement(id);
  const from = source.indexOf(element) + element.length;
  const start = source.indexOf('<script>', from);
  const end = source.indexOf('</script>', start);
  return source.slice(start, end + 9);
};

const chapterStarts = Array.from({ length: 28 }, (_, number) => marker(`b${pad(number)}`));
const frontStart = marker('title');
const appendicesStart = marker('b27-s044');
const selftestStart = marker('selftest');
const studyAppStart = marker('study-app');
const assessmentStart = marker('assessment');
const labsStart = marker('labs');
const assessmentReferenceStart = marker('assessment-reference');
const mainEnd = source.lastIndexOf('</main>');

const chapters = chapterStarts.map((start, number) => {
  const end = number === 27 ? appendicesStart : chapterStarts[number + 1];
  const content = source.slice(start, end);
  const titleMatch = content.match(/^<h1[^>]*>(.*?)<\/h1>/s);
  if (!titleMatch) throw new Error(`Missing title for chapter ${number}`);
  return { number, title: strip(titleMatch[1]), content, url: `/chapters/${pad(number)}/` };
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
  ...chapters.map((item) => ({ url: item.url, content: item.content })),
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
    <section class="selection-card" aria-labelledby="selection-title"><h3 id="selection-title">Выбранный фрагмент</h3><p class="selection-preview" data-selection-preview>Выделите текст в учебнике, чтобы скопировать, сохранить или отметить его цветом.</p><div class="selection-actions"><button type="button" data-copy-selection disabled>Копировать</button><button type="button" data-save-quote disabled>Сохранить цитату</button></div><div class="highlight-palette" role="group" aria-label="Цвет маркера"><button type="button" class="color-dot yellow" data-highlight-color="yellow" disabled aria-label="Выделить жёлтым"></button><button type="button" class="color-dot green" data-highlight-color="green" disabled aria-label="Выделить зелёным"></button><button type="button" class="color-dot blue" data-highlight-color="blue" disabled aria-label="Выделить синим"></button><button type="button" class="color-dot pink" data-highlight-color="pink" disabled aria-label="Выделить розовым"></button></div></section>
    <section class="note-composer"><label for="reader-note">Новая заметка</label><textarea id="reader-note" data-note-input rows="4" placeholder="Запишите вывод, вопрос или идею…"></textarea><button type="button" class="button primary" data-add-note>Сохранить заметку</button></section>
    <section class="notes-library" aria-labelledby="library-title"><div class="notes-library-head"><h3 id="library-title">Сохранённое <span data-notes-count>0</span></h3><button type="button" class="text-button" data-copy-all disabled>Копировать всё</button></div><div class="notes-list" data-notes-list><p class="notes-empty">Здесь появятся ваши заметки, цитаты и цветные выделения.</p></div></section>
  </aside>
  <button type="button" class="notes-backdrop" data-notes-close aria-label="Закрыть панель заметок" hidden></button>
  <div class="selection-toolbar" data-selection-toolbar hidden role="toolbar" aria-label="Действия с выделенным текстом"><button type="button" data-copy-selection title="Копировать выделенный текст">Копировать</button><button type="button" data-save-quote title="Сохранить цитату">В цитаты</button><span aria-hidden="true"></span><button type="button" class="color-dot yellow" data-highlight-color="yellow" aria-label="Выделить жёлтым"></button><button type="button" class="color-dot green" data-highlight-color="green" aria-label="Выделить зелёным"></button><button type="button" class="color-dot blue" data-highlight-color="blue" aria-label="Выделить синим"></button><button type="button" class="color-dot pink" data-highlight-color="pink" aria-label="Выделить розовым"></button></div>
  <div class="reader-toast" data-reader-toast role="status" aria-live="polite"></div>`;

const pageShell = ({ title, eyebrow, body, sidebar = '', className = '', description = title }) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escape(description)}"><meta name="theme-color" content="#081a24"><script>try{const saved=localStorage.getItem('server-infrastructure-theme');document.documentElement.dataset.theme=saved||((matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light')}catch{document.documentElement.dataset.theme='light'}</script><title>${escape(title)} · Серверная инфраструктура</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css"></head>
<body><header class="topbar">${globalNav}<button class="theme-toggle" type="button" data-theme-toggle aria-pressed="false"><span aria-hidden="true" data-theme-icon>◐</span><span data-theme-label>Тёмная тема</span></button><button class="notes-toggle" type="button" data-notes-toggle aria-expanded="false"><span aria-hidden="true">✎</span><span>Заметки</span><strong data-notes-badge hidden>0</strong></button><details class="mobile-menu"><summary>Разделы</summary><div>${globalNav}</div></details></header>
<div class="page-layout ${className}">${sidebar ? `<aside class="side-nav">${sidebar}</aside>` : ''}<main class="page-main"><p class="eyebrow">${escape(eyebrow)}</p>${body}</main></div>
${readerTools}<script src="/assets/site.js"></script></body></html>`;

const localToc = (content) => Array.from(content.matchAll(/<h([23])[^>]*id="([^"]+)"[^>]*>(.*?)<\/h\1>/gs))
  .slice(0, 18)
  .map((match) => `<a class="local-${match[1]}" href="#${match[2]}">${escape(strip(match[3]))}</a>`).join('');

const chapterPage = (chapter) => {
  const previous = chapters[chapter.number - 1];
  const next = chapters[chapter.number + 1];
  const pager = `<nav class="pager" aria-label="Переход между главами">${previous ? `<a href="${previous.url}">← Глава ${pad(previous.number)}</a>` : '<span></span>'}<a class="assessment-link" href="/assessment/?module=${chapter.number}">Проверить знания</a>${next ? `<a href="${next.url}">Глава ${pad(next.number)} →</a>` : '<span></span>'}</nav>`;
  const sidebar = `<a class="back-link" href="/curriculum/">← Вся программа</a><div class="sidebar-scroll">${curriculumLinks(chapter.number)}</div>`;
  const body = `<article class="prose chapter-prose">${rewriteLinks(chapter.content, chapter.url)}</article>${pager}`;
  return pageShell({ title: chapter.title, eyebrow: `Глава ${pad(chapter.number)} · университетский курс`, body, sidebar, className: 'with-sidebar' });
};

const labPage = (lab) => {
  const previous = labs[lab.number - 1];
  const next = labs[lab.number + 1];
  const pager = `<nav class="pager"><a href="/chapters/${pad(lab.number)}/">Теория модуля</a>${previous ? `<a href="${previous.url}">← L${pad(previous.number)}</a>` : '<span></span>'}${next ? `<a href="${next.url}">L${pad(next.number)} →</a>` : '<span></span>'}</nav>`;
  const sidebar = `<a class="back-link" href="/curriculum/">← Вся программа</a><p class="side-title">Практикум</p>${labs.map((item) => `<a ${item.number === lab.number ? 'aria-current="page"' : ''} href="${item.url}"><span>L${pad(item.number)}</span>${escape(item.title.replace(/^L\d+[A-Z/]?\.\s*/, ''))}</a>`).join('')}`;
  return pageShell({ title: lab.title, eyebrow: `Практикум · модуль ${pad(lab.number)}`, body: `<article class="prose">${rewriteLinks(lab.content, lab.url)}</article>${pager}`, sidebar, className: 'with-sidebar' });
};

const homeCards = parts.map(([label, title, numbers]) => `<a class="part-card" href="${chapters[numbers[0]].url}"><span>${label}</span><h2>${title}</h2><p>${numbers.length} ${numbers.length === 1 ? 'модуль' : 'модулей'} · ${numbers.map((number) => pad(number)).join(' · ')}</p></a>`).join('');
const home = pageShell({
  title: 'Университетский курс', eyebrow: 'Самостоятельное обучение', className: 'landing',
  body: `<section class="hero"><div><h1>Серверная инфраструктура<br><em>от сигнала до системы</em></h1><p>Полный маршрут для самостоятельной подготовки: Linux, сети, серверное железо, хранение данных, автоматизация, контейнеры и firmware.</p><div class="hero-actions"><a class="button primary" href="/curriculum/">Открыть программу</a><a class="button" href="/assessment/">Продолжить обучение</a></div></div><div class="hero-stats"><div><strong>28</strong><span>глав</span></div><div><strong>196</strong><span>автопроверок</span></div><div><strong>56</strong><span>полевых работ</span></div><div><strong>28</strong><span>Python-тестов</span></div></div></section><section class="progress-card"><div><p class="eyebrow">Ваш прогресс</p><strong data-progress-title>Маршрут ещё не начат</strong><p data-progress-copy>Результаты сохраняются только в этом браузере.</p></div><a href="/assessment/">Открыть кабинет →</a></section><section class="section-head"><div><p class="eyebrow">Маршрут</p><h2>Девять последовательных частей</h2></div><a href="/curriculum/">Все главы →</a></section><div class="part-grid">${homeCards}</div>`,
  description: 'Многостраничный университетский курс по серверной инфраструктуре для самостоятельного обучения.',
});

const curriculum = pageShell({
  title: 'Программа курса', eyebrow: '28 глав · 9 частей', className: 'catalog',
  body: `<header class="catalog-head"><h1>Программа курса</h1><p>Идите последовательно или выберите нужную область. Каждая глава содержит теорию, разобранные примеры, лабораторию, break/fix и автоматическую проверку.</p><label class="search"><span>Поиск по программе</span><input type="search" placeholder="Например: NUMA, Ceph, systemd" data-course-search></label></header>${parts.map(([label, title, numbers]) => `<section class="catalog-part" data-course-group><div><p>${label}</p><h2>${title}</h2></div><div class="chapter-grid">${numbers.map((number) => { const item = chapters[number]; return `<a class="chapter-card" data-course-card="${escape(item.title.toLowerCase())}" href="${item.url}"><span>${pad(number)}</span><h3>${escape(item.title.replace(/^\d+\.\s*/, ''))}</h3><p>Теория · пример · лаборатория · проверка</p></a>`; }).join('')}</div></section>`).join('')}`,
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
/* Reader notebook */
.notes-toggle{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid #ffffff35;background:#ffffff0b;color:white;font:600 12px/1.2 inherit;cursor:pointer;white-space:nowrap}.notes-toggle:hover{border-color:var(--teal2);background:#ffffff14}.notes-toggle:focus-visible{outline:2px solid var(--teal2);outline-offset:3px}.notes-toggle strong{min-width:18px;padding:2px 5px;border-radius:10px;background:var(--teal);color:#06151d;font-size:10px;text-align:center}.notes-panel{position:fixed;z-index:50;top:68px;right:0;bottom:0;width:min(410px,100vw);padding:24px;background:var(--white);color:var(--ink);border-left:1px solid var(--line);box-shadow:-18px 0 48px #0005;overflow:auto;transform:translateX(105%);visibility:hidden;transition:transform .22s ease,visibility .22s}.notes-panel.is-open{transform:translateX(0);visibility:visible}.notes-backdrop{position:fixed;z-index:45;inset:68px 0 0;border:0;background:#00101899;cursor:default}.notes-head,.notes-library-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.notes-head h2{margin:3px 0 0;font-family:Georgia,serif;font-size:30px}.icon-button,.text-button{border:0;background:transparent;color:var(--ink);cursor:pointer}.icon-button{font-size:30px;line-height:1;padding:2px 6px}.text-button{padding:4px 0;color:var(--link);font-weight:700}.text-button:disabled{opacity:.45;cursor:not-allowed}.selection-card,.note-composer,.notes-library{margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}.selection-card h3,.notes-library h3{margin:0 0 12px;font-size:15px}.selection-preview{min-height:68px;margin:0 0 12px;padding:12px;background:var(--soft);border:1px solid var(--line);color:var(--muted);font-size:13px;line-height:1.5;white-space:pre-wrap}.selection-actions{display:flex;gap:8px}.selection-actions button,.note-composer button{padding:9px 12px;border:1px solid #63858a;background:var(--white);color:var(--ink);font:inherit;cursor:pointer}.selection-actions button:disabled,.highlight-palette button:disabled{opacity:.38;cursor:not-allowed}.highlight-palette{display:flex;align-items:center;gap:10px;margin-top:13px}.color-dot{width:24px;height:24px;padding:0!important;border:2px solid #26363b!important;border-radius:50%;cursor:pointer;box-shadow:0 0 0 1px #ffffffaa}.color-dot:hover:not(:disabled),.color-dot:focus-visible{transform:scale(1.12);outline:2px solid var(--teal);outline-offset:2px}.color-dot.yellow,.reader-highlight[data-color=yellow]{background:#ffe48c!important}.color-dot.green,.reader-highlight[data-color=green]{background:#a9e6bd!important}.color-dot.blue,.reader-highlight[data-color=blue]{background:#a9d8ff!important}.color-dot.pink,.reader-highlight[data-color=pink]{background:#f7b8cf!important}.reader-highlight{color:#102733;padding:.04em .08em;border-radius:2px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.reader-highlight:target{outline:3px solid var(--teal);outline-offset:3px}.note-composer label{display:block;margin-bottom:8px;font-size:13px;font-weight:800}.note-composer textarea{width:100%;resize:vertical;padding:12px;border:1px solid #63858a;background:var(--paper);color:var(--ink);font:inherit;line-height:1.5}.note-composer .button{margin-top:9px}.notes-library-head{align-items:baseline}.notes-library-head h3 span{display:inline-block;min-width:22px;margin-left:4px;padding:2px 6px;border-radius:12px;background:var(--soft);text-align:center}.notes-list{display:grid;gap:10px}.notes-empty{color:var(--muted);font-size:13px;line-height:1.5}.note-item{padding:13px;border:1px solid var(--line);background:var(--paper)}.note-item-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.note-kind{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--teal)}.note-item p{margin:9px 0;font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.note-item-source{display:block;color:var(--link);font-size:11px;text-decoration:none}.note-item-actions{display:flex;gap:12px;margin-top:10px}.note-item-actions button{padding:0;border:0;background:transparent;color:var(--link);font:700 11px/1.4 inherit;cursor:pointer}.note-item-actions .danger{color:#c45a43}.selection-toolbar{position:fixed;z-index:60;display:flex;align-items:center;gap:6px;padding:8px;background:var(--navy2);border:1px solid #ffffff2b;box-shadow:0 8px 24px #0007;color:white}.selection-toolbar[hidden]{display:none}.selection-toolbar>button:not(.color-dot){padding:7px 9px;border:1px solid #ffffff30;background:#ffffff0e;color:white;font:600 11px/1.2 inherit;cursor:pointer}.selection-toolbar>span{width:1px;height:22px;background:#ffffff38}.selection-toolbar .color-dot{width:20px;height:20px}.reader-toast{position:fixed;z-index:70;right:22px;bottom:22px;max-width:330px;padding:11px 15px;background:var(--navy2);color:white;border:1px solid #ffffff2b;box-shadow:0 8px 24px #0006;font-size:13px;opacity:0;transform:translateY(8px);pointer-events:none;transition:.18s}.reader-toast.is-visible{opacity:1;transform:translateY(0)}
@media(max-width:900px){.topbar{gap:12px}.notes-toggle span:nth-child(2){display:none}.notes-panel{top:68px}.selection-toolbar{left:10px!important;right:10px;bottom:12px;top:auto!important;justify-content:center;flex-wrap:wrap}}@media(max-width:560px){.notes-toggle{padding:8px}.theme-toggle{padding:8px}.notes-panel{padding:19px}.notes-backdrop{display:none}.selection-toolbar>button:not(.color-dot){font-size:10px}}@media print{.notes-toggle,.notes-panel,.notes-backdrop,.selection-toolbar,.reader-toast{display:none!important}.reader-highlight{background:transparent!important;color:inherit;padding:0}}
`;

const js = `(() => {'use strict';
const THEME_KEY='server-infrastructure-theme',themeButton=document.querySelector('[data-theme-toggle]');
const applyTheme=theme=>{document.documentElement.dataset.theme=theme;if(themeButton){const dark=theme==='dark';themeButton.setAttribute('aria-pressed',String(dark));themeButton.querySelector('[data-theme-label]').textContent=dark?'Светлая тема':'Тёмная тема';themeButton.querySelector('[data-theme-icon]').textContent=dark?'☀':'◐';}};
applyTheme(document.documentElement.dataset.theme||'light');themeButton?.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(THEME_KEY,next)}catch{}applyTheme(next);});
const READER_KEY='server-infrastructure-reader-v1',readerPath=location.pathname,readerTitle=document.title.replace(' · Серверная инфраструктура','');
const readerPanel=document.querySelector('[data-notes-panel]'),readerToggle=document.querySelector('[data-notes-toggle]'),readerBackdrop=document.querySelector('.notes-backdrop'),readerPreview=document.querySelector('[data-selection-preview]'),readerList=document.querySelector('[data-notes-list]'),readerInput=document.querySelector('[data-note-input]'),readerToolbar=document.querySelector('[data-selection-toolbar]'),readerToast=document.querySelector('[data-reader-toast]'),readerRoots=[...document.querySelectorAll('.prose')];
const readReader=()=>{try{const data=JSON.parse(localStorage.getItem(READER_KEY)||'null');return{notes:Array.isArray(data?.notes)?data.notes:[],highlights:Array.isArray(data?.highlights)?data.highlights:[]}}catch{return{notes:[],highlights:[]}}};
let readerState=readReader(),activeSelection=null,toastTimer=0;
const saveReader=()=>{try{localStorage.setItem(READER_KEY,JSON.stringify(readerState))}catch{showToast('Не удалось сохранить данные в браузере')}};
const showToast=message=>{if(!readerToast)return;readerToast.textContent=message;readerToast.classList.add('is-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>readerToast.classList.remove('is-visible'),1800)};
const makeId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const escapeText=value=>String(value??'').replace(/[&<>\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
const copyText=async text=>{if(!text)return false;try{await navigator.clipboard.writeText(text)}catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)return false}showToast('Скопировано в буфер обмена');return true};
const openNotes=()=>{readerPanel?.classList.add('is-open');readerPanel?.setAttribute('aria-hidden','false');readerToggle?.setAttribute('aria-expanded','true');if(readerBackdrop)readerBackdrop.hidden=false;if(!activeSelection)setTimeout(()=>readerInput?.focus(),40)};
const closeNotes=()=>{readerPanel?.classList.remove('is-open');readerPanel?.setAttribute('aria-hidden','true');readerToggle?.setAttribute('aria-expanded','false');if(readerBackdrop)readerBackdrop.hidden=true;readerToggle?.focus()};
readerToggle?.addEventListener('click',openNotes);document.querySelectorAll('[data-notes-close]').forEach(button=>button.addEventListener('click',closeNotes));document.addEventListener('keydown',event=>{if(event.key==='Escape'&&readerPanel?.classList.contains('is-open'))closeNotes()});
const removeHighlightMarks=id=>{document.querySelectorAll('[data-reading-highlight]').forEach(mark=>{if(mark.dataset.readingHighlight!==id)return;const parent=mark.parentNode;mark.replaceWith(...mark.childNodes);parent?.normalize()})};
const applyHighlight=record=>{if(record.path!==readerPath)return false;const root=readerRoots[record.rootIndex];if(!root)return false;let start=Number(record.start),end=Number(record.end),full=root.textContent||'';if(full.slice(start,end)!==record.text){start=full.indexOf(record.text);end=start+record.text.length}if(start<0||end<=start)return false;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),segments=[];let position=0,node;while((node=walker.nextNode())){const nodeStart=position,nodeEnd=position+node.data.length;if(nodeEnd>start&&nodeStart<end)segments.push({node,from:Math.max(0,start-nodeStart),to:Math.min(node.data.length,end-nodeStart)});position=nodeEnd}segments.reverse().forEach((segment,index)=>{const range=document.createRange();range.setStart(segment.node,segment.from);range.setEnd(segment.node,segment.to);const mark=document.createElement('mark');mark.className='reader-highlight';mark.dataset.readingHighlight=record.id;mark.dataset.color=record.color;if(index===segments.length-1)mark.id='reader-highlight-'+record.id;range.surroundContents(mark)});return segments.length>0};
readerState.highlights.filter(item=>item.path===readerPath).sort((a,b)=>Number(a.start)-Number(b.start)).forEach(applyHighlight);
const itemLabel=item=>item.kind==='note'?'Заметка':item.kind==='quote'?'Цитата':'Маркер';
const renderReader=()=>{const entries=[...readerState.notes,...readerState.highlights.map(item=>({...item,kind:'highlight'}))].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),count=entries.length;document.querySelectorAll('[data-notes-count]').forEach(node=>node.textContent=String(count));document.querySelectorAll('[data-notes-badge]').forEach(node=>{node.textContent=String(count);node.hidden=!count});document.querySelectorAll('[data-copy-all]').forEach(node=>node.disabled=!count);if(!readerList)return;if(!count){readerList.innerHTML='<p class="notes-empty">Здесь появятся ваши заметки, цитаты и цветные выделения.</p>';return}readerList.innerHTML=entries.map(item=>{const href=item.path+(item.kind==='highlight'?'#reader-highlight-'+item.id:'');return '<article class="note-item"><div class="note-item-head"><span class="note-kind">'+itemLabel(item)+'</span><time datetime="'+escapeText(item.createdAt)+'">'+new Date(item.createdAt).toLocaleDateString('ru-RU')+'</time></div><p>'+escapeText(item.text)+'</p><a class="note-item-source" href="'+escapeText(href)+'">'+escapeText(item.title||item.path)+'</a><div class="note-item-actions"><button type="button" data-copy-item="'+escapeText(item.id)+'" data-item-kind="'+escapeText(item.kind)+'">Копировать</button><button type="button" class="danger" data-delete-item="'+escapeText(item.id)+'" data-item-kind="'+escapeText(item.kind)+'">Удалить</button></div></article>'}).join('')};
renderReader();
const setSelectionControls=enabled=>{document.querySelectorAll('[data-copy-selection],[data-save-quote],[data-highlight-color]').forEach(button=>button.disabled=!enabled)};
const clearSelectionUi=()=>{activeSelection=null;setSelectionControls(false);if(readerPreview)readerPreview.textContent='Выделите текст в учебнике, чтобы скопировать, сохранить или отметить его цветом.';if(readerToolbar)readerToolbar.hidden=true};
const captureSelection=()=>{const selection=getSelection();if(!selection||selection.rangeCount!==1||selection.isCollapsed)return;const range=selection.getRangeAt(0),startElement=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement,endElement=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement,root=startElement?.closest('.prose');if(!root||!root.contains(endElement)||readerPanel?.contains(startElement)||readerToolbar?.contains(startElement))return clearSelectionUi();const before=document.createRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);const text=range.toString();if(!text.trim())return;activeSelection={text,path:readerPath,title:readerTitle,rootIndex:readerRoots.indexOf(root),start:before.toString().length,end:before.toString().length+text.length};setSelectionControls(true);if(readerPreview)readerPreview.textContent=text.length>500?text.slice(0,500)+'…':text;if(readerToolbar){const rect=range.getBoundingClientRect();readerToolbar.hidden=false;readerToolbar.style.left=Math.max(10,Math.min(innerWidth-readerToolbar.offsetWidth-10,rect.left+rect.width/2-readerToolbar.offsetWidth/2))+'px';readerToolbar.style.top=Math.max(76,rect.top-readerToolbar.offsetHeight-10)+'px'}};
document.addEventListener('selectionchange',()=>requestAnimationFrame(captureSelection));readerToolbar?.addEventListener('pointerdown',event=>event.preventDefault());readerToolbar?.addEventListener('mousedown',event=>event.preventDefault());readerToggle?.addEventListener('mousedown',event=>{if(activeSelection)event.preventDefault()});
document.querySelectorAll('[data-copy-selection]').forEach(button=>button.addEventListener('click',()=>activeSelection&&copyText(activeSelection.text)));
document.querySelectorAll('[data-save-quote]').forEach(button=>button.addEventListener('click',()=>{if(!activeSelection)return;readerState.notes.push({id:makeId(),kind:'quote',text:activeSelection.text.trim(),path:readerPath,title:readerTitle,createdAt:new Date().toISOString()});saveReader();renderReader();showToast('Цитата сохранена');openNotes()}));
document.querySelectorAll('[data-highlight-color]').forEach(button=>button.addEventListener('click',()=>{if(!activeSelection)return;const overlaps=readerState.highlights.some(item=>item.path===readerPath&&item.rootIndex===activeSelection.rootIndex&&Number(item.start)<activeSelection.end&&Number(item.end)>activeSelection.start);if(overlaps)return showToast('Этот фрагмент пересекается с другим маркером');const record={id:makeId(),text:activeSelection.text,path:readerPath,title:readerTitle,rootIndex:activeSelection.rootIndex,start:activeSelection.start,end:activeSelection.end,color:button.dataset.highlightColor,createdAt:new Date().toISOString()};readerState.highlights.push(record);saveReader();applyHighlight(record);getSelection()?.removeAllRanges();clearSelectionUi();renderReader();showToast('Текст выделен цветом')}));
document.querySelector('[data-add-note]')?.addEventListener('click',()=>{const text=readerInput?.value.trim();if(!text)return showToast('Сначала напишите заметку');readerState.notes.push({id:makeId(),kind:'note',text,path:readerPath,title:readerTitle,createdAt:new Date().toISOString()});readerInput.value='';saveReader();renderReader();showToast('Заметка сохранена')});
readerList?.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const id=button.dataset.copyItem||button.dataset.deleteItem,kind=button.dataset.itemKind;if(button.dataset.copyItem){const collection=kind==='highlight'?readerState.highlights:readerState.notes,item=collection.find(entry=>entry.id===id);if(item)copyText(item.text);return}if(button.dataset.deleteItem){if(kind==='highlight'){readerState.highlights=readerState.highlights.filter(item=>item.id!==id);removeHighlightMarks(id)}else readerState.notes=readerState.notes.filter(item=>item.id!==id);saveReader();renderReader();showToast('Удалено')}});
document.querySelector('[data-copy-all]')?.addEventListener('click',()=>{const entries=[...readerState.notes,...readerState.highlights.map(item=>({...item,kind:'highlight'}))].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));copyText(entries.map(item=>'['+itemLabel(item)+'] '+item.text+'\\n'+item.title+' — '+location.origin+item.path).join('\\n\\n'))});
const KEY='server-infrastructure-selfstudy-v6';
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}};
const state=read(),records=state?.records||{},history=Array.isArray(state?.history)?state.history:[],correct=Object.values(records).filter(x=>x?.correct).length,best=Math.max(0,...history.map(x=>Number(x.correct||0)));
document.querySelectorAll('[data-progress-title]').forEach(x=>x.textContent=correct?correct+' проверок выполнено верно':'Маршрут ещё не начат');
document.querySelectorAll('[data-progress-copy]').forEach(x=>x.textContent='Python: '+Number(state?.practice?.passed||0)+'/28 · итоговый тест: '+best+'/28');
const search=document.querySelector('[data-course-search]');if(search)search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();document.querySelectorAll('[data-course-card]').forEach(card=>card.hidden=q&&!card.dataset.courseCard.includes(q));document.querySelectorAll('[data-course-group]').forEach(group=>group.hidden=![...group.querySelectorAll('[data-course-card]')].some(card=>!card.hidden));});
const context=document.modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}};
register({name:'get_course_progress',title:'Показать прогресс курса',description:'Возвращает краткий прогресс самостоятельного обучения в этом браузере.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>({answeredChecks:Object.keys(records).length,correctChecks:correct,programmingTestsPassed:Number(state?.practice?.passed||0),bestFinalExam:best})});
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

const htmlFiles = ['index.html', 'curriculum/index.html', ...outputs.map(([url]) => `${url.slice(1)}index.html`)];
for (const relative of htmlFiles) {
  const html = await readFile(resolve(output, relative), 'utf8');
  if (!html.includes('<title>') || !html.includes('/assets/site.css')) throw new Error(`Invalid generated page: ${relative}`);
}
const manifest = { generatedAt: new Date().toISOString(), sourceSha256: sha256(source), routes: htmlFiles.length, chapters: chapters.length, labs: labs.length };
await writeFile(resolve(output, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Multipage site built: ${htmlFiles.length} routes, ${chapters.length} chapters, ${labs.length} lab modules.`);
