import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('link checking uses the current course and distinguishes unavailable responses', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mayak-links-'));
  try {
    await mkdir(join(folder, 'public'));
    await writeFile(join(folder, 'public/course.html'), '<a href="https://old.example/">Archive</a>');
    const links = ['live', 'missing', 'blocked', 'network'];
    await writeFile(join(folder, 'public/practical-course.html'), links.map(id => `<a href="https://${id}.example/">${id}</a>`).join(''));
    const mock = `globalThis.fetch=async url=>{if(url.includes('network'))throw Object.assign(new Error('offline'),{code:'ENETUNREACH'});return {ok:url.includes('live'),status:url.includes('missing')?404:url.includes('blocked')?403:200,url};}`;
    const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mock)}`, resolve('scripts/check-links.mjs')], { cwd: folder, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Внешних ссылок: 4/);
    assert.match(result.stdout, /МЁРТВА 404.*missing/);
    assert.match(result.stdout, /ЗАКРЫТ 403.*blocked/);
    assert.match(result.stdout, /НЕЯСНО ENETUNREACH.*network/);
    assert.doesNotMatch(result.stdout, /old\.example/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
