#!/usr/bin/env node
// Регрессионные проверки сохранности прогресса (дефект F1 из аудита ENG-49).
// Смена версии банка, повреждённый JSON, недоступное хранилище и неудача
// сохранения не должны молча терять прежние данные: исходная строка остаётся
// в хранилище нетронутой, сообщение называет настоящую причину, а переход на
// новую версию сначала сохраняет копию прежних данных отдельным разделом.
// Сюда же относится сохранность несовместимой попытки итогового контроля
// (дефект PR #54, задача ENG-122): validate отбрасывает попытку прежнего
// отпечатка порядка вариантов, и загрузчик не имел права тут же писать
// очищенный прогресс поверх исходной строки. Проверяется собранный сайт —
// запускать после node scripts/build-static.mjs:
//
//   node scripts/regress-progress.mjs
//
// Отдельно от smoke-browser.mjs: тот ходит по всем маршрутам и живым
// действиям, этот — про инварианты хранилища, и ему нужны управляемые
// подмены localStorage, которые общему обходу не место. Подъём сервера
// и браузера — общий каркас regress-harness.mjs.
import { writeFileSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { regressHarness, KEY, KEPT, seedState, trackPageErrors, quotaPage } from './regress-harness.mjs';

const { origin, browser, check, failures, finish } = await regressHarness('проверки сохранности прогресса');

// Живая отметка «прочитано» на пути деталей страницы: статус хранилища —
// единственное место, где читателю объясняют, что произошло с его данными.
const note = page => page.locator('#storage-status');
// Попытка прежнего отпечатка на исходном банке: одноярусный hash ban0p7
// (только варианты ответов) и текущий двухъярусный 1g31eky. Значения
// закреплены сознательно: смена банка меняет отпечатки, и проверка должна
// громко потребовать пересчитать фикстуры, а не молча мерить другое.
const LEGACY_ORDER = 'ban0p7', CURRENT_ORDER = '1g31eky';

// Несовместимая попытка в хранилище: настоящие id по одному из модуля,
// порядок — прежний отпечаток, как это выглядело у читателя до обновления.
// Карты ответов наполняются настоящими значениями банка (верный вариант,
// верное рассуждение, уверенная отметка): попытка до отклонения обязана
// выглядеть как отвеченный живой вариант, а не пустой объект, — иначе
// равенство исходной строки и копии доказывало сохранность пустоты.
// probe возвращает опорную запись, по которой сценарии сверяют содержимое
// копии: байтового равенства мало, ответы должны дойти до читателя.
async function seedLegacyExam(page, order) {
  return page.evaluate(([key, value]) => {
    const data = JSON.parse(document.getElementById('study-data').textContent);
    const picks = Array.from({ length: 37 }, (_, n) => data.items.find(x => x.module === n && x.kind === 'concept' && x.reason));
    const state = JSON.parse(localStorage.getItem(key));
    state.exam = { ids: picks.map(x => x.id), order: value,
      responses: Object.fromEntries(picks.map(x => [x.id, x.answer])),
      conf: Object.fromEntries(picks.map(x => [x.id, 2])),
      why: Object.fromEntries(picks.map(x => [x.id, x.reason.answer])),
      submitted: false, started: 1500000000000 };
    const raw = JSON.stringify(state);
    localStorage.setItem(key, raw);
    return { raw, probe: { id: picks[0].id, answer: picks[0].answer, why: picks[0].reason.answer, conf: 2, count: picks.length } };
  }, [KEY, order]);
}

// Сбор клиентских исключений общий для всех контекстов прогона: основной
// страницы, блокированного хранилища и страниц с отказом записи.
const errors = [];

try {
const context = await browser.newContext();
const page = trackPageErrors(await context.newPage(), errors);
// 1. Базовый путь: данные текущей версии читаются и переживают перезагрузку.
{
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  const seeded = await seedState(page);
  await page.reload({ waitUntil: 'load' });
  const text = await note(page).textContent();
  check('baseline: прогресс текущей версии читается', text.includes('Прогресс сохраняется'), text);
  const keptRecords = await page.evaluate(key => Object.keys(JSON.parse(localStorage.getItem(key)).records).length, KEY);
  check('baseline: запись результата пережила перезагрузку', keptRecords === 1, `records=${keptRecords}`);
}

// 2. Другая версия банка: сообщение называет версию, исходные данные не
//    перезаписываются ни при загрузке, ни при переходе — переход копирует их.
{
  await page.evaluate(([key, kept]) => { localStorage.removeItem(key); localStorage.removeItem(kept); }, [KEY, KEPT]);
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
  // Исключения этой страницы идут и в локальную проверку сценария, и в
  // общий итог: контекст отдельный, а требование к нему то же.
  const page4 = trackPageErrors(await blocked.newPage(), errors);
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
  const { context: failing, page: page5 } = await quotaPage(browser, { key: KEY, value: oldRaw }, errors);
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
  const seeded = await seedState(page);
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

// 7. Несовместимая попытка итогового контроля (PR #54): попытка прежнего
//    отпечатка отбрасывается validate — и до исправления исходная строка
//    сразу перезаписывалась очищенным прогрессом, ответы терялись молча.
//    Теперь исходная строка сохраняется отдельным разделом до перезаписи,
//    читателю показывается уведомление и копия, остальной прогресс работает,
//    переноса номеров вариантов по прежнему отпечатку нет. Попытка несёт
//    настоящие ответы по всем 37 модулям: копия и скачанный файл обязаны
//    содержать их целиком, а не пустые карты.
{
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  check('попытка: банк несёт ожидаемый текущий отпечаток', await page.evaluate(() => window.CourseQA.order) === CURRENT_ORDER, `order=${await page.evaluate(() => window.CourseQA.order)}`);
  const seeded = await seedState(page);
  const attempt = await seedLegacyExam(page, LEGACY_ORDER);
  await page.reload({ waitUntil: 'load' });
  const kept = await page.evaluate(key => localStorage.getItem(key), KEPT);
  check('попытка: исходная строка сохранена отдельным разделом', kept === attempt.raw);
  check('попытка: копия содержит настоящие ответы попытки', kept && JSON.parse(kept).exam.responses[attempt.probe.id] === attempt.probe.answer
    && JSON.parse(kept).exam.why[attempt.probe.id] === attempt.probe.why && JSON.parse(kept).exam.conf[attempt.probe.id] === attempt.probe.conf, `probe=${attempt.probe.id}`);
  const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  check('попытка: из активного прогресса удалена, номера не перенесены', after.exam === null);
  check('попытка: остальной прогресс цел', Object.keys(after.records).length === 1 && after.records[seeded.id]?.attempts === 1);
  const text = await note(page).textContent();
  check('попытка: уведомление объясняет и не винит версию банка', text.includes('попытка итогового контроля') && !text.includes('Банк заданий обновился'), text);
  check('попытка: есть путь скачать копию', await page.getByRole('button', { name: 'Скачать данные с попыткой (JSON)' }).count() === 1);
  // Скачивание: файл побайтово равен исходной строке — читатель уносит
  // попытку целиком, со всеми ответами, а не с пустыми картами.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать данные с попыткой (JSON)' }).click();
  const savedFile = await (await downloadPromise).path();
  const savedCopy = await readFile(savedFile, 'utf8');
  check('попытка: скачанная копия побайтово равна исходной строке', savedCopy === attempt.raw);
  // Перезагрузка: состояние стабильно, копия не теряется и не дублируется.
  await page.reload({ waitUntil: 'load' });
  check('попытка: копия пережила перезагрузку', await page.evaluate(key => localStorage.getItem(key), KEPT) === attempt.raw);
  check('попытка: активный прогресс стабилен', (await page.evaluate(key => JSON.parse(localStorage.getItem(key)).exam, KEY)) === null);
  // Последующее сохранение: новый ответ пишет новый прогресс, копия попытки
  // остаётся нетронутой — защита не превращается в потерю при первом ответе.
  const card = page.locator('#study-panel .card', { hasText: seeded.id }).first();
  await card.locator('.option input').first().check();
  await card.locator('fieldset.confidence input').first().check();
  await card.getByRole('button', { name: 'Ответить' }).click();
  const tier = card.locator('.reason-tier');
  await tier.locator('.option input').first().check();
  await tier.getByRole('button', { name: 'Проверить' }).click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  check('попытка: новый ответ записан в активный прогресс', saved.records[seeded.id]?.attempts === 2, `attempts=${saved.records[seeded.id]?.attempts}`);
  check('попытка: копия цела после сохранения', await page.evaluate(key => localStorage.getItem(key), KEPT) === attempt.raw);
}

// 8. Тот же дефект через импорт резервной копии: «Маршрут» пишет раздел
//    напрямую, и защита обязана сработать при первой же загрузке кабинета
//    после импорта, а не только при «естественном» устаревании попытки.
{
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  await seedState(page);
  const imported = await seedLegacyExam(page, LEGACY_ORDER);
  await page.evaluate(([key, kept]) => { localStorage.removeItem(key); localStorage.removeItem(kept); }, [KEY, KEPT]);
  const dir = mkdtempSync(join(tmpdir(), 'course-exam-'));
  const file = join(dir, 'course-backup.json');
  writeFileSync(file, JSON.stringify({ schema: 'course-backup', version: 1, exportedAt: new Date().toISOString(), data: { [KEY]: imported.raw } }));
  await page.goto(origin + '/route/', { waitUntil: 'load' });
  page.once('dialog', dialog => dialog.accept());
  await page.setInputFiles('[data-backup-load]', file);
  await page.waitForTimeout(600);
  check('импорт попытки: раздел записан из файла', await page.evaluate(key => localStorage.getItem(key), KEY) === imported.raw);
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  const kept = await page.evaluate(key => localStorage.getItem(key), KEPT);
  check('импорт попытки: копия создана при загрузке кабинета', kept === imported.raw);
  check('импорт попытки: копия содержит ответы из файла', kept && JSON.parse(kept).exam.responses[imported.probe.id] === imported.probe.answer, `probe=${imported.probe.id}`);
  const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
  check('импорт попытки: попытка не перенесена, остальной прогресс цел', after.exam === null && Object.keys(after.records).length === 1);
  const text = await note(page).textContent();
  check('импорт попытки: уведомление показано', text.includes('попытка итогового контроля'), text);
}

// 9. Копию попытки сохранить не вышло: исходная строка обязана остаться
//    нетронутой — защита сама не имеет права стать потерей данных.
{
  await page.goto(origin + '/assessment/', { waitUntil: 'load' });
  await seedState(page);
  const failed = await seedLegacyExam(page, LEGACY_ORDER);
  const { context: failing, page: page9 } = await quotaPage(browser, { key: KEY, value: failed.raw }, errors);
  await page9.goto(origin + '/assessment/', { waitUntil: 'load' });
  const after = await page9.evaluate(key => localStorage.getItem(key), KEY);
  check('ошибка копии: исходная строка с попыткой не перезаписана', after === failed.raw);
  check('ошибка копии: ответы попытки в исходной строке целы', after && JSON.parse(after).exam.responses[failed.probe.id] === failed.probe.answer, `probe=${failed.probe.id}`);
  const text = await note(page9).textContent();
  check('ошибка копии: статус честно сообщает недоступность и нетронутый оригинал', text.includes('недоступн') && text.includes('не перезаписаны'), text);
  check('ошибка копии: кабинет отрисован', (await page9.locator('#study-status').count()) === 1);
  await failing.close();
}

check('обход без клиентских исключений во всех контекстах', errors.length === 0, errors.join(' | '));
} catch (error) {
  // Отказ сценария — тоже проверка: он обязан попасть в отчёт, а не обрывать
  // его без итоговой строки и уборки окружения. Сюда входит и отказ подъёма
  // (newContext/newPage): он обязан пройти той же уборкой и ненулевым кодом.
  console.log(`FAIL аварийное завершение: ${error?.message ?? error}`);
  failures.push('аварийное завершение сценария');
} finally {
  await finish();
}
