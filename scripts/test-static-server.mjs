#!/usr/bin/env node
// Адресные проверки классификации ошибок общего статического сервера
// (scripts/static-server.mjs). Валидатор сайта занимается разметкой, а
// здесь — поведение раздачи при отказах самой файловой системы: обычное
// отсутствие, побег из root и ошибки серверной стороны обязаны различаться
// ответами. Ревью r4144506849 показало, что общий catch молча отдавал любой
// отказ как 404 — EACCES и EMFILE выглядели «файла нет» и прятали причину.
//
//   node scripts/test-static-server.mjs
//
// Инъекции настоящие, от ядра: EACCES — правами файла и каталога, EMFILE —
// исчерпанием дескрипторов в отдельном процессе с заниженным ulimit: один
// запасной дескриптор уходит на принимаемый сокет, и чтение файла отказывает
// уже на open. Так проверяется реальная классификация, а не её имитация.
// Применимость chmod-инъекций решается поведением, а не uid (r4145462782):
// прямое чтение защищённой фикстуры доказывает обход прав (root, среды с
// CAP_DAC_OVERRIDE при непривилегированном uid) — только тогда инъекция
// пропускается; иной отказ фикстуры SKIP'ом не скрыть.
import { mkdtemp, mkdir, writeFile, symlink, chmod, rm, readFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './static-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
let passed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (ok) passed += 1; else failures.push(name);
};
const skip = (name, why) => console.log(`SKIP ${name}: ${why}`);
const get = async (origin, path) => {
  const response = await fetch(origin + path);
  return { status: response.status, body: await response.text() };
};

const scratch = await mkdtemp(join(tmpdir(), 'static-server-'));
const root = join(scratch, 'site');
const outside = join(scratch, 'outside');
await mkdir(join(root, 'dir'), { recursive: true });
await mkdir(outside, { recursive: true });
await writeFile(join(root, 'index.html'), '<h1>index</h1>');
await writeFile(join(root, 'dir', 'page.html'), '<h1>page</h1>');
await writeFile(join(outside, 'secret.txt'), 'секрет снаружи root');
await symlink(join(outside, 'secret.txt'), join(root, 'escape.html'));
await symlink('index.html', join(root, 'inside.html'));
// Файл и каталог без прав: чтение и обход отказывают EACCES на любом
// непривилегированном пользователе.
await writeFile(join(root, 'denied.html'), 'закрыто');
await chmod(join(root, 'denied.html'), 0o000);
await mkdir(join(root, 'closed-dir'));
await writeFile(join(root, 'closed-dir', 'inner.html'), 'закрыто');
await chmod(join(root, 'closed-dir'), 0o000);

