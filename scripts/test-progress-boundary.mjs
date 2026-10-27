import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorkshop } from '../episodes/first-service/server.mjs';
import { launchBrowser } from './browser-launch.mjs';

const key = 'mayak-course-progress-v7';
const stateDir = await mkdtemp(join(tmpdir(), 'mayak-progress-'));
let workshop, browser;
try {
  workshop = await startWorkshop({ port: 0, stateDir });
  browser = await launchBrowser();
  for (const invalid of [{ lessons: null }, { reports: { broken: null } }, { results: { broken: null } }]) {
    const original = JSON.stringify({ schema: 'course-journey-v7', version: 7,
      lessons: { why: { note: 'Моя запись', read: true } }, results: {}, reports: {}, history: [], legacy: {}, ...invalid });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(({ key, original }) => {
      if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, original); sessionStorage.setItem('seeded', 'yes'); }
    }, { key, original });
    await page.goto(`${workshop.origin}/learn/why/`);
    await page.waitForSelector('body[data-course-ready="true"]', { timeout: 3000 });
    const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    assert.ok(Object.entries(stored).some(([name, value]) => name.startsWith(`${key}-recovery-`) && value === original), 'Original progress must be recoverable');
    if (invalid.lessons !== null) assert.equal(JSON.parse(stored[key]).lessons.why.note, 'Моя запись');
    assert.match(await page.locator('#notice').innerText(), /копия/);
    await page.reload();
    await page.waitForSelector('body[data-course-ready="true"]');
    await context.close();
  }
  console.log('Corrupt progress: course opens, original backed up, valid notes retained, reload OK (3 cases).');
} finally {
  await browser?.close();
  await workshop?.close();
  await rm(stateDir, { recursive: true, force: true });
}
