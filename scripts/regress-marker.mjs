#!/usr/bin/env node
// Регрессионные проверки поиска маркера фрагмента (два P2 из ревью PR #53,
// решение ENG-118). markerOf решает, в какой фрагмент при записи правок
// попадает текст, поэтому правила распознавания закреплены проверками, а не
// только комментарием у функции:
//
//   • `<script-data>` и `<scripting>` — обычные элементы: имя скрипта
//     кончается на HTML-пробел, «/» или «>», дефис имя не продолжает, и
//     маркер внутри такого элемента находится;
//   • `<SCRIPT>` и `</ScRiPt>` — настоящие теги скрипта в любом регистре:
//     приманка внутри блока не видна, маркер после блока находится;
//   • id на самом `<script … id="…">` остаётся маркером — так адресуются
//     блоки данных и границы после них (script-end, plain-script-after);
//   • комментарий и `data-id="…"` маркером не считаются.
//
// Вторая половина — кругозапись на изолированной fixture: правка прозы
// меняет только свои фрагменты, соседние остаются байт-в-байт, а повторная
// сборка воспроизводит правленый документ. Fixture собирает все виды
// локаторов манифеста и ловушки всех видов вокруг правки.
//
//   node scripts/regress-marker.mjs
//
// Отдельно от validate-site.mjs: валидатор проверяет собранный сайт, эти
// правила — про инструмент правки исходника, ему нужна управляемая fixture.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { markerOf, readCourse, writeCourse } from './course-source.mjs';

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${ok ? '' : ` — получил ${actual}, ожидал ${expected}`}`);
};

// Позиция маркера — начало настоящего тега с id, а не первое вхождение
// строки: ожидания здесь вычисляются по позиции честного тега в fixture,
// чтобы проверка не сверялась сама с собой.
const unit = (name, html, id, honestTag) =>
  check(name, markerOf(html, id), html.indexOf(honestTag));

unit('custom tag: маркер внутри <script-data> находится',
  '<script-data><h1 id="target">real</h1></script-data>', 'target', '<h1 id="target">real');
unit('custom tag: id на самом элементе — маркер',
  '<script-data id="custom"><p>текст</p></script-data>', 'custom', '<script-data id="custom">');
unit('custom tag: <scripting> — не скрипт',
  '<scripting>var x = 1;</scripting><h1 id="target">real</h1>', 'target', '<h1 id="target">real');
unit('регистр: <SCRIPT> прячет приманку, маркер после блока',
  `<SCRIPT>const s = '<h1 id="target">fake</h1>';</SCRIPT><h1 id="target">real</h1>`,
  'target', '<h1 id="target">real');
unit('регистр: смешанный <Script> … </ScRiPt>',
  `<Script>const s = '<h1 id="target">fake</h1>';</ScRiPt><h1 id="target">real</h1>`,
  'target', '<h1 id="target">real');
unit('регистр: закрывающий </ScRiPt> при нижнем открывающем',
  `<script>var s = '<h1 id="target">fake</h1>';</ScRiPt><h1 id="target">real</h1>`,
  'target', '<h1 id="target">real');
unit('id на самом <script type="application/json">',
  '<script type="application/json" id="lab-data">{"a":1}</script><p>дальше</p>',
  'lab-data', '<script type="application/json" id="lab-data">');
unit('обычный <script>: приманка в тексте скрипта не видна',
  `<script>var decoy = '<h1 id="target">fake</h1>';</script><h1 id="target">real</h1>`,
  'target', '<h1 id="target">real');
unit('комментарий целиком пропускается',
  `<!--<h1 id="target">fake</h1>--><h1 id="target">real</h1>`, 'target', '<h1 id="target">real');
unit('data-id — не маркер',
  '<h1 data-id="target">x</h1><h1 id="target">real</h1>', 'target', '<h1 id="target">real');

// Кругозапись: fixture со всеми видами локаторов и ловушками вокруг правки.
// Документ маленький, но по структуре — та же книга: шелл, проза, блок
// данных, скрипт после него; маркеры — те же виды id, что в настоящем
// манифесте. Ловушки: маркер внутри custom-элемента, приманка в верхнем
// регистре внутри <SCRIPT>, приманка в комментарии.
const root = mkdtempSync(join(tmpdir(), 'regress-marker-'));
const manifest = {
  target: 'public/course.html',
  fragments: [
    { file: 'shell/open.html', start: { kind: 'offset', at: 0 } },
    { file: 'shell/style.html', start: { kind: 'tag', tag: '<style' } },
    { file: 'shell/body.html', start: { kind: 'tag', tag: '</head>' } },
    { file: 'intro/intro.html', start: { kind: 'marker', id: 'intro' }, anchor: 'intro' },
    { file: 'intro/inside-custom.html', start: { kind: 'marker', id: 'inside-custom' } },
    { file: 'data/lab-data.html', start: { kind: 'marker', id: 'lab-data' }, anchor: 'lab-data' },
    { file: 'data/after-lab.html', start: { kind: 'script-end', id: 'lab-data' } },
    { file: 'data/plain.html', start: { kind: 'plain-script-after', id: 'lab-data' } },
    { file: 'shell/close.html', start: { kind: 'last-tag', tag: '</body>' } },
  ],
};
const bodies = {
  'shell/open.html': '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>fixture</title>',
  'shell/style.html': '<style>body{color:#000}</style>',
  'shell/body.html': '</head><body>',
  'intro/intro.html': '<section id="intro"><p>Вводная проза до ловушек.</p></section>',
  'intro/inside-custom.html': '<script-data><h2 id="inside-custom">Заголовок внутри custom-элемента</h2></script-data>',
  'data/lab-data.html': '<script type="application/json" id="lab-data">{"kind":"fixture"}</script>',
  'data/after-lab.html': `<p>После блока данных.</p><SCRIPT>var s = '<h1 id="decoy">fake</h1>';</SCRIPT>`,
  'data/plain.html': '<script>window.__fixture = true;</script><!--<p id="ghost">комментарий</p>-->',
  'shell/close.html': '</body></html>',
};
for (const file of Object.keys(bodies)) {
  mkdirSync(resolve(root, 'content', file, '..'), { recursive: true });
  writeFileSync(resolve(root, 'content', file), bodies[file]);
}
mkdirSync(resolve(root, 'public'), { recursive: true });
writeFileSync(resolve(root, 'content', 'manifest.json'), JSON.stringify(manifest, null, 2));

const original = await readCourse(root);
const before = Object.fromEntries(Object.keys(bodies).map((file) =>
  [file, readFileSync(resolve(root, 'content', file), 'utf8')]));

// Правка прозы в двух фрагментах: обычном и том, что начинается маркером
// внутри custom-элемента. Обе ловушки (SCRIPT-приманка и комментарий) лежат
// в соседних фрагментах и обязаны остаться байт-в-байт.
const edited = original
  .replace('Вводная проза до ловушек.', 'Вводная проза после правки.')
  .replace('Заголовок внутри custom-элемента', 'Отредактированный заголовок внутри custom-элемента');
const { changed } = await writeCourse(edited, root);
check('round-trip: изменены ровно два фрагмента',
  changed.sort().join(','), 'content/intro/inside-custom.html,content/intro/intro.html');
let untouched = 0;
for (const file of Object.keys(bodies)) {
  if (changed.includes(`content/${file}`)) continue;
  if (readFileSync(resolve(root, 'content', file), 'utf8') === before[file]) untouched += 1;
}
check('round-trip: остальные семь фрагментов байт-в-байт', untouched, 7);
check('round-trip: повторная сборка воспроизводит правленый документ',
  await readCourse(root), edited);

// Отказы обязаны называть причину: убранный маркер и задвоенный якорь —
// именно те ошибки, которые правка прозы могла бы скрыть.
const rejects = async (name, html, expected) => {
  try {
    await writeCourse(html, root);
    check(name, 'записала без отказа', expected);
  } catch (error) {
    check(name, error.message.includes(expected) ? expected : error.message, expected);
  }
};
await rejects('отказ: маркер убран', edited.replace('id="intro"', 'id="moved"'),
  'не найден маркер id="intro"');
await rejects('отказ: якорь задвоен', edited.replace('<p>Вводная проза после правки.</p>',
  '<p>Вводная проза после правки.</p><p id="intro">дубль якоря</p>'),
  'теряет якорь id="intro"');

if (failed) {
  console.error(`\nregress-marker: ${failed} проверок не прошло`);
  process.exit(1);
}
rmSync(root, { recursive: true, force: true });
console.log('\nregress-marker: все проверки прошли');
