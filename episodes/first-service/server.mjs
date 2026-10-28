import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import { dirname, resolve, join, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJSONObject } from './http-json.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../..');
const record = () => ({ prediction: '', predictions: [], observations: [], hints: 0, changes: 0, restarts: 0, checks: [], reflection: '' });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const limited = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(`Проверь поле «${label}» (до ${max} знаков).`);
  return value.trim();
};
const sparePort = async () => {
  const socket = createServer();
  await new Promise((ok, no) => { socket.once('error', no); socket.listen(0, '127.0.0.1', ok); });
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
};

export async function startWorkshop({ port = 4180, stateDir = join(project, '.episode-state/first-service') } = {}) {
  stateDir = resolve(stateDir);
  await mkdir(stateDir, { recursive: true });
  const lockPath = join(stateDir, 'owner.lock');
  try { await writeLock(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = Number(await readFile(lockPath, 'utf8'));
    try { process.kill(owner, 0); throw fail('Мастерская уже запущена. Открой http://127.0.0.1:4180 или останови прежний запуск.'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    await unlink(lockPath);
    await writeLock();
  }
  async function writeLock() { const file = await open(lockPath, 'wx'); try { await file.writeFile(String(process.pid)); } finally { await file.close(); } }
  const statePath = join(stateDir, 'progress.json');
  const notePath = join(stateDir, 'note.json');
  const serviceConfigPath = join(stateDir, 'service.json');
  const gatewayConfigPath = join(stateDir, 'gateway.json');
  const token = randomBytes(24).toString('hex');
  let state, child, busy = false, closing = false;
  let logs = [];
  let ports;
  const version = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8', windowsHide: true }).stdout?.trim() || 'без git';
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const code = { commit: version, server: sha256(await readFile(fileURLToPath(import.meta.url))), service: sha256(await readFile(join(here, 'service.mjs'))) };
  const persist = async () => { await writeFile(`${statePath}.tmp`, JSON.stringify(state, null, 2)); await rename(`${statePath}.tmp`, statePath); };
  const saveNote = async (note) => { await writeFile(`${notePath}.tmp`, JSON.stringify(note, null, 2)); await rename(`${notePath}.tmp`, notePath); };
  const note = async () => JSON.parse(await readFile(notePath, 'utf8'));
  const current = () => state.records[state.phase];
  const running = () => Boolean(child && child.exitCode === null && child.signalCode === null && !child.killed);
  const log = (line) => { logs.push(`${new Date().toISOString()} ${line}`); logs = logs.slice(-40); };
  const stop = async () => {
    if (!running()) return;
    const old = child;
    await new Promise((done) => { old.once('exit', done); old.kill(); });
  };
  const restart = async () => {
    if (current()) current().verified = false;
    await stop();
    await writeFile(serviceConfigPath, JSON.stringify({ listen: { host: '127.0.0.1', port: ports[state.config.service] } }, null, 2));
    await writeFile(gatewayConfigPath, JSON.stringify({ upstream: { host: '127.0.0.1', port: ports[state.config.gateway] } }, null, 2));
    child = spawn(process.execPath, [join(here, 'service.mjs')], {
      env: { ...process.env, WORKSHOP_CONFIG: serviceConfigPath, WORKSHOP_NOTE: notePath },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    });
    child.stdout.on('data', (data) => log(String(data).trim()));
    child.stderr.on('data', (data) => log(String(data).trim()));
    await new Promise((ok, no) => {
      const timer = setTimeout(() => no(fail('Процесс не сообщил о готовности за 5 секунд. Посмотри журнал.')), 5000);
      const finish = (error) => { clearTimeout(timer); child.off('message', ready); child.off('exit', exited); child.off('error', errored); error ? no(error) : ok(); };
      const ready = (message) => { if (message.ready) finish(); };
      const exited = (exit) => finish(fail(`Процесс завершился: ${exit}. Посмотри журнал.`));
      const errored = (error) => finish(error);
      child.once('message', ready); child.once('exit', exited); child.once('error', errored);
    });
    log(`Перезапуск завершён, PID ${child.pid}`);
  };
  const requestService = async (kind, path = '/health') => {
    const config = JSON.parse(await readFile(kind === 'gateway' ? gatewayConfigPath : serviceConfigPath, 'utf8'));
    const target = kind === 'gateway' ? config.upstream : config.listen;
    if (target.host !== '127.0.0.1' || !Object.values(ports).includes(target.port)) throw fail('Адрес в конфигурации выходит за пределы мастерской.');
    const address = `http://${target.host}:${target.port}${path}`;
    try {
      const response = await fetch(address, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      return { status: response.status, body: await response.text(), address };
    } catch (error) {
      return { status: 502, body: `Вход не получил ответ от ${address}\n${error.cause?.code ?? error.name}`, address };
    }
  };
  const snapshot = async () => ({ ...state, ports, running: running(), pid: running() ? child.pid : null, note: state.phase === 'welcome' ? null : await note() });
  const send = (response, status, body, type = 'application/json; charset=utf-8') => {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  const observed = (command) => { const stage = current(); if (stage && !stage.observations.includes(command)) stage.observations.push(command); };
  const commands = async (command) => {
    if (state.phase === 'welcome') throw fail('Сначала создай сервис.');
    let output;
    switch (command) {
      case 'status': output = running() ? `Процесс запущен\nPID: ${child.pid}\nЭто проверка процесса. Доступность через вход проверяется отдельным запросом.` : 'Процесс остановлен'; break;
      case 'journal': output = logs.join('\n') || 'Журнал этого запуска пока пуст.'; break;
      case 'config service': output = `service.json\n${await readFile(serviceConfigPath, 'utf8')}`; break;
      case 'config gateway': output = `gateway.json\n${await readFile(gatewayConfigPath, 'utf8')}`; break;
      case 'request public': { const result = await requestService('gateway'); output = `Путь: браузер → вход → сервис\nHTTP ${result.status}\n${result.body}`; break; }
      case 'request service': { const result = await requestService('service'); output = `Прямой запрос к сервису\n${result.address}\nHTTP ${result.status}\n${result.body}`; break; }
      case 'restart': { const oldPid = child?.pid; await restart(); current() && current().restarts++; output = `Перезапуск: PID ${oldPid ?? '—'} → ${child.pid}\nДанные страницы читаются из файла note.json.`; break; }
      case 'help': output = 'status — жив ли процесс\njournal — журнал запуска\nconfig service — где слушает сервис\nconfig gateway — куда направляет вход\nrequest public — запрос через вход\nrequest service — прямой запрос\nrestart — перезапуск сервиса'; break;
      default: throw fail('Неизвестная команда. Введи help. Здесь работают только команды мастерской.');
    }
    observed(command);
    state.transcript.push({ at: new Date().toISOString(), phase: state.phase, command, output });
    state.transcript = state.transcript.slice(-100);
    return { output };
  };

  const action = async (path, body) => {
    if (path === '/api/introduction') {
      if (!Number.isInteger(body.step) || body.step < 0 || body.step > 3) throw fail('Такой части вводного урока нет.');
      state.introduction.step = body.step;
      return {};
    }
    if (path === '/api/introduction-example') {
      const name = limited(body.name, 40, 'имя');
      state.introduction.example = { name, reply: `Привет, ${name}! Это ответ программы мастерской.`, at: new Date().toISOString() };
      state.introduction.requests++;
      return { example: state.introduction.example };
    }
    if (path === '/api/introduction-check') {
      if (!['browser', 'service', 'file'].includes(body.answer)) throw fail('Выбери один ответ.');
      const understood = body.answer === 'service';
      state.introduction.understood = understood;
      state.introduction.feedback = understood
        ? 'Да. Сервис принял запрос и подготовил ответ с заметкой. Браузер получил этот ответ и показал страницу на экране.'
        : body.answer === 'browser'
          ? 'Страницу на экране отображает браузер. Программа заметки принимает запрос и подготавливает ответ с её содержимым. Попробуй выбрать эту работу.'
          : 'В нашем опыте браузер обращается к программе заметки. Она читает файл и отправляет ответ; браузер показывает полученное. Вернись к схеме и попробуй ещё раз.';
      return { ok: understood };
    }
    if (path === '/api/introduction-complete') {
      if (!state.introduction.example || !state.introduction.understood) throw fail('Сначала попробуй запросить приветствие и проверь понимание в конце урока.');
      state.introduction.complete = true;
      state.introduction.completedAt ??= new Date().toISOString();
      return { message: state.phase === 'welcome' ? 'Теперь создадим страницу с твоей заметкой.' : 'Возвращаемся к твоей работе. Страница и записи сохранены.' };
    }
    if (path === '/api/create') {
      if (!state.introduction.complete) throw fail('Начни с вводного урока: он объясняет, какую программу мы создаём.');
      if (state.phase !== 'welcome') throw fail('Сервис уже создан.');
      await saveNote({ title: limited(body.title, 80, 'название'), message: 'Пока здесь пусто.', revision: 1 });
      state.phase = 'own'; await restart();
      return { message: 'Сервис создан. Добавь свою запись и проверь, переживёт ли она перезапуск.' };
    }
    if (state.phase === 'welcome') throw fail('Сначала создай сервис.');
    if (path === '/api/note') {
      const old = await note();
      await saveNote({ title: limited(body.title, 80, 'название'), message: limited(body.message, 1800, 'запись'), revision: old.revision + 1 });
      if (current()) current().verified = false;
      return { message: 'Запись сохранена в файл.' };
    }
    if (path === '/api/command') return commands(limited(body.command, 100, 'команда'));
    if (path === '/api/prediction') {
      if (!current()) throw fail('На этом шаге гипотеза уже сохранена в отчёте.');
      current().prediction = limited(body.text, 1000, 'гипотеза');
      current().predictedAt = new Date().toISOString();
      current().predictions ??= [];
      current().predictions.push({ text: current().prediction, at: current().predictedAt });
      return { message: 'Гипотеза сохранена. Проверь её наблюдением.' };
    }
    if (path === '/api/config') {
      if (!['guided', 'challenge'].includes(state.phase)) throw fail('Конфигурация открывается в эксперименте.');
      if (![body.service, body.gateway].every((slot) => ['blue', 'green'].includes(slot))) throw fail('Выбери один из портов мастерской.');
      state.config = { service: body.service, gateway: body.gateway };
      current().changes++; await restart(); current().restarts++;
      return { message: 'Конфигурация применена, сервис перезапущен. Проверь запрос через вход.' };
    }
    if (path === '/api/fault') {
      if (state.phase !== 'own' || !state.records.own.verified) throw fail('Сначала проверь свою страницу после перезапуска.');
      state.phase = 'guided'; state.config = { service: 'green', gateway: 'blue' }; await restart();
      return { message: 'Эксперимент начался. Проверь страницу через вход.' };
    }
    if (path === '/api/challenge') {
      if (state.phase !== 'guided' || !current().verified || current().reflection.length < 20) throw fail('Сначала восстанови сервис и сохрани короткий разбор.');
      state.phase = 'challenge'; state.config = { service: 'blue', gateway: 'green' }; await restart();
      return { message: 'Новая ситуация готова. Старый способ исправления сначала проверь по фактам.' };
    }
    if (path === '/api/hint') {
      if (!['guided', 'challenge'].includes(state.phase)) throw fail('Подсказки появятся в эксперименте.');
      current().hints = Math.min(3, current().hints + 1);
      return { message: [
        'Проверь отдельно две вещи: жив ли процесс и получает ли ответ запрос через вход.',
        'Журнал показывает, где сервис начал слушать. Конфигурация входа показывает, куда он обращается. Сравни адреса.',
        'Порт в config service и порт в config gateway должны совпадать. Исправь нужную настройку в конфигурации, затем повтори запрос через вход.',
      ][current().hints - 1] };
    }
    if (path === '/api/reflection') {
      if (!current()) throw fail('Этап уже завершён.');
      current().reflection = limited(body.text, 2200, 'разбор');
      return { message: 'Разбор сохранён. Текст остаётся твоим объяснением: автоматическая проверка оценивает работу сервиса.' };
    }
    if (path === '/api/check') {
      if (!current()) throw fail('Эпизод уже завершён.');
      const result = await requestService('gateway');
      const saved = await note(); let returned;
      try { returned = JSON.parse(result.body); } catch {}
      const healthy = running() && result.status === 200 && returned?.message === saved.message && returned?.title === saved.title && returned?.pid === child.pid;
      const stage = current();
      stage.verified = false;
      const checks = { at: new Date().toISOString(), pid: child?.pid ?? null, status: result.status, address: result.address, dataMatches: Boolean(healthy), revision: saved.revision };
      stage.checks.push(checks);
      if (!healthy) return { ok: false, message: `Проверка через вход: HTTP ${result.status}. Страница с сохранённой записью пока недоступна.`, checks };
      if (state.phase === 'own' && (saved.revision < 2 || stage.restarts < 1 || !stage.prediction)) return { ok: false, message: 'Сервис отвечает. Для опыта добавь свою запись, сохрани прогноз и выполни restart, затем проверь снова.', checks };
      if (state.phase !== 'own' && (!stage.prediction || !stage.observations.includes('request public') || !stage.observations.includes('status') || !stage.observations.some((x) => ['journal', 'config gateway', 'config service'].includes(x)))) return { ok: false, message: 'Сервис отвечает. Для разбора сохрани гипотезу и наблюдения: status, request public и журнал или конфигурацию.', checks };
      stage.verified = true;
      return { ok: true, message: 'HTTP 200. Через вход получена твоя сохранённая запись, PID совпадает с работающим процессом.', checks };
    }
    if (path === '/api/finish') {
      if (state.phase !== 'challenge' || !current().verified || current().reflection.length < 20) throw fail('Сначала проверь работу сервиса и сохрани объяснение хотя бы в одном предложении.');
      state.phase = 'complete'; state.finishedAt = new Date().toISOString();
      state.reviewDue = new Date(Date.now() + 86400000).toISOString();
      return { message: 'Эпизод завершён. Запись, журнал действий и разбор сохранены на этом компьютере.' };
    }
    if (path === '/api/repeat') {
      if (state.phase !== 'complete') throw fail('Сначала закончи текущий эпизод.');
      state.previousRuns.push({ finishedAt: state.finishedAt, records: structuredClone(state.records), reviewDue: state.reviewDue });
      state.phase = 'challenge'; state.records.challenge = record();
      const flip = randomInt(2); state.config = flip ? { service: 'blue', gateway: 'green' } : { service: 'green', gateway: 'blue' };
      await restart(); return { message: 'Новый вариант готов. Начни с наблюдений.' };
    }
    throw fail('Неизвестное действие.', 404);
  };

  let server;
  const close = async () => {
    if (closing) return; closing = true;
    await stop();
    if (server?.listening) await new Promise((done) => server.close(done));
    await unlink(lockPath).catch(() => {});
  };
  try {
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw fail('Не удалось прочитать progress.json. Сохранённые данные оставлены на месте.');
      state = { schema: 1, run: randomBytes(8).toString('hex'), phase: 'welcome', startedAt: new Date().toISOString(), config: { service: 'blue', gateway: 'blue' }, records: { own: record(), guided: record(), challenge: record() }, transcript: [], previousRuns: [], events: [] };
    }
    if (state.schema !== 1) throw fail('Неизвестная версия сохранённого эпизода.');
    // Старый опыт продолжается с теми же файлами; вводный урок добавляется отдельно.
    state.introduction ??= { step: 0, complete: false, requests: 0, understood: false };
    ports = { blue: await sparePort(), green: await sparePort() };
    while (ports.blue === ports.green) ports.green = await sparePort();
    if (state.phase !== 'welcome') await restart();
    server = createServer(async (request, response) => {
      try {
        const host = `127.0.0.1:${server.address().port}`;
        if (request.headers.host !== host) throw fail('Открой мастерскую по адресу 127.0.0.1.', 403);
        const path = new URL(request.url, `http://${host}`).pathname;
        if (request.method === 'POST') {
          if (request.headers.origin && request.headers.origin !== `http://${host}`) throw fail('Запрос из другого сайта отклонён.', 403);
          if (request.headers['x-workshop-token'] !== token) throw fail('Обнови страницу мастерской.', 403);
          if (!request.headers['content-type']?.startsWith('application/json')) throw fail('Ожидался JSON.', 415);
          const body = await readJSONObject(request);
          if (busy) throw fail('Предыдущее действие ещё выполняется.', 409);
          busy = true;
          try {
            const result = await action(path, body);
            state.events ??= [];
            state.events.push({ at: new Date().toISOString(), action: path, phase: state.phase, pid: running() ? child.pid : null, config: { ...state.config }, ok: result.ok });
            state.events = state.events.slice(-300);
            await persist(); send(response, 200, { ...result, state: await snapshot() });
          } finally { busy = false; }
          return;
        }
        if (request.method !== 'GET') throw fail('Метод не поддерживается.', 405);
        if (path === '/api/state') return send(response, 200, await snapshot());
        if (path === '/api/report') {
          response.setHeader('content-disposition', 'attachment; filename="first-service-report.json"');
          return send(response, 200, { exportedAt: new Date().toISOString(), code, ...await snapshot(), notePath, limits: 'Проверены HTTP-ответы, PID и содержимое файла. Свободное объяснение сохранено без автоматической оценки; это локальная лаборатория, не развёртывание на удалённом сервере.' });
        }
        if (path === '/public/' || path === '/public/health') {
          if (state.phase === 'welcome') return send(response, 503, 'Сначала создай сервис.', 'text/plain; charset=utf-8');
          const result = await requestService('gateway', path.endsWith('health') ? '/health' : '/');
          response.writeHead(result.status, { 'content-type': result.status !== 200 ? 'text/plain; charset=utf-8' : path.endsWith('health') ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          response.end(result.body);
          return;
        }
        // Та же сборка курса работает локально с API и на статической публикации без API.
        const buildRoot=join(project,'build');
        if(path==='/'||/^\/(?:learn|route|laboratory|progress|book|reference|assets|archive|downloads|chapters|start)\//.test(path)||path==='/sw-course.js'){
          const relative=decodeURIComponent(path).replace(/^\/+/,''),target=resolve(buildRoot,relative,path.endsWith('/')?'index.html':'');
          if(target.startsWith(buildRoot+sep)){
            try{
              let bytes=await readFile(target);
              const ext=extname(target),type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.py':'text/plain; charset=utf-8','.svg':'image/svg+xml'}[ext]??'application/octet-stream';
              if(ext==='.html')bytes=Buffer.from(bytes.toString('utf8').replace('__LOCAL_LAB_TOKEN__',token));
              response.writeHead(200,{'content-type':type,'cache-control':'no-store'});response.end(bytes);return;
            }catch(error){if(error.code!=='ENOENT')throw error;}
          }
        }
        const file = { '/': 'index.html', '/workshop/': 'index.html', '/app.js': 'app.js', '/introduction.js': 'introduction.js', '/style.css': 'style.css' }[path];
        if (!file) throw fail('Не найдено.', 404);
        const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
        let text = await readFile(join(here, file), 'utf8');
        if (file === 'index.html') text = text.replace('WORKSHOP_TOKEN', token);
        send(response, 200, text, type);
      } catch (error) {
        if (!error.status) console.error(error);
        if (!response.headersSent) send(response, error.status ?? 500, { error: error.status ? error.message : 'Ошибка мастерской. Смотри терминал запуска.' });
        else response.end();
      }
    });
    await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); });
    await persist();
    return { origin: `http://127.0.0.1:${server.address().port}`, close, stateDir };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const workshop = await startWorkshop({ port: Number(process.env.EPISODE_PORT ?? 4180), stateDir: process.env.EPISODE_STATE_DIR });
    console.log(`Мастерская: ${workshop.origin}\nДанные: ${workshop.stateDir}\nОстановить: Ctrl+C`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await workshop.close(); process.exit(0); });
  } catch (error) { console.error(error.code === 'EADDRINUSE' ? 'Порт 4180 занят. Задай EPISODE_PORT или останови прежний запуск.' : error.message); process.exitCode = 1; }
}
