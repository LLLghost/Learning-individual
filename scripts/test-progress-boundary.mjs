import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { createServer } from 'node:http';
import { launchBrowser } from './browser-launch.mjs';

const key = 'mayak-course-progress-v7';
const root = resolve('build'), base = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (base && !path.startsWith(base + '/')) throw Error('Outside base');
    const relative = path.slice(base.length);
    const file = resolve(root, '.' + relative + (relative.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + sep)) throw Error('Outside build');
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' }[extname(file)] ?? 'text/html; charset=utf-8' }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
let browser;
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}${base}`;
  browser = await launchBrowser();
  for (const invalid of [{ lessons: null }, { reports: { broken: null } }, { results: { broken: null } }]) {
    const original = JSON.stringify({ schema: 'course-journey-v7', version: 7,
      lessons: { why: { startedAt: 1, note: 'Моя запись', read: true } }, results: {}, reports: {}, history: [], legacy: {}, ...invalid });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(({ key, original }) => {
      if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, original); sessionStorage.setItem('seeded', 'yes'); }
    }, { key, original });
    await page.goto(`${origin}/learn/why/`);
    await page.waitForSelector('body[data-course-ready="true"]', { timeout: 3000 });
    const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    assert.ok(Object.entries(stored).some(([name, value]) => name.startsWith(`${key}-recovery-`) && value === original), 'Original progress must be recoverable');
    assert.ok(Object.values(JSON.parse(stored[key]).legacy).includes(original), 'Recovery copy must be included in the export data');
    if (invalid.lessons !== null) assert.equal(JSON.parse(stored[key]).lessons.why.note, 'Моя запись');
    assert.match(await page.locator('#notice').innerText(), /копия/);
    await page.reload();
    await page.waitForSelector('body[data-course-ready="true"]');
    await context.close();
  }
  console.log('Corrupt progress: course opens, original backed up, valid notes retained, reload OK (3 cases).');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
