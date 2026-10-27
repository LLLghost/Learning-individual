import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProgress, newProgress } from '../content/course/ui/progress-state.js';

test('first visit and a saved valid journey retain their meaning', () => {
  assert.deepEqual(loadProgress(null), { state: newProgress(), recovery: false });
  const state = newProgress();
  state.lessons.why = { note: 'Моя запись', read: true };
  state.results.question = { correct: true };
  state.reports.lab = { verified: false, historical: true };
  state.history.push({ kind: 'answer', id: 'old', value: { correct: true } });
  state.legacy.previous = 'старые записи';
  assert.deepEqual(loadProgress(JSON.stringify(state)), { state, recovery: false });
});
test('broken JSON and wrong top-level formats require a recovery copy', () => {
  for (const raw of ['', '{', 'null', '[]', '42', '"text"', '{"schema":"old"}']) {
    assert.deepEqual(loadProgress(raw), { state: newProgress(), recovery: true });
  }
});
test('malformed collections and records do not erase usable notes', () => {
  const input = { ...newProgress(), lessons: { why: { note: 'Сохранить' }, bad: null, array: [], text: 'x' },
    results: null, reports: [], history: {}, legacy: null };
  const result = loadProgress(JSON.stringify(input));
  assert.equal(result.recovery, true);
  assert.deepEqual(result.state.lessons, { why: { note: 'Сохранить' } });
  assert.deepEqual(result.state.results, {});
  assert.deepEqual(result.state.reports, {});
  assert.deepEqual(result.state.history, []);
  assert.deepEqual(result.state.legacy, {});
});
