import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorkshop } from '../../episodes/first-service/server.mjs';
import { launchBrowser } from '../../scripts/browser-launch.mjs';
const stateDir = await mkdtemp(join(tmpdir(), 'mayak-tabs-'));
let workshop, browser;
try {
 workshop = await startWorkshop({ port: 0, stateDir });
 browser = await launchBrowser();
 const context = await browser.newContext();
 const a = await context.newPage(), b = await context.newPage();
 for (const [page, id] of [[a,'why'], [b,'request']]) {
  await page.goto(`${workshop.origin}/learn/${id}/`);
  await page.waitForSelector('body[data-course-ready="true"]');
  await page.locator('[data-journey-step="reflection"]').click();
 }
 await a.locator('[data-draft="note"]').fill('Запись первой вкладки');
 await b.locator('[data-draft="note"]').fill('Запись второй вкладки');
 const saved = await b.evaluate(() => JSON.parse(localStorage.getItem('mayak-course-progress-v7')));
 const result = { firstNote: saved.lessons.why?.note, secondNote: saved.lessons.request?.note,
  firstNoteLost: saved.lessons.why?.note !== 'Запись первой вкладки' };
 console.log(JSON.stringify(result));
 await mkdir('work/ub-audit', { recursive: true });
 await writeFile('work/ub-audit/two-tabs.json', JSON.stringify(result, null, 2));
} finally { await browser?.close(); await workshop?.close(); await rm(stateDir, { recursive: true, force: true }); }
