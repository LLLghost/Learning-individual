import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJSONObject } from '../episodes/first-service/http-json.mjs';

async function* chunks(...parts) { yield* parts.map(part => Buffer.isBuffer(part) ? part : Buffer.from(part)); }

test('a complete object at the byte limit is accepted', async () => {
  assert.deepEqual(await readJSONObject(chunks('{}'), 2), {});
});
test('the byte limit applies across chunks and to multibyte text', async () => {
  await assert.rejects(readJSONObject(chunks('{', ' "x": 1}'), 2), { status: 413 });
  const text = '{"имя":"я"}';
  await assert.rejects(readJSONObject(chunks(text), text.length), { status: 413 });
});
test('a split UTF-8 letter is decoded after all bytes arrive', async () => {
  const bytes = Buffer.from('{"name":"я"}');
  const offset = bytes.indexOf(Buffer.from('я')) + 1;
  assert.deepEqual(await readJSONObject(chunks(bytes.subarray(0, offset), bytes.subarray(offset))), { name: 'я' });
});
test('only JSON objects enter the action handler', async () => {
  for (const value of ['null', '[]', '"text"', '42', 'true', '']) {
    await assert.rejects(readJSONObject(chunks(value)), { status: 400 });
  }
});
test('malformed UTF-8 is rejected instead of saving replacement letters', async () => {
  await assert.rejects(readJSONObject(chunks(Buffer.from([123,34,120,34,58,34,255,34,125]))), { status: 400 });
});
