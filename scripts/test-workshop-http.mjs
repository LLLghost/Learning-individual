import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { test, before, after } from 'node:test';
import { startWorkshop } from '../episodes/first-service/server.mjs';

let workshop, stateDir, token;
before(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'mayak-http-'));
  workshop = await startWorkshop({ port: 0, stateDir });
  const html = await (await fetch(`${workshop.origin}/workshop/`)).text();
  token = html.match(/name="workshop-token" content="([^"]+)"/)[1];
});
after(async () => {
  await workshop?.close();
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
});

async function post(parts) {
  return new Promise((resolve, reject) => {
    const req = request(`${workshop.origin}/api/introduction-example`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workshop-token': token },
    }, async res => {
      try {
        const chunks = [];
        for await (const chunk of res) chunks.push(chunk);
        resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch (error) { reject(error); }
    });
    req.on('error', reject);
    (async () => {
      for (const part of parts) { req.write(part); await pause(30); }
      req.end();
    })().catch(reject);
  });
}

test('HTTP preserves a Russian name split inside a UTF-8 character', async () => {
  const bytes = Buffer.from(JSON.stringify({ name: 'Антон' }));
  const split = bytes.indexOf(Buffer.from('А')) + 1;
  const result = await post([bytes.subarray(0, split), bytes.subarray(split)]);
  assert.equal(result.status, 200);
  assert.equal(result.body.example.name, 'Антон');
  const saved = await (await fetch(`${workshop.origin}/api/state`)).json();
  assert.equal(saved.introduction.example.name, 'Антон');
});

test('JSON null is a client error and does not change the saved name', async () => {
  const before = await (await fetch(`${workshop.origin}/api/state`)).json();
  const result = await post([Buffer.from('null')]);
  assert.equal(result.status, 400);
  const after = await (await fetch(`${workshop.origin}/api/state`)).json();
  assert.deepEqual(after.introduction, before.introduction);
});

test('oversized and malformed JSON requests are rejected', async () => {
  assert.equal((await post([Buffer.from(JSON.stringify({ name: 'x'.repeat(12000) }))])).status, 413);
  assert.equal((await post([Buffer.from('{')])).status, 400);
});
