#!/usr/bin/env node
// Общий каркас предметных регрессий: поднять собранный сайт локальным
// сервером, запустить браузер, вести учёт проверок и убрать всё за собой
// даже при отказе сценария. regress-cabinet и regress-progress проверяют
// разные инварианты — поведение кабинета и сохранность хранилища, — но
// окружение у них одно, и две расходящиеся копии подъёма уже однажды
// прошли мимо ревью. Сценарии остаются в самих регрессиях: каркас не
// знает, что именно проверяется, и не смешивает их между собой.
// Раздача статики — общий со smoke-обходом модуль static-server.mjs.
import { resolve } from 'node:path';
import { launchBrowser } from './browser-launch.mjs';
import { startStaticServer } from './static-server.mjs';

export const KEY = 'server-infrastructure-selfstudy-v6';
export const KEPT = 'server-infrastructure-selfstudy-kept-v1';

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

// Подписка на клиентские исключения ставится на каждую страницу до первой
// навигации. Страниц за прогон несколько — основная, блокированное
// хранилище, отказ записи, — и исключение в «чужой» странице молча
// пропускало итоговую проверку: она видела ошибки только основной.
export function trackPageErrors(page, sink) {
  page.on('pageerror', error => sink.push(`исключение: ${error.message}`));
  return page;
}

// Хранилище, чья запись всегда падает (переполнение квоты). Подмена у двух
// сценариев была копией, а цели разные: переход на новую версию банка и
// спасение несовместимой попытки. Общее здесь — только окружение; проверки
// остаются у сценариев, поэтому возвращается готовая страница с подпиской.
export async function quotaPage(browser, seed, sink) {
  const context = await browser.newContext();
  await context.addInitScript((data) => {
    const store = {
      getItem: key => (key === data.key ? data.value : null),
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
      removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => store });
  }, seed);
  const page = await context.newPage();
  if (sink) trackPageErrors(page, sink);
  return { context, page };
}

export async function regressHarness(label) {
  const { server, origin } = await startStaticServer(resolve(process.cwd(), 'build'));
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
  return { origin, browser, check, failures, finish };
}
