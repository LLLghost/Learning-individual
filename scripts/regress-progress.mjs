#!/usr/bin/env node
// Регрессионные проверки сохранности прогресса (дефект F1 из аудита ENG-49).
// Смена версии банка, повреждённый JSON, недоступное хранилище и неудача
// сохранения не должны молча терять прежние данные: исходная строка остаётся
// в хранилище нетронутой, сообщение называет настоящую причину, а переход на
// новую версию сначала сохраняет копию прежних данных отдельным разделом.
// Проверяется собранный сайт — запускать после node scripts/build-static.mjs:
//
//   node scripts/regress-progress.mjs
//
// Отдельно от smoke-browser.mjs: тот ходит по всем маршрутам и живым
// действиям, этот — про один инвариант хранилища, и ему нужны управляемые
// подмены localStorage, которые общему обходу не место.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './browser-launch.mjs';

const root = resolve(process.cwd(), 'build');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const KEY = 'server-infrastructure-selfstudy-v6';
const KEPT = 'server-infrastructure-selfstudy-kept-v1';

const server = createServer(async (request, response) => {
  const path = decodeURIComponent(request.url.split('?')[0]);
  const file = path.endsWith('/') ? resolve(root, `.${path}index.html`) : resolve(root, `.${path}`);
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('нет такого файла');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
try { browser = await launchBrowser(); }
catch (error) { console.error(error.message); process.exit(2); }

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failures.push(name);
};
// Живая отметка «прочитано» на пути деталей страницы: статус хранилища —
// единственное место, где читателю объясняют, что произошло с его данными.
const note = page => page.locator('#storage-status');

// Каркас прогресса текущей версии: записи берутся настоящими id из банка,
// иначе validate их отбросит, и проверка мерила бы пустое состояние.
async function seedCurrent(page) {
  return page.evaluate((key) => {
    const data = JSON.parse(document.getElementById('study-data').textContent);
    const id = data.items[0].id;
    const state = { schema: 'course-study-progress', version: data.version, records: {},
      scenarios: {}, exam: null, history: [], practice: null,
      calibration: [{ n: 0, correct: 0 }, { n: 0, correct: 0 }, { n: 0, correct: 0 }], errors: [], labs: {} };
    state.records[id] = { correct: true, mechanism: true, attempts: 1, last: 1500000000000, due: 1500000000000, streak: 1 };
    const raw = JSON.stringify(state);
    localStorage.setItem(key, raw);
    return { raw, id, version: data.version };
  }, KEY);
}

const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(`исключение: ${error.message}`));

// 1. Базовый путь: данные текущей версии читаются и переживают перезагрузку.
{
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  const seeded = await seedCurrent(page);
  await page.reload({ waitUntil: 'load' });
  const text = await note(page).textContent();
  check('baseline: прогресс текущей версии читается', text.includes('Прогресс сохраняется'), text);
  const keptRecords = await page.evaluate(key => Object.keys(JSON.parse(localStorage.getItem(key)).records).length, KEY);
  check('baseline: запись результата пережила перезагрузку', keptRecords === 1, `records=${keptRecords}`);
}

// 2. Другая версия банка: сообщение называет версию, исходные данные не
//    перезаписываются ни при загрузке, ни при переходе — переход копирует их.
{
  await page.evaluate(key => localStorage.removeItem(key), KEY);
  await page.evaluate(key => localStorage.removeItem(key), KEPT);
  const old = await page.evaluate((key) => {
    const data = JSON.parse(document.getElementById('study-data').textContent);
    const id = data.items[0].id;
    const state = { schema: 'course-study-progress', version: '0.0-old-test', records: {},
      scenarios: {}, exam: null, history: [], practice: null,
      calibration: [{ n: 0, correct: 0 }, { n: 0, correct: 0 }, { n: 0, correct: 0 }], errors: [], labs: {} };
    state.records[id] = { correct: true, mechanism: true, attempts: 3, last: 1500000000000, due: 1500000000000, streak: 2 };
    const raw = JSON.stringify(state);
    localStorage.setItem(key, raw);
    return raw;
  }, KEY);
  await page.reload({ waitUntil: 'load' });
  const text = await note(page).textContent();
  check('версия: сообщение называет смену банка', text.includes('Банк заданий обновился') && text.includes('0.0-old-test'), text);
  check('версия: сообщение не называет данные повреждёнными', !text.includes('повреждён'), text);
  const after = await page.evaluate(key => localStorage.getItem(key), KEY);
  check('версия: исходная строка не перезаписана при загрузке', after === old);
  const keptBefore = await page.evaluate(key => localStorage.getItem(key), KEPT);
  check('версия: копия ещё не создана до перехода', keptBefore === null);
  await page.getByRole('button', { name: 'Начать новый прогресс сейчас' }).click();
  const written = await page.evaluate(key => localStorage.getItem(key), KEY);
  check('версия: после перехода записан прогресс текущей версии', written && JSON.parse(written).version === JSON.parse(await page.evaluate(() => document.getElementById('study-data').textContent)).version);
  const keptAfter = await page.evaluate(key => localStorage.getItem(key), KEPT);
  check('версия: прежние данные сохранены отдельным разделом', keptAfter === old);
  const text2 = await note(page).textContent();
  check('версия: статус вернулся к обычному и упоминает раздел', text2.includes('Прогресс сохраняется') && text2.includes('отдельным разделом'), text2);
}

