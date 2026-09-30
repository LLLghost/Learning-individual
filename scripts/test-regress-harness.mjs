#!/usr/bin/env node
// Проверки штатного отказа каркаса регрессий (scripts/regress-harness.mjs).
// Оба потребителя каркаса — regress-cabinet и regress-progress — обязаны
// отказываться до старта сценариев одинаково: причина в console.error,
// код выхода 2, сценарии не начинаются. Ревью r4144506849: старт сервера
// стоял вне общей охраны, и отсутствующий build ронял прогон сырым стеком
// с кодом 1 — как будто ошибку поймал сам сценарий.
//
//   node scripts/test-regress-harness.mjs
//
// Оба случая поднимаются на настоящих потребителях каркаса в отдельных
// каталогах: «нет build» — пустой cwd, «отказ браузера» — CHROMIUM_PATH на
// несуществующий бинарник при существующем build (сервер успевает
// создаться и обязан быть убран). Самостоятельный выход процесса за время
// ожидания и есть доказательство уборки: висящий сервер без выхода держал
// бы цикл событий живым.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
let passed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (ok) passed += 1; else failures.push(name);
};

const run = (script, cwd, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [join(here, script)], { cwd, env: { ...process.env, ...env } });
  let out = '';
  let err = '';
  const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, out, err, timedOut: true }); }, 60000);
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});

// Штатный отказ: код 2, причина напечатана, стека нет, сценарии не начаты.
const expectStartupFailure = (name, result, cause) => {
  check(`${name}: код выхода 2`, result.code === 2, `код ${result.code ?? 'процесс не завершился сам'}${result.timedOut ? ' (убит по таймауту)' : ''}`);
  check(`${name}: причина напечатана в stderr`, result.err.includes('Не удалось поднять окружение регрессий') && result.err.includes(cause),
    `stderr: ${JSON.stringify(result.err.slice(0, 200))}`);
  check(`${name}: без сырого стека`, !/^\s+at /m.test(result.err) && !result.err.includes('Error: ENOENT'),
    `stderr: ${JSON.stringify(result.err.slice(0, 200))}`);
  check(`${name}: сценарии не начинались`, !result.out.includes('PASS ') && !result.out.includes('FAIL '),
    `stdout: ${JSON.stringify(result.out.slice(0, 200))}`);
};

const consumers = ['regress-cabinet.mjs', 'regress-progress.mjs'];
const scratch = await mkdtemp(join(tmpdir(), 'regress-harness-'));

// Случай «нет собранного сайта»: пустой cwd — startStaticServer отказывает
// на realpath несуществующего build ещё до браузера.
const emptyDir = join(scratch, 'no-build');
await mkdir(emptyDir);
for (const script of consumers) {
  const result = await run(script, emptyDir);
  expectStartupFailure(`${script} без build`, result, 'build');
}

// Случай «отказ браузера»: build есть и сервер создаётся, CHROMIUM_PATH
// указывает на несуществующий бинарник — отказ происходит после старта
// сервера, и убран должен быть именно он.
const withBuild = join(scratch, 'broken-browser');
await mkdir(join(withBuild, 'build'), { recursive: true });
for (const script of consumers) {
  const result = await run(script, withBuild, { CHROMIUM_PATH: join(scratch, 'no-such-chromium') });
  expectStartupFailure(`${script} при отказе браузера`, result, 'no-such-chromium');
}

console.log(failures.length ? `\nПровалено проверок: ${failures.length} (${failures.join(', ')})` : `\nВсе ${passed} проверок regress-harness пройдены.`);
process.exit(failures.length ? 1 : 0);
