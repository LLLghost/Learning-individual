#!/usr/bin/env node
// Регрессионные проверки поиска маркера фрагмента (два P2 из ревью PR #53,
// решение ENG-118, и пять замечаний ревью PR #55). markerOf решает, в какой
// фрагмент при записи правок попадает текст, поэтому правила распознавания
// закреплены проверками, а не только комментарием у функции:
//
//   • `<script-data>` и `<scripting>` — обычные элементы: имя скрипта
//     кончается на HTML-пробел, «/» или «>», дефис имя не продолжает, и
//     маркер внутри такого элемента находится;
//   • `<SCRIPT>` и `</ScRiPt>` — настоящие теги скрипта в любом регистре:
//     приманка внутри блока не видна, маркер после блока находится;
//   • открывающий `<SCRIPT id="…">` в тексте скрипта — текст, а не тег:
//     блок закрывается первым же `</script`, приманка в строковом литерале
//     маркером не становится;
//   • граница имени тега и граница атрибута id — точный набор HTML ASCII
//     whitespace (space, TAB, LF, FF, CR), а не JS `\s`: NBSP и вертикальная
//     табуляция имена продолжают;
//   • id на самом `<script … id="…">` остаётся маркером — так адресуются
//     блоки данных и границы после них (script-end, plain-script-after),
//     а конец блока ищется теми же правилами, что и маркер: любой регистр,
//     допустимый пробел, точное имя — и отказ, а не (-1) + 9, когда закрытия
//     нет;
//   • комментарий и `data-id="…"` маркером не считаются.
//
// Вторая половина — кругозапись на изолированной fixture: правка прозы
// меняет только свои фрагменты, соседние остаются байт-в-байт, а повторная
// сборка воспроизводит правленый документ. Fixture собирает все виды
// локаторов манифеста и ловушки всех видов вокруг правки; после прогона
// fixture убирается в finally — и при провале, и при исключении.
//
//   node scripts/regress-marker.mjs
//
// Входит в `pnpm validate` и в CI наряду с validate-site.mjs: валидатор
// проверяет собранный сайт, эти правила — про инструмент правки исходника,
// которому нужна управляемая fixture.
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

// Обратное: маркер обязан отсутствовать, а не находиться на приманке.
const absent = (name, html, id) => {
  try {
    markerOf(html, id);
    check(name, 'нашёл маркер', 'маркер отсутствует');
  } catch (error) {
    check(name, error.message.includes('не найден маркер') ? 'маркер отсутствует' : error.message, 'маркер отсутствует');
  }
};

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

// Открывающий script в тексте скрипта — текст, а не тег: блок закрывается
// первым </script, и приманка в строковом литерале не становится маркером
// ни в верхнем, ни в нижнем регистре (P1 ревью PR #55).
unit('в тексте скрипта: <SCRIPT id> — не маркер',
  `<script>const s = '<SCRIPT id="target">';</script><h1 id="target">real</h1>`,
  'target', '<h1 id="target">real');
unit('в тексте скрипта: <script id> — не маркер',
  `<script>const s = '<script id="target">';</script><h1 id="target">real</h1>`,
  'target', '<h1 id="target">real');

// Граница имени тега — точный набор HTML ASCII whitespace (space, TAB, LF,
// FF, CR), а не JS \s: NBSP и вертикальная табуляция имя продолжают, и
// `<script\u00A0…>` — обычный элемент, внутри которого маркер виден (P2
// ревью PR #55).
unit('HTML-пробел: NBSP после имени — не граница, маркер виден',
  '<script\u00A0data-x><h1 id="target">real</h1></script\u00A0data-x>',
  'target', '<h1 id="target">real');
unit('HTML-пробел: вертикальная табуляция — не граница',
  '<script\u000Bdata-x><h1 id="target">real</h1></script\u000Bdata-x>',
  'target', '<h1 id="target">real');
unit('HTML-пробел: TAB после имени — тег скрипта, приманка скрыта',
  `<script\tdata-x>var s = '<h1 id="target">fake</h1>';</script\tdata-x><h1 id="target">real</h1>`,
  'target', '<h1 id="target">real');
unit('HTML-пробел: NBSP перед id — не атрибут, маркер не срабатывает',
  '<h1\u00A0id="target">fake</h1><h1 id="target">real</h1>',
  'target', '<h1 id="target">real');

// Точное имя и у закрытия: `</scriptx>` блок не закрывает, и всё после
// открывающего тега — текст скрипта, где маркера нет.
absent('точное имя закрытия: </scriptx> не закрывает блок',
  `<script>var s = 1;</scriptx><h1 id="target">real</h1>`, 'target');

// Кругозапись: fixture со всеми видами локаторов и ловушками вокруг правки.
// Документ маленький, но по структуре — та же книга: шелл, проза, блок
// данных, скрипт после него; маркеры — те же виды id, что в настоящем
// манифесте. Ловушки: маркер внутри custom-элемента, приманка в верхнем
// регистре внутри <SCRIPT>, приманка в комментарии. Закрытие блока данных —
// `</ScRiPt >`: смешанный регистр и пробел перед «>», как их обязан
// принимать и поиск конца блока (script-end, plain-script-after).
const root = mkdtempSync(join(tmpdir(), 'regress-marker-'));
try {
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
    'data/lab-data.html': '<script type="application/json" id="lab-data">{"kind":"fixture"}</ScRiPt >',
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
  // в соседних фрагментах и обязаны остаться байт-в-байт; граница после
  // блока данных разрешается через `</ScRiPt >`.
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

  // Отказы обязаны называть причину: убранный маркер, задвоенный якорь и
  // незакрытый блок данных — именно те ошибки, которые правка прозы могла
  // бы скрыть; отсутствие закрытия раньше молча давало (-1) + 9.
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
  await rejects('отказ: блок данных не закрыт',
    edited.replace('</ScRiPt >', '').replace('</SCRIPT>', '').replace('</script>', ''),
    'не закрыт блок id="lab-data"');
} finally {
  // Fixture убирается и при провале утверждения, и при исключении: раньше
  // очистка стояла после process.exit и не выполнялась никогда.
  rmSync(root, { recursive: true, force: true });
}

if (failed) {
  console.error(`\nregress-marker: ${failed} проверок не прошло`);
  // exitCode вместо process.exit внутри try: тот перепрыгивает finally
  // и оставил бы fixture в /tmp.
  process.exitCode = 1;
} else {
  console.log('\nregress-marker: все проверки прошли');
}
