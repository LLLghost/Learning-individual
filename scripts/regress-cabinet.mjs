#!/usr/bin/env node
// Предметные регрессии кабинета по трём принятым замечаниям ревью PR #51
// (задача ENG-101): приём отчёта работы с испорченным evidence, повторная
// отправка второго яруса и отпечаток порядка вариантов экзамена. После
// исправления PR #54 сюда же вошли проверки сохранности несовместимой
// попытки итогового контроля (ENG-122). Проверяется собранный сайт —
// запускать после node scripts/build-static.mjs:
//
//   node scripts/regress-cabinet.mjs
//
// Отдельно от regress-progress.mjs: тот — про инварианты хранилища, этот —
// про поведение самого кабинета, и ему нужны управляемые клики и подмены
// study-data, которые общему обходу не место. Подъём сервера и браузера —
// общий каркас regress-harness.mjs.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { regressHarness, KEY, KEPT, seedState } from './regress-harness.mjs';

const { origin, browser, check, failures, finish } = await regressHarness('предметные регрессии кабинета');

// Service worker сайта отдаёт страницы из кэша в обход перехвата — для
// подмены study-data его приходится блокировать в этом контексте.
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(`исключение: ${error.message}`));

try {
// 1. Evidence проверяется поэлементно (r4143417088): [null], массив или
//    неверный тип cmd/excerpt отклоняются до сохранения, годный отчёт
//    принимается, а отказ не портит уже записанный прогресс.
{
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  const malformed = await page.evaluate(() => {
    const labdb = JSON.parse(document.getElementById('lab-data').textContent);
    const lab = labdb.labs[0];
    const base = { schema: 'course-lab-report', version: labdb.version, lab: lab.id, kind: lab.kind,
      facts: {}, claim: {}, variant: 0, seed: 'regress', collector_sha256: 'a'.repeat(64), evidence: [] };
    const withEvidence = (evidence) => ({ ...base, evidence });
    const good = { cmd: 'ls -l', rc: 0, sha256: 'b'.repeat(64), excerpt: 'total 0' };
    return {
      reject: {
        'null': withEvidence([null]),
        'массив': withEvidence([['ls -l', 'total 0']]),
        'пустой объект': withEvidence([{}]),
        'cmd не строка': withEvidence([{ cmd: 7, excerpt: 'x' }]),
        'excerpt не строка': withEvidence([{ cmd: 'x', excerpt: ['y'] }]),
        'пустой список': withEvidence([]),
        'не массив': withEvidence('ls -l'),
        'годный и битый вперемешку': withEvidence([good, null]),
      },
      accept: { 'один элемент': withEvidence([good]), 'несколько': withEvidence([good, { ...good, cmd: 'df -h', excerpt: 'tmpfs' }]) },
    };
  });
  for (const [name, report] of Object.entries(malformed.reject))
    check(`evidence: отклоняет (${name})`, await page.evaluate(r => window.CourseQA.labValid(r), report) === false);
  for (const [name, report] of Object.entries(malformed.accept))
    check(`evidence: принимает (${name})`, await page.evaluate(r => window.CourseQA.labValid(r), report) === true);

  // Живой импорт файлом: порченый файл не трогает записанный прогресс,
  // настоящий отчёт живого стенда — записывается.
  await seedState(page, { labs: {} });
  await page.evaluate(() => {
    const labdb = JSON.parse(document.getElementById('lab-data').textContent);
    const lab = labdb.labs[0];
    const report = { schema: 'course-lab-report', version: labdb.version, lab: lab.id, kind: lab.kind,
      facts: {}, claim: {}, variant: 0, seed: 'seed-before', collector_sha256: 'a'.repeat(64),
      evidence: [{ cmd: 'ls -l', rc: 0, sha256: 'b'.repeat(64), excerpt: 'total 0' }] };
    const state = JSON.parse(localStorage.getItem('server-infrastructure-selfstudy-v6'));
    state.labs[lab.id] = { report, why: 0, criteria: 1 };
    localStorage.setItem('server-infrastructure-selfstudy-v6', JSON.stringify(state));
    window.__labId = lab.id;
  });
  const labId = await page.evaluate(() => window.__labId);
  const live = JSON.parse(await readFile(resolve('quality/live-labs/2026-09-24/L04A.json'), 'utf8'));
  const broken = { ...structuredClone(live), evidence: [null] };
  // Ввод именно карточки нужной работы: файловых вводов на странице много —
  // карточка стенда, отчёты соседних работ, — и page.setInputFiles не строг:
  // молча взял бы первый подходящий. Карточка выбирается по номеру работы,
  // поэтому модуль открывается тот, к которому относится живой отчёт.
  const liveModule = await page.evaluate(labId => JSON.parse(document.getElementById('lab-data').textContent).labs.find(x => x.id === labId).module, live.lab);
  await page.locator('select[aria-label="Выбор модуля"]').selectOption(String(liveModule));
  const labCard = page.locator(`#study-panel .card.lab-card:has(h3:text("Автопроверка · ${live.lab}"))`);
  const labInput = labCard.locator('label.file-label input[type=file]');
  check('evidence: у карточки работы ровно один файловый ввод', (await labInput.count()) === 1, `count=${await labInput.count()}`);
  const upload = async (payload) => {
    page.once('dialog', dialog => dialog.accept());
    await labInput.setInputFiles({
      name: 'lab-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)),
    });
    await page.waitForTimeout(150);
  };
  await upload(broken);
  const afterBroken = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  check('evidence: порченый файл не записан', !afterBroken.labs[live.lab], `labs=${Object.keys(afterBroken.labs)}`);
  check('evidence: прежний прогресс цел', Object.keys(afterBroken.records).length === 1 && afterBroken.labs[labId]?.report.seed === 'seed-before');
  await upload(live);
  const afterLive = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  check('evidence: настоящий отчёт импортирован', afterLive.labs[live.lab]?.report?.seed === live.seed, `labs=${Object.keys(afterLive.labs)}`);
  // Импорт виден в самой карточке, а не только в хранилище: отчёт принят
  // и ждёт объяснения механизма — это и есть живой evidence-импорт.
  const cardText = await labCard.innerText();
  check('evidence: карточка приняла отчёт живого стенда', cardText.includes('Отчёт принят'), cardText.slice(0, 120));
}

// 2. Второй ярус записывается один раз (r4143417102): повторный клик по уже
//    отправленной проверке не дописывает ни попытку, ни калибровку, а новый
//    явный прогон того же задания по-прежнему записывается.
{
  await context.clearCookies();
  await page.evaluate(([key, kept]) => { localStorage.removeItem(key); localStorage.removeItem(kept); }, [KEY, KEPT]);
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  const itemId = await page.evaluate(() => JSON.parse(document.getElementById('study-data').textContent).items[0].id);
  const card = page.locator('#study-panel .card', { hasText: itemId }).first();
  const answer = async () => {
    await card.locator('.option input').first().check();
    await card.locator('fieldset.confidence input').first().check();
    await card.getByRole('button', { name: 'Ответить' }).click();
  };
  await answer();
  const tier = card.locator('.reason-tier');
  check('повтор: второй ярус показан', await tier.count() === 1);
  await tier.locator('.option input').first().check();
  const submit = tier.getByRole('button', { name: 'Проверить' });
  await submit.click();
  // Кнопка уже заблокирована: событие отправляется напрямую, как это сделал бы
  // двойной клик до блокировки — обработчик обязан остановиться сам.
  await submit.dispatchEvent('click');
  const state1 = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  check('повтор: попытка записана ровно одна', state1.records[itemId]?.attempts === 1, `attempts=${state1.records[itemId]?.attempts}`);
  check('повтор: калибровка не задвоена', state1.calibration.reduce((sum, c) => sum + c.n, 0) === 1, JSON.stringify(state1.calibration));
  check('повтор: кнопка и варианты заблокированы', await submit.isDisabled() && await tier.locator('.option input').first().isDisabled());
  // Новый явный прогон: перезагрузка даёт свежую карточку — и запись снова
  // работает, блокировка не превращается в вечную.
  await page.reload({ waitUntil: 'load' });
  const card2 = page.locator('#study-panel .card', { hasText: itemId }).first();
  const answer2 = async () => {
    await card2.locator('.option input').first().check();
    await card2.locator('fieldset.confidence input').first().check();
    await card2.getByRole('button', { name: 'Ответить' }).click();
  };
  await answer2();
  const tier2 = card2.locator('.reason-tier');
  await tier2.locator('.option input').first().check();
  await tier2.getByRole('button', { name: 'Проверить' }).click();
  const state2 = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  check('повтор: новый явный прогон записан', state2.records[itemId]?.attempts === 2, `attempts=${state2.records[itemId]?.attempts}`);
}

// 3. Отпечаток порядка охватывает оба яруса (r4143417653): попытка с текущим
//    отпечатком продолжается после перезагрузки, с прежним (одноярусным) и
//    после перестановки только reason.options — отклоняется, остальной
//    прогресс сохраняется, версия банка при этом не меняется. Отклонённая
//    попытка не теряется: исходная строка сохраняется отдельным разделом
//    до перезаписи (ENG-122).
{
  await page.evaluate(([key, kept]) => { localStorage.removeItem(key); localStorage.removeItem(kept); }, [KEY, KEPT]);
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  const examSeed = await page.evaluate((key) => {
    const data = JSON.parse(document.getElementById('study-data').textContent);
    const ids = [];
    for (let n = 0; n < 37; n++) ids.push(data.items.filter(x => x.module === n)[0].id);
    // Прежний, одноярусный отпечаток: считался только по вариантам ответов.
    let h = 0x811c9dc5;
    const feed = t => { for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
    data.items.forEach(x => (x.options || []).forEach(feed));
    return { ids, legacy: h.toString(36), order: window.CourseQA.order, version: data.version };
  }, KEY);
  check('fingerprint: новый отпечаток отличается от прежнего', examSeed.order !== examSeed.legacy);

  const seedExam = async (order) => {
    return page.evaluate(([key, seed, value]) => {
      const state = JSON.parse(localStorage.getItem(key)) || {};
      state.exam = { ids: seed.ids, order: value, responses: {}, conf: {}, why: {}, submitted: false, started: Date.now() };
      const raw = JSON.stringify(state);
      localStorage.setItem(key, raw);
      return raw;
    }, [KEY, examSeed, order]);
  };
  await seedState(page, {});
  await seedExam(examSeed.order);
  await page.reload({ waitUntil: 'load' });
  const continued = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  check('fingerprint: попытка текущего отпечатка продолжается', continued.exam?.ids?.length === 37 && continued.exam?.order === examSeed.order);
  check('fingerprint: совместимой попытке копия не нужна', await page.evaluate(key => localStorage.getItem(key), KEPT) === null);

  await seedState(page, {});
  const rawLegacy = await seedExam(examSeed.legacy);
  await page.reload({ waitUntil: 'load' });
  const droppedLegacy = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  check('fingerprint: попытка прежнего отпечатка отклонена', droppedLegacy.exam === null, JSON.stringify(droppedLegacy.exam)?.slice(0, 80));
  check('fingerprint: остальной прогресс цел', Object.keys(droppedLegacy.records).length === 1);
  check('fingerprint: несостоятельная попытка сохранена отдельным разделом', await page.evaluate(key => localStorage.getItem(key), KEPT) === rawLegacy);

  // Перестановка только reason.options — в самой разметке, без смены версии
  // банка: отпечаток меняется, начатая попытка становится несовместимой.
  await seedState(page, {});
  const rawReordered = await seedExam(examSeed.order);
  await context.route(origin + '/assessment/', async route => {
    const response = await route.fetch();
    let body = await response.text();
    body = body.replace(/(<script type="application\/json" id="study-data">)([\s\S]*?)(<\/script>)/, (all, open, json, close) => {
      const data = JSON.parse(json);
      const item = data.items.find(x => x.reason && x.reason.options.length >= 2);
      item.reason.options.reverse();
      return open + JSON.stringify(data) + close;
    });
    await route.fulfill({ response, body });
  });
  await page.reload({ waitUntil: 'load' });
  const reordered = await page.evaluate(key => ({ order: window.CourseQA.order, version: window.CourseQA.version, state: JSON.parse(localStorage.getItem(key)) }), KEY);
  await context.unroute(origin + '/assessment/');
  check('fingerprint: версия банка не изменилась', reordered.version === examSeed.version);
  check('fingerprint: перестановка reason.options меняет отпечаток', reordered.order !== examSeed.order);
  check('fingerprint: попытка после перестановки отклонена', reordered.state.exam === null);
  check('fingerprint: записи результата сохранены', Object.keys(reordered.state.records).length === 1);
  check('fingerprint: переставленная попытка тоже сохранена копией', await page.evaluate(key => localStorage.getItem(key), KEPT) === rawReordered);
}

check('обход без клиентских исключений', errors.length === 0, errors.join(' | '));
} catch (error) {
  // Отказ сценария — тоже проверка: он обязан попасть в отчёт, а не обрывать
  // его без итоговой строки и уборки окружения.
  console.log(`FAIL аварийное завершение: ${error?.message ?? error}`);
  failures.push('аварийное завершение сценария');
} finally {
  await finish();
}