// 3. Повреждённый JSON: причина названа честно, данные не трогаются.
{
  await page.evaluate(([key, kept]) => { localStorage.removeItem(kept); localStorage.setItem(key, '{"schema":"course-study-progress","records":{'); }, [KEY, KEPT]);
  const broken = await page.evaluate(key => localStorage.getItem(key), KEY);
  await page.reload({ waitUntil: 'load' });
  const text = await note(page).textContent();
  check('повреждение: сообщение называет повреждение', text.includes('повреждён'), text);
  check('повреждение: сообщение не винит версию банка', !text.includes('Банк заданий обновился'), text);
  const after = await page.evaluate(key => localStorage.getItem(key), KEY);
  check('повреждение: битая строка не перезаписана', after === broken);
  const hasDownload = await page.getByRole('button', { name: 'Скачать прежние данные (JSON)' }).count();
  check('повреждение: есть путь скачать исходную копию', hasDownload === 1);
}

// 4. Недоступное хранилище: причина названа, кабинет жив, ничего не
//    перезаписывается (и перезаписывать нечем).
{
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  const page4 = await blocked.newPage();
  const seen4 = [];
  page4.on('pageerror', error => seen4.push(error.message));
  await page4.goto(origin + '/assessment/', { waitUntil: 'load' });
  const text = await note(page4).textContent();
  check('недоступность: сообщение называет недоступность хранилища', text.includes('недоступно'), text);
  check('недоступность: сообщение не называет данные повреждёнными', !text.includes('повреждён'), text);
  check('недоступность: кабинет отрисован без ошибок', (await page4.locator('#study-status').count()) === 1 && seen4.length === 0, seen4.join(' | '));
  await blocked.close();
}

// 5. Неудача сохранения при переходе: копию сохранить не вышло — исходные
//    данные обязаны остаться нетронутыми, а не быть заменены новым прогрессом.
{
  const oldRaw = await page.evaluate((key) => {
    const data = JSON.parse(document.getElementById('study-data').textContent);
    const state = { schema: 'course-study-progress', version: '0.0-old-test', records: {},
      scenarios: {}, exam: null, history: [], practice: null,
      calibration: [{ n: 0, correct: 0 }, { n: 0, correct: 0 }, { n: 0, correct: 0 }], errors: [], labs: {} };
    const raw = JSON.stringify(state);
    localStorage.setItem(key, raw);
    return raw;
  }, KEY);
  await page.evaluate(key => localStorage.removeItem(key), KEPT);
  const failing = await browser.newContext();
  await failing.addInitScript((seed) => {
    const store = {
      getItem: key => (key === seed.key ? seed.value : null),
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
      removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => store });
  }, { key: KEY, value: oldRaw });
  const page5 = await failing.newPage();
  await page5.goto(origin + '/assessment/', { waitUntil: 'load' });
  const text = await note(page5).textContent();
  check('неудача сохранения: переход объясняет, что данные не перезаписаны', text.includes('не перезаписаны'), text);
  await page5.getByRole('button', { name: 'Начать новый прогресс сейчас' }).click();
  await page5.waitForTimeout(200);
  const after = await page5.evaluate(key => localStorage.getItem(key), KEY);
  check('неудача сохранения: исходная строка осталась прежней', after === oldRaw);
  const textAfter = await note(page5).textContent();
  check('неудача сохранения: статус честно сообщает недоступность', textAfter.includes('недоступн'), textAfter);
  await failing.close();
}

// 6. Восстановление из резервной копии на «Маршруте»: текст подтверждения
//    обещает слияние — и загрузка действительно сливает, а не заменяет.
{
  // Состояние сеется на странице кабинета (там лежит study-data с версией),
  // а проверяется загрузка на «Маршруте» — хранилище одно на весь источник.
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  const seeded = await seedCurrent(page);
  await page.goto(origin + '/route/', { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.setItem('server-infrastructure-theme', 'light');
    localStorage.removeItem('server-infrastructure-selfstudy-kept-v1');
  });
  const dir = mkdtempSync(join(tmpdir(), 'course-backup-'));
  const file = join(dir, 'course-backup.json');
  writeFileSync(file, JSON.stringify({ schema: 'course-backup', version: 1, exportedAt: new Date().toISOString(), data: { [KEY]: seeded.raw } }));
  const dialogs = [];
  page.once('dialog', dialog => { dialogs.push(dialog.message()); return dialog.accept(); });
  await page.setInputFiles('[data-backup-load]', file);
  await page.waitForTimeout(600);
  const restored = await page.evaluate(key => localStorage.getItem(key), KEY);
  check('импорт: раздел из файла записан в хранилище', restored === seeded.raw);
  const theme = await page.evaluate(() => localStorage.getItem('server-infrastructure-theme'), {});
  check('импорт: раздел вне файла не тронут (слияние, а не замена)', theme === 'light', `theme=${theme}`);
  check('импорт: подтверждение обещает слияние разделов', dialogs.length === 1 && dialogs[0].includes('останутся без изменений') && !dialogs[0].includes('будет потерян'), dialogs.join(' | '));
}

check('обход без клиентских исключений', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(failures.length ? `\nПровалено проверок: ${failures.length} (${failures.join(', ')})` : '\nВсе проверки сохранности прогресса пройдены.');
process.exit(failures.length ? 1 : 0);