const { server, origin } = await startStaticServer(root);
try {
  const ok = await get(origin, '/');
  check('обычный файл отдаётся 200', ok.status === 200 && ok.body.includes('index'));
  const inside = await get(origin, '/inside.html');
  check('симлинк внутри root отдаётся 200', inside.status === 200, `статус ${inside.status}`);
  const missing = await get(origin, '/no-such-file.html');
  check('отсутствующий путь → 404', missing.status === 404 && missing.body === 'нет такого файла',
    `статус ${missing.status}, тело ${JSON.stringify(missing.body)}`);
  const notDir = await get(origin, '/index.html/inside');
  check('файл на месте компонента пути (ENOTDIR) → 404', notDir.status === 404, `статус ${notDir.status}`);

  // Защитные сценарии выноса из root. Обе encoded-пробы обязаны попадать
  // в существующий sibling-секрет — scratch/outside/secret.txt, ровно один
  // уровень над root (r4145462757): тогда 404 при работающем guard — это
  // решение границы, а не ENOENT мимо цели, и снятие guard раскрывает
  // секрет в encoded-кейсах, а не только симлинком. Глубина — один «..»:
  // два уровня поднимают выше sibling, а «/%2e%2e/../» fetch схлопывает в
  // путь внутри сайта ещё до запроса. Кодирование сохраняется на проводе:
  // сегменты «%2e%2e%2f…» и «..%2f…» не являются целиком «..»-сегментом,
  // нормализация URL их не трогает, и до сервера доходит исходный текст.
  for (const [name, path] of [
    ['закодированный выход «..»', '/%2e%2e%2foutside/secret.txt'],
    ['разделитель «%2f»', '/..%2foutside/secret.txt'],
    ['симлинк наружу', '/escape.html'],
  ]) {
    const probe = await get(origin, path);
    check(`${name} → 404 без содержимого`, probe.status === 404 && !probe.body.includes('секрет'),
      `статус ${probe.status}, тело ${JSON.stringify(probe.body.slice(0, 60))}`);
  }

  const malformed = await get(origin, '/%ZZ');
  check('битая процент-кодировка → 400', malformed.status === 400, `статус ${malformed.status}`);

  // Применимость chmod-инъекций — по поведению, отдельно для файла и
  // каталога: инъекция имеет смысл, когда фикстура не читается напрямую
  // (EACCES тем же процессом). Успешное чтение доказывает обход прав (root,
  // CAP_DAC_OVERRIDE у непривилегированного uid) — только тогда SKIP.
  // Иной отказ фикстуры — FAIL, а не SKIP: неожиданный 404 или чужой 500
  // нельзя прятать за «обходом прав», иначе скрывается регресс
  // классификации (r4145462782).
  let sawDenial = false;
  for (const [name, path, fixture] of [
    ['чтение файла без прав (EACCES readFile)', '/denied.html', join(root, 'denied.html')],
    ['обход каталога без прав (EACCES realpath)', '/closed-dir/inner.html', join(root, 'closed-dir', 'inner.html')],
  ]) {
    let direct;
    try { await readFile(fixture); direct = 'прочитана'; }
    catch (error) { direct = error?.code === 'EACCES' ? 'EACCES' : `отказ ${error?.code ?? error}`; }
    if (direct === 'EACCES') {
      sawDenial = true;
      const probe = await get(origin, path);
      check(`${name} → 500 без внутренних деталей`,
        probe.status === 500 && probe.body === 'внутренняя ошибка сервера' && !probe.body.includes(scratch),
        `статус ${probe.status}, тело ${JSON.stringify(probe.body.slice(0, 60))}`);
    } else if (direct === 'прочитана') {
      skip(name, 'обход прав доказан: защищённая фикстура читается напрямую в этой среде');
    } else {
      check(`${name}: фикстура готова к инъекции`, false, `прямое чтение — ${direct}`);
    }
  }
  if (sawDenial) {
    const after = await get(origin, '/dir/page.html');
    check('после 500 сервер продолжает раздачу', after.status === 200, `статус ${after.status}`);
  } else {
    skip('после 500 сервер продолжает раздачу', 'ни одна EACCES-инъекция не применима в этой среде');
  }

  // EMFILE: отдельный процесс с ulimit -n 64 занимает все дескрипторы,
  // освобождая ровно один — под принимаемый сокет. Первый же запрос к
  // существующему файлу отказывает на open: readFile получает EMFILE.
  const emfileRoot = join(scratch, 'emfile-site');
  await mkdir(emfileRoot);
  await writeFile(join(emfileRoot, 'index.html'), '<h1>emfile</h1>');
  await writeFile(join(emfileRoot, 'filler.bin'), 'заполнитель дескрипторов');
  const driver = join(scratch, 'emfile-driver.mjs');
  await writeFile(driver, `import { openSync, closeSync } from 'node:fs';
import { startStaticServer } from ${JSON.stringify(join(here, 'static-server.mjs'))};
const { server, origin } = await startStaticServer(process.argv[2]);
const held = [];
while (held.length < 100000) {
  try { held.push(openSync(process.argv[2] + '/filler.bin', 'r')); }
  catch (error) { if (error.code !== 'EMFILE') throw error; break; }
}
closeSync(held.pop()); // единственный запасной — на принимаемый сокет
console.log('READY ' + origin);
setTimeout(() => process.exit(3), 60000);
`);
  const emfile = await new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', `ulimit -n 64; exec node ${JSON.stringify(driver)} ${JSON.stringify(emfileRoot)}`]);
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 30000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('READY')) { clearTimeout(timer); resolve({ child, origin: out.match(/READY (\S+)/)[1] }); }
    });
    child.on('exit', () => { clearTimeout(timer); if (!out.includes('READY')) resolve(null); });
  });
  if (!emfile) check('исчерпание дескрипторов (EMFILE) → 500', false, 'потомок не поднялся или не исчерпал дескрипторы');
  else {
    try {
      const probe = await get(emfile.origin, '/index.html');
      check('исчерпание дескрипторов (EMFILE) → 500 без внутренних деталей',
        probe.status === 500 && probe.body === 'внутренняя ошибка сервера' && !probe.body.includes(scratch),
        `статус ${probe.status}, тело ${JSON.stringify(probe.body.slice(0, 60))}`);
    } finally { emfile.child.kill('SIGKILL'); }
  }
} finally {
  server.close();
  await chmod(join(root, 'closed-dir'), 0o755).catch(() => {});
  await chmod(join(root, 'denied.html'), 0o644).catch(() => {});
  await rm(scratch, { recursive: true, force: true }).catch(() => {});
}

console.log(failures.length ? `\nПровалено проверок: ${failures.length} (${failures.join(', ')})` : `\nВсе ${passed} проверок static-server пройдены.`);
process.exit(failures.length ? 1 : 0);
