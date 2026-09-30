#!/usr/bin/env node
// Общий каркас предметных регрессий: поднять собранный сайт локальным
// сервером, запустить браузер, вести учёт проверок и убрать всё за собой
// даже при отказе сценария. regress-cabinet и regress-progress проверяют
// разные инварианты — поведение кабинета и сохранность хранилища, — но
// окружение у них одно, и две расходящиеся копии подъёма уже однажды
// прошли мимо ревью. Сценарии остаются в самих регрессиях: каркас не
// знает, что именно проверяется, и не смешивает их между собой.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { launchBrowser } from './browser-launch.mjs';

export const KEY = 'server-infrastructure-selfstudy-v6';
export const KEPT = 'server-infrastructure-selfstudy-kept-v1';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

// Каркас прогресса текущей версии: записи берутся настоящими id из банка,
// иначе validate их отбросит, и проверка мерила бы пустое состояние.
export async function seedState(page, patch) {
  return page.evaluate(([key, extra]) => {
    const data = JSON.parse(document.getElementById('study-data').textContent);
    const state = { schema: 'course-study-progress', version: data.version, records: {},
      scenarios: {}, exam: null, history: [], practice: null,
      calibration: [{ n: 0, correct: 0 }, { n: 0, correct: 0 }, { n: 0, correct: 0 }], errors: [], labs: {} };
    state.records[data.items[0].id] = { correct: true, mechanism: true, attempts: 1, last: 1500000000000, due: 1500000000000, streak: 1 };
    Object.assign(state, extra ?? {});
    const raw = JSON.stringify(state);
    localStorage.setItem(key, raw);
    return { raw, id: data.items[0].id, version: data.version };
  }, [KEY, patch ?? {}]);
}

export async function regressHarness(label) {
  const root = resolve(process.cwd(), 'build');
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
  let browser;
  try { browser = await launchBrowser(); }
  catch (error) { console.error(error.message); server.close(); process.exit(2); }
  const failures = [];
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
    if (!ok) failures.push(name);
  };
  // Уборка обязательна и при провале: упавший сценарий не должен оставлять
  // браузер и сервер висеть — следующий прогон тогда падает на занятом порте,
  // а не на настоящей ошибке, и отказ выглядит потерянным.
  const finish = async () => {
    await browser.close();
    server.close();
    console.log(failures.length ? `\nПровалено проверок: ${failures.length} (${failures.join(', ')})` : `\nВсе ${label} пройдены.`);
    process.exit(failures.length ? 1 : 0);
  };
  return { origin: `http://127.0.0.1:${server.address().port}`, browser, check, failures, finish };
}
