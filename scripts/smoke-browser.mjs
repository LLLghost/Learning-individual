#!/usr/bin/env node
// Обход собранного сайта настоящим браузером. Валидатор читает разметку и не
// видит того, что ломается только при исполнении: ошибка в клиентском коде,
// не найденный элемент, упавший обработчик. До сих пор такой обход делался
// руками, то есть не делался, когда о нём забывали.
//
//   node scripts/smoke-browser.mjs          # нужен playwright и Chromium
//
// Отдельно от validate-site.mjs: тому хватает стандартной библиотеки, а этому
// нужен браузер. Публикация ждёт обоих.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';

const root = resolve(process.cwd(), 'build');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

const walk = async (directory, prefix = '/') => {
  const routes = [];
  for (const entry of await readdir(directory)) {
    const full = join(directory, entry);
    if ((await stat(full)).isDirectory()) routes.push(...await walk(full, `${prefix}${entry}/`));
    else if (entry === 'index.html') routes.push(prefix);
  }
  return routes.sort();
};

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

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('Нужен playwright: npm i -D playwright && npx playwright install chromium'); process.exit(2); }

const routes = await walk(root);
const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
let checked = 0;
for (const route of routes) {
  const seen = [];
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.on('console', (message) => { if (message.type() === 'error') seen.push(message.text()); });
  page.on('pageerror', (error) => seen.push(`исключение: ${error.message}`));
  const response = await page.goto(origin + route, { waitUntil: 'load' });
  if (!response?.ok()) seen.push(`страница отдала ${response?.status()}`);
  await page.waitForTimeout(120);
  checked += 1;
  if (seen.length) problems.push(`${route}: ${seen.slice(0, 2).join(' · ')}`);
}

// Три живых действия: тренажёр засчитывает ответ, поиск находит, кабинет
// собирается. Каждое из них ломалось молча и правилами разметки не ловится.
const act = async (route, name, work) => {
  page.removeAllListeners('pageerror');
  page.on('pageerror', (error) => problems.push(`${name}: исключение ${error.message}`));
  try {
    await page.goto(origin + route, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    const trouble = await work();
    if (trouble) problems.push(`${name}: ${trouble}`);
  } catch (error) {
    // Исчезнувшая кнопка роняет сам обход, а должна быть находкой: без этого
    // проверка падает стеком вместо того, чтобы назвать сломанное действие.
    problems.push(`${name}: действие не выполнилось — ${error.message.split('\n')[0]}`);
  }
};

await act('/chapters/07/', 'мини-тренажёр', async () => {
  await page.click('[data-trainer-question] label input');
  await page.click('[data-trainer-question] [data-trainer-check]');
  await page.waitForTimeout(150);
  const shown = await page.evaluate(() => {
    const feedback = document.querySelector('[data-trainer-feedback]');
    return { hidden: feedback.hidden, text: feedback.textContent.trim() };
  });
  return shown.hidden || !shown.text ? 'разбор не показан после ответа' : '';
});

await act('/chapters/07/', 'поиск', async () => {
  await page.click('[data-search-open]');
  await page.waitForTimeout(120);
  await page.fill('[data-search-input]', 'multipath');
  await page.waitForTimeout(800);
  const hits = await page.evaluate(() => document.querySelectorAll('[data-search-results] a').length);
  return hits > 0 ? '' : 'по слову multipath ничего не найдено';
});

await act('/assessment/?module=7', 'кабинет', async () => {
  const built = await page.evaluate(() => {
    const panel = document.getElementById('study-panel');
    return { blocks: panel.querySelectorAll('.card').length, lab: !!panel.querySelector('.module-lab') };
  });
  if (!built.blocks) return 'вид модуля не собрал ни одного задания';
  return built.lab ? '' : 'работа практикума не показана в виде модуля';
});

await browser.close();
server.close();

if (problems.length) {
  console.error(`Браузер нашёл ${problems.length} проблем на ${checked} маршрутах и трёх действиях:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Браузер прошёл ${checked} маршрутов и три действия: ошибок нет.`);
