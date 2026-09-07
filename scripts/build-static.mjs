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

const pageShell = ({ title, eyebrow, body, sidebar = '', className = '', description = title }) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escape(description)}"><meta name="theme-color" content="#081a24"><title>${escape(title)} · Серверная инфраструктура</title><link rel="stylesheet" href="/assets/site.css"></head>
<body><header class="topbar">${globalNav}<details class="mobile-menu"><summary>Разделы</summary><div>${globalNav}</div></details></header>
<div class="page-layout ${className}">${sidebar ? `<aside class="side-nav">${sidebar}</aside>` : ''}<main class="page-main"><p class="eyebrow">${escape(eyebrow)}</p>${body}</main></div>
<script src="/assets/site.js"></script></body></html>`;

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
:root{--ink:#102733;--muted:#5b6d76;--navy:#071a24;--navy2:#0d2c38;--teal:#1aa698;--teal2:#8ce0d6;--paper:#f5f0e6;--white:#fffdf9;--line:#d9d4c8;--amber:#e2a947;color-scheme:light}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.topbar{height:68px;background:var(--navy);color:white;display:flex;align-items:center;padding:0 max(24px,calc((100vw - 1440px)/2));gap:48px;position:sticky;top:0;z-index:20;border-bottom:1px solid #ffffff18}.brand{display:flex;align-items:baseline;gap:7px;color:white;text-decoration:none;letter-spacing:.08em}.brand span{font-size:11px;color:var(--teal2)}.brand strong{font-size:19px}.topbar>nav{display:flex;gap:28px}.topbar nav a{color:#d7e7e8;text-decoration:none;font-size:14px}.topbar nav a:hover{color:white}.mobile-menu{display:none;margin-left:auto}.page-layout{max-width:1440px;margin:auto;min-height:calc(100vh - 68px)}.page-main{min-width:0;padding:54px clamp(24px,5vw,76px) 90px}.with-sidebar{display:grid;grid-template-columns:300px minmax(0,1fr)}.side-nav{height:calc(100vh - 68px);position:sticky;top:68px;overflow:auto;padding:34px 24px;background:#0b2430;color:white}.side-nav a{display:grid;grid-template-columns:35px 1fr;gap:8px;padding:8px 9px;color:#bcd0d3;text-decoration:none;font-size:12px;line-height:1.35;border-radius:5px}.side-nav a span{color:#6ec9bf;font-variant-numeric:tabular-nums}.side-nav a:hover,.side-nav a[aria-current=page]{background:#173b47;color:white}.side-nav .back-link{display:block;margin-bottom:22px;color:white}.nav-group{margin:20px 0}.nav-group p,.side-title{margin:0 8px 8px;color:#6f9199;font-size:10px;text-transform:uppercase;letter-spacing:.1em}.sidebar-scroll{padding-bottom:40px}.eyebrow{margin:0 0 12px;color:var(--teal);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.hero{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,.7fr);gap:72px;align-items:end;padding:58px 0 74px}.hero h1,.catalog-head h1,.tool-intro h1{font-family:Georgia,serif;font-size:clamp(42px,6vw,84px);line-height:.94;letter-spacing:-.04em;margin:0}.hero h1 em{color:var(--teal);font-weight:400}.hero>div>p{max-width:720px;font-size:19px;line-height:1.6;color:var(--muted)}.hero-actions{display:flex;gap:12px;margin-top:30px}.button{display:inline-block;border:1px solid #9bb2b5;padding:12px 18px;text-decoration:none;color:var(--ink);font-weight:700;font-size:14px}.button.primary{background:var(--navy);color:white;border-color:var(--navy)}.hero-stats{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);background:var(--white)}.hero-stats div{padding:25px;border:1px solid var(--line)}.hero-stats strong{display:block;font-family:Georgia,serif;font-size:42px}.hero-stats span{font-size:12px;color:var(--muted)}.progress-card{background:var(--navy2);color:white;padding:26px 30px;display:flex;align-items:center;justify-content:space-between}.progress-card p{margin:6px 0;color:#b7d1d2}.progress-card a{color:var(--teal2)}.section-head{display:flex;align-items:end;justify-content:space-between;margin:70px 0 22px}.section-head h2{font-family:Georgia,serif;font-size:36px;margin:0}.section-head a{color:var(--ink)}.part-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.part-card{min-height:178px;padding:23px;background:var(--white);border:1px solid var(--line);text-decoration:none;color:var(--ink);transition:.18s}.part-card:hover,.chapter-card:hover{border-color:var(--teal);transform:translateY(-2px)}.part-card span{color:var(--teal);font-size:11px;font-weight:800;text-transform:uppercase}.part-card h2{font-family:Georgia,serif;font-size:23px}.part-card p{color:var(--muted);font-size:12px}.catalog-head{max-width:900px;margin-bottom:46px}.catalog-head h1,.tool-intro h1{font-size:clamp(40px,6vw,68px)}.catalog-head>p,.tool-intro>p{font-size:18px;line-height:1.6;color:var(--muted)}.search{display:block;margin-top:28px}.search span{display:block;font-size:12px;font-weight:700;margin-bottom:7px}.search input{width:min(560px,100%);padding:14px 16px;border:1px solid #9eb1b4;background:white;font:inherit}.catalog-part{display:grid;grid-template-columns:210px 1fr;gap:35px;border-top:1px solid var(--line);padding:32px 0}.catalog-part>div>p{color:var(--teal);font-size:11px;font-weight:800;text-transform:uppercase}.catalog-part h2{font-family:Georgia,serif;font-size:26px}.chapter-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.chapter-card{padding:18px;background:var(--white);border:1px solid var(--line);text-decoration:none;color:var(--ink)}.chapter-card>span{color:var(--teal);font-family:ui-monospace,monospace}.chapter-card h3{font-size:16px;line-height:1.35}.chapter-card p{font-size:11px;color:var(--muted)}.chapter-prose,.prose{max-width:900px;margin:auto}.prose h1{font-family:Georgia,serif;font-size:clamp(34px,5vw,58px);line-height:1.06;letter-spacing:-.025em;margin:0 0 36px}.prose h2{font-family:Georgia,serif;font-size:32px;margin:62px 0 18px;padding-top:10px;border-top:1px solid var(--line)}.prose h3{font-size:20px;margin:38px 0 12px}.prose h4{font-size:16px}.prose p,.prose li{font-size:16px;line-height:1.72}.prose p{margin:13px 0}.prose a{color:#087e75}.prose pre{overflow:auto;background:var(--navy);color:#d9eeee;padding:18px;border-left:4px solid var(--teal);font-size:13px;line-height:1.55}.prose code{font-family:"Cascadia Code",Consolas,monospace;background:#e4e2d9;padding:.08em .28em}.prose pre code{background:none;padding:0}.prose table{width:100%;border-collapse:collapse;margin:20px 0;background:white}.prose th,.prose td{padding:10px;border:1px solid var(--line);text-align:left}.prose blockquote{margin:24px 0;padding:5px 20px;border-left:4px solid var(--amber);background:#fff8e9}.prose details{margin:20px 0;padding:16px;border:1px solid var(--line);background:white}.prose img{max-width:100%}.pager{max-width:900px;margin:60px auto 0;display:grid;grid-template-columns:1fr auto 1fr;gap:14px;border-top:1px solid var(--line);padding-top:24px}.pager a{color:var(--ink);text-decoration:none;font-weight:700}.pager a:last-child{text-align:right}.assessment-link{color:var(--teal)!important}.tool-intro{max-width:950px;margin:0 auto 35px}.study-surface,.compact-prose{max-width:980px;margin:0 auto 38px;background:var(--white);border:1px solid var(--line);padding:clamp(18px,4vw,42px)}.study-app .controls{display:flex;flex-wrap:wrap;gap:8px;margin:15px 0}.study-app button,.study-surface button,.study-app select,.file-label{padding:10px 14px;border:1px solid #88a6aa;background:white;color:var(--ink);cursor:pointer;font:inherit}.study-app .navbtn[aria-pressed=true]{background:var(--navy);color:white}.study-app .card,.quiz{padding:20px;margin:18px 0;border:1px solid var(--line);background:#faf9f4}.study-app label.option,.quiz label{display:block;padding:10px;margin:8px 0;background:white;border:1px solid var(--line);cursor:pointer}.study-app label.option:has(input:checked){border-color:var(--teal);background:#e7f6f3}.study-app .answer-field{display:block;width:100%;max-width:320px;padding:10px;margin-top:6px}.study-app .result{padding:12px;border-left:4px solid var(--teal);background:#e9f5f3}.study-app .ok{color:#116a4e}.study-app .bad{color:#a03c25}.study-app progress{width:100%}.study-app table{width:100%;border-collapse:collapse}.study-app td,.study-app th{padding:9px;border:1px solid var(--line)}.study-app .hidden-input{display:none}.reference-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:900px;margin:0 auto 44px}.reference-cards a{padding:22px;background:var(--navy2);color:white;text-decoration:none}.reference-cards span{display:block;color:var(--teal2);font-size:11px;text-transform:uppercase;margin-bottom:8px}.reference-cards strong{font-family:Georgia,serif;font-size:20px}@media(max-width:900px){.topbar>nav{display:none}.mobile-menu{display:block}.mobile-menu summary{cursor:pointer}.mobile-menu>div{position:absolute;right:16px;top:58px;background:var(--navy2);padding:18px;box-shadow:0 12px 30px #0008}.mobile-menu .brand{display:none}.mobile-menu nav{display:grid;gap:14px}.with-sidebar{display:block}.side-nav{display:none}.hero{grid-template-columns:1fr;gap:30px}.part-grid{grid-template-columns:1fr 1fr}.catalog-part{grid-template-columns:1fr}.chapter-grid{grid-template-columns:1fr}.reference-cards{grid-template-columns:1fr}.page-main{padding-top:35px}}@media(max-width:560px){.part-grid{grid-template-columns:1fr}.hero h1{font-size:44px}.hero-actions{flex-direction:column}.pager{grid-template-columns:1fr}.pager a:last-child{text-align:left}.study-surface{padding:14px}.topbar{padding:0 18px}}@media print{.topbar,.side-nav,.pager{display:none}.with-sidebar{display:block}.page-main{padding:0}.prose{max-width:none}}
`;

const js = `(() => {'use strict';
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
