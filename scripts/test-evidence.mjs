import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, cp, writeFile, appendFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyEvidence } from './verify-evidence.mjs';

test('evidence registry distinguishes normalized text from exact archive bytes', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mayak-evidence-format-'));
  const digest = value => createHash('sha256').update(value).digest('hex');
  const registry = async hashes => writeFile(join(folder, 'summary.json'), JSON.stringify({ evidenceHashes: hashes }));
  try {
    await writeFile(join(folder, 'note.txt'), 'line\r\n');
    const archive = Buffer.from([255, 13, 10, 0]);
    await writeFile(join(folder, 'sample.tgz'), archive);
    await registry({ 'note.txt': digest('line\n'), 'sample.tgz': digest(archive) });
    assert.equal(await verifyEvidence(folder), 2);
    await appendFile(join(folder, 'sample.tgz'), 'changed');
    await assert.rejects(verifyEvidence(folder), /Evidence hash mismatch: sample.tgz/);
    await registry({});
    await assert.rejects(verifyEvidence(folder), /Empty evidence hash registry/);
    await registry({ '../outside.txt': digest('outside') });
    await assert.rejects(verifyEvidence(folder), /Evidence path outside directory/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('release verification rejects changed evidence even when report checks still pass', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mayak-evidence-'));
  try {
    for (const directory of ['quality', 'content/course', 'build/assets']) await mkdir(join(folder, directory), { recursive: true });
    await writeFile(join(folder, 'package.json'), '{"type":"module"}');
    for (const file of ['quality/live-acceptance.json', 'content/course/assessments.json', 'build/assets/checker.js']) await cp(file, join(folder, file));
    const evidence = 'quality/live-labs/2026-10-27';
    await cp(evidence, join(folder, evidence), { recursive: true });
    const run = () => spawnSync(process.execPath, [resolve('scripts/verify-live-reports.mjs')], { cwd: folder, encoding: 'utf8' });
    const intact = run();
    assert.equal(intact.status, 0, intact.stderr);
    await appendFile(join(folder, evidence, 'README.md'), '\nChanged evidence\n');
    const tampered = run();
    assert.notEqual(tampered.status, 0, 'Changed evidence passed the release verifier');
    assert.match(tampered.stderr, /Evidence hash mismatch: README.md/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
