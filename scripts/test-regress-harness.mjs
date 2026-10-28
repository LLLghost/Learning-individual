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
// бы цикл событий живым. Уборка проверяется и наблюдаемо (r4145462744):
// каркас печатает маркер из колбэка close до выхода, и тест требует его
// у обоих потребителей — удаление close лишает маркер носителя, и код 2
// больше не засчитывается как уборка. Собственный scratch тест убирает
// в finally до выхода на обоих путях (r4145462764): без этого process.exit
// оставлял бы каталоги regress-harness-* в /tmp после каждого прогона.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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
// cleanup описывает, что успело создаться до отказа: «server» — сервер
// (тогда обязателен и маркер его закрытия), «none» — ничего (маркера быть
// не должно, иначе он печатался бы без всякой уборки и доказывал нуль).
const expectStartupFailure = (name, result, cause, cleanup) => {
  check(`${name}: код выхода 2`, result.code === 2, `код ${result.code ?? 'процесс не завершился сам'}${result.timedOut ? ' (убит по таймауту)' : ''}`);
  check(`${name}: причина напечатана в stderr`, result.err.includes('Не удалось поднять окружение регрессий') && result.err.includes(cause),
    `stderr: ${JSON.stringify(result.err.slice(0, 200))}`);
  check(`${name}: без сырого стека`, !/^\s+at /m.test(result.err) && !result.err.includes('Error: ENOENT'),
    `stderr: ${JSON.stringify(result.err.slice(0, 200))}`);
  check(`${name}: сценарии не начинались`, !result.out.includes('PASS ') && !result.out.includes('FAIL '),
    `stdout: ${JSON.stringify(result.out.slice(0, 200))}`);
  if (cleanup === 'server') {
    check(`${name}: сервер закрыт до выхода (маркер уборки)`, result.err.includes('сервер окружения закрыт до выхода'),
      `маркер close отсутствует в stderr: ${JSON.stringify(result.err.slice(0, 200))}`);
  } else {
    check(`${name}: маркер уборки не печатается без сервера`, !result.err.includes('сервер окружения закрыт до выхода'),
      `маркер close в stderr без созданного сервера: ${JSON.stringify(result.err.slice(0, 200))}`);
  }
};

const consumers = ['regress-cabinet.mjs', 'regress-progress.mjs'];
const scratch = await mkdtemp(join(tmpdir(), 'regress-harness-'));
// Весь жизненный цикл фикстур — под try/finally: scratch убирается и при
// полном успехе, и при неожиданном отказе проверки, до итогового exit
// (r4145462764). finally с await выполняется до process.exit — иначе
// принудительный выход обрывал бы уборку, и каждый прогон оставлял бы
// после себя каталоги regress-harness-*.
try {
  // Случай «нет собранного сайта»: пустой cwd — startStaticServer отказывает
  // на realpath несуществующего build ещё до браузера. Сервер не создан,
  // поэтому и маркера уборки быть не должно.
  const emptyDir = join(scratch, 'no-build');
  await mkdir(emptyDir);
  for (const script of consumers) {
    const result = await run(script, emptyDir);
    expectStartupFailure(`${script} без build`, result, 'build', 'none');
  }

  // Случай «отказ браузера»: build есть и сервер создаётся, CHROMIUM_PATH
  // указывает на несуществующий бинарник — отказ происходит после старта
  // сервера, и убран должен быть именно он.
  const withBuild = join(scratch, 'broken-browser');
  await mkdir(join(withBuild, 'build'), { recursive: true });
  for (const script of consumers) {
    const result = await run(script, withBuild, { CHROMIUM_PATH: join(scratch, 'no-such-chromium') });
    expectStartupFailure(`${script} при отказе браузера`, result, 'no-such-chromium', 'server');
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log(failures.length ? `\nПровалено проверок: ${failures.length} (${failures.join(', ')})` : `\nВсе ${passed} проверок regress-harness пройдены.`);
process.exit(failures.length ? 1 : 0);
