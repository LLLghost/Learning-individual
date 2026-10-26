// Проверяем весь опыт через интерфейс и реальные HTTP-ответы отдельного процесса.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { startWorkshop } from '../episodes/first-service/server.mjs';
import { launchBrowser } from './browser-launch.mjs';

const stateDir = await mkdtemp(join(tmpdir(), 'mayak-episode-'));
const output = resolve('work/episode-evidence');
await mkdir(output, { recursive: true });
let workshop, browser, page;
const evidence = [];
const errors = [];
const noteText = 'Мой первый сервис: здесь будет журнал домашней лаборатории.';
try {
  workshop = await startWorkshop({ port: 0, stateDir });
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(workshop.origin);
  await page.waitForSelector('[data-phase="introduction"]');
  let token = await page.locator('meta[name="workshop-token"]').getAttribute('content');
  const getState = async () => (await page.request.get(`${workshop.origin}/api/state`)).json();
  const api = (path, data, extra = {}) => page.request.post(`${workshop.origin}/api/${path}`, { headers: { 'x-workshop-token': token, ...extra }, data });
  const uiAction = async (selector, endpoint) => {
    const previous = await page.locator('#workspace').getAttribute('data-render');
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url() === `${workshop.origin}/api/${endpoint}` && response.request().method() === 'POST'),
      page.locator(selector).click(),
    ]);
    const body = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(body));
    await page.waitForFunction((old) => Number(document.querySelector('#workspace').dataset.render) > Number(old), previous);
    return body;
  };
  const command = (value) => uiAction(`[data-command="${value}"]`, 'command');
  const prediction = async (text) => { await page.locator('#prediction').fill(text); await uiAction('#prediction-form button', 'prediction'); };
  const reflection = async (text) => { await page.locator('#reflection').fill(text); await uiAction('#reflection-form button', 'reflection'); };
  const configure = async (service, gateway) => {
    await page.locator('#config-details').evaluate((element) => { element.open = true; });
    await page.locator('#service-port').selectOption(service);
    await page.locator('#gateway-port').selectOption(gateway);
    await uiAction('#config-form button', 'config');
  };
  async function introduction() {
    await page.setViewportSize({ width: 1440, height: 1080 });
    assert.equal(await page.locator('#create-form').count(), 0);
    assert.equal((await api('introduction-complete', {})).status(), 400);
    await page.screenshot({ path: join(output, '00-introduction.png'), fullPage: true, animations: 'disabled' });
    await uiAction('[data-intro-step="1"]', 'introduction');
    await page.locator('#intro-name').fill('Антон');
    await uiAction('#intro-example-form button', 'introduction-example');
    assert.match(await page.locator('.lesson-exchange').innerText(), /Привет, Антон!/);
    await page.locator('#intro-name').fill('Гость');
    await uiAction('#intro-example-form button', 'introduction-example');
    assert.match(await page.locator('.lesson-exchange').innerText(), /Привет, Гость!/);
    await page.reload();
    await page.waitForSelector('#intro-example-form');
    assert.match(await page.locator('.lesson-exchange').innerText(), /Привет, Гость!/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, '00-introduction-mobile.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1080 });
    await uiAction('[data-intro-step="2"]', 'introduction');
    await uiAction('[data-intro-step="3"]', 'introduction');
    await page.locator('[name="answer"][value="browser"]').check();
    assert.equal((await uiAction('#intro-check-form button', 'introduction-check')).ok, false);
    assert.equal(await page.locator('[data-action="introduction-complete"]').count(), 0);
    await page.locator('[name="answer"][value="service"]').check();
    assert.equal((await uiAction('#intro-check-form button', 'introduction-check')).ok, true);
    await uiAction('[data-action="introduction-complete"]', 'introduction-complete');
  }
  assert.equal((await api('create', { title: 'Слишком рано' })).status(), 400);
  await introduction();
  await page.waitForSelector('#create-form');
  await page.screenshot({ path: join(output, '01-welcome.png'), fullPage: true });
  evidence.push('Вводный урок: четыре части, реальные запросы приветствия, сохранение места чтения, разбор неверного ответа и переход к практике.');
  assert.equal((await page.request.post(`${workshop.origin}/api/create`, { data: { title: 'Чужой запрос' } })).status(), 403);
  assert.equal((await api('create', { title: 'Чужой запрос' }, { origin: 'https://example.invalid' })).status(), 403);
  await page.locator('#title').fill('Домашняя лаборатория');
  await uiAction('#create-form button', 'create');
  assert.equal((await uiAction('#check', 'check')).ok, false);
  await page.locator('#note-message').fill(noteText);
  await uiAction('#note-form button', 'note');
  await prediction('Думаю, запись останется: она сохранена в файл, а перезапуск заменит только процесс.');
  const oldPid = (await getState()).pid;
  await command('restart');
  assert.notEqual((await getState()).pid, oldPid);
  assert.equal((await uiAction('#check', 'check')).ok, true);
  assert.equal(JSON.parse(await readFile(join(stateDir, 'note.json'), 'utf8')).message, noteText);
  assert.equal((await page.request.get(`${workshop.origin}/public/health`)).status(), 200);
  assert.equal((await api('command', { command: 'node --version' })).status(), 400);
  evidence.push('Своя запись сохранена в файле и получена через вход после смены PID.');

  await uiAction('[data-action="fault"]', 'fault');
  assert.equal((await getState()).running, true);
  assert.equal((await page.request.get(`${workshop.origin}/public/health`)).status(), 502);
  assert.equal((await uiAction('#check', 'check')).ok, false);
  await prediction('Процесс может быть жив, но вход обращается по другому адресу. Сравню журнал и конфигурацию входа.');
  await command('status'); await command('request public'); await command('journal'); await command('config gateway');
  await page.screenshot({ path: join(output, '02-investigation.png'), fullPage: true });
  assert.equal((await api('config', { service: '../../bad', gateway: 'blue' })).status(), 400);
  await configure('blue', 'green');
  assert.equal((await uiAction('#check', 'check')).ok, false);
  await configure('blue', 'blue');
  assert.equal((await uiAction('#check', 'check')).ok, true);
  await reflection('В журнале процесс слушал другой порт, чем использовал вход. Я согласовал адреса и получил запись через вход: HTTP 200.');
  evidence.push('В первом инциденте живой процесс даёт 502; неверная правка отклонена, согласование портов даёт 200.');

  await uiAction('[data-action="challenge"]', 'challenge');
  assert.equal((await api('finish', {})).status(), 400);
  await prediction('Проверю оба адреса: знакомый симптом не доказывает, что снова изменился именно порт сервиса.');
  await command('status'); await command('request public'); await command('config service'); await command('config gateway');
  await configure('blue', 'green');
  assert.equal((await uiAction('#check', 'check')).ok, false);
  await configure('blue', 'blue');
  assert.equal((await uiAction('#check', 'check')).ok, true);
  // После успешной проверки новая поломка должна аннулировать старый зачёт.
  await configure('green', 'blue');
  assert.equal((await api('finish', {})).status(), 400);
  await configure('blue', 'blue');
  assert.equal((await uiAction('#check', 'check')).ok, true);
  await reflection('Во второй задаче сервис слушал прежний порт, а изменилось назначение входа. Исправил назначение и проверил ответ с моей записью через вход.');
  await uiAction('[data-action="finish"]', 'finish');
  assert.equal(await page.locator('#workspace').getAttribute('data-phase'), 'complete');
  const report = await (await page.request.get(`${workshop.origin}/api/report`)).json();
  assert.equal(report.records.challenge.hints, 0);
  assert.equal(report.note.message, noteText);
  assert.equal(report.records.challenge.verified, true);
  assert.equal(report.records.challenge.checks.at(-1).status, 200);
  await page.reload();
  await page.waitForSelector('[data-phase="complete"]');
  await page.frameLocator('iframe').getByRole('heading', { name: 'Домашняя лаборатория' }).waitFor();
  await page.screenshot({ path: join(output, '03-complete.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(output, '04-mobile.png'), fullPage: true });
  await page.locator('iframe').scrollIntoViewIfNeeded();
  await page.frameLocator('iframe').getByText(noteText).waitFor();
  await page.screenshot({ path: join(output, '05-mobile-service.png') });
  evidence.push('Вторая ситуация решена по новому адресу; повторная поломка аннулирует старую проверку. Отчёт экспортируется.');

  const finalPid = (await getState()).pid;
  await workshop.close(); workshop = null;
  assert.throws(() => process.kill(finalPid, 0), (error) => error.code === 'ESRCH');
  workshop = await startWorkshop({ port: 0, stateDir });
  await page.goto(workshop.origin);
  await page.waitForSelector('[data-phase="complete"]');
  token = await page.locator('meta[name="workshop-token"]').getAttribute('content');
  const resumed = await getState();
  assert.equal(resumed.introduction.complete, true);
  assert.equal(resumed.note.message, noteText);
  assert.equal(resumed.records.challenge.reflection, report.records.challenge.reflection);
  await assert.rejects(startWorkshop({ port: 0, stateDir }), /уже запущена/);
  // Обновление существующей мастерской добавляет урок, сохраняя сделанную работу.
  await workshop.close(); workshop = null;
  const legacy = JSON.parse(await readFile(join(stateDir, 'progress.json'), 'utf8'));
  delete legacy.introduction;
  await writeFile(join(stateDir, 'progress.json'), JSON.stringify(legacy));
  workshop = await startWorkshop({ port: 0, stateDir });
  await page.goto(workshop.origin);
  await page.waitForSelector('[data-phase="introduction"]');
  token = await page.locator('meta[name="workshop-token"]').getAttribute('content');
  assert.equal((await getState()).note.message, noteText);
  assert.equal((await getState()).phase, 'complete');
  await introduction();
  await page.waitForSelector('[data-phase="complete"]');
  assert.equal((await getState()).records.challenge.reflection, report.records.challenge.reflection);
  evidence.push('Добавление вводного урока к старому сохранению не удаляет страницу, заметку и результаты практики.');
  await uiAction('[data-action="repeat"]', 'repeat');
  const repeat = await getState();
  assert.equal(repeat.records.challenge.reflection, '');
  assert.equal(repeat.previousRuns[0].records.challenge.reflection, report.records.challenge.reflection);
  assert.equal((await page.request.get(`${workshop.origin}/public/health`)).status(), 502);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  evidence.push('После остановки мастерской дочерний процесс завершён; новый запуск восстановил страницу и разбор. Повторение сохранило предыдущий результат.');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({ at: new Date().toISOString(), evidence, report, pageErrors: errors, mobileWidth: 390 }, null, 2));
  console.log('Вводный урок: 4 части, запрос и ответ, неверный ответ разобран; прогресс сохраняется.');
  console.log('Эпизод: вводный урок и 3 этапа пройдены в Chromium; HTTP 502 → 200 в обоих инцидентах.');
  console.log('Проверены: реальный перезапуск, файл записи, неверная правка, устаревший зачёт, сохранение и повторение, экспорт, мобильная ширина 390 px.');
  console.log('Ошибок JavaScript: 0. Чужие запросы и произвольные команды отклонены.');
  console.log(`Доказательства: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('Ошибки страницы:', errors);
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 2500));
  }
  throw error;
} finally {
  await browser?.close(); await workshop?.close();
  const checked = resolve(stateDir);
  if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('mayak-episode-')) throw Error('Временный каталог оказался вне ожидаемой области.');
  await rm(checked, { recursive: true, force: true });
}
