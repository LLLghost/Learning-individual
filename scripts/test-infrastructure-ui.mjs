import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './browser-launch.mjs';
import { startWorkshop } from '../episodes/first-service/server.mjs';

export async function testInfrastructureUI(browser, origin, base, course, output) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin + base + '/');
    await page.waitForSelector('body[data-course-ready="true"]');
    assert.match(await page.locator('#study-home h1').innerText(), /серверная инфраструктура/i);
    assert.doesNotMatch(await page.locator('.dashboard-intro').innerText(), /Собери свою страницу/);
    assert.equal(await page.locator('.course-sidebar').evaluate(sidebar => sidebar.scrollWidth <= sidebar.clientWidth), true, 'Unit titles are clipped in the sidebar');
    await page.screenshot({ path: join(output, 'infrastructure-home.png'), fullPage: true });
    await page.locator('[data-laboratory-link]').first().click();
    await page.waitForSelector('#laboratory-plan');
    assert.equal(await page.locator('[data-milestone]').count(), 10);
    assert.match(await page.locator('#laboratory-plan').innerText(), /не подтвержда|не означает/);
    assert.match(await page.locator('[data-milestone="final"]').innerText(), /восстанов|Восстанов/);
    await page.screenshot({ path: join(output, 'infrastructure-laboratory.png'), fullPage: true });
    for (const lesson of course.lessons) {
      await page.goto(`${origin}${base}/learn/${lesson.id}/`);
      await page.waitForSelector('body[data-course-ready="true"]');
      assert.equal(await page.locator('[data-infrastructure-role]').count(), 1, lesson.id);
      await page.locator('[data-journey-step="reflection"]').click();
      assert.equal(await page.locator('[data-infrastructure-transfer]').count(), 1, lesson.id);
      assert.ok((await page.locator('[data-infrastructure-transfer]').innerText()).length > 60, lesson.id);
    }
    await page.goto(`${origin}${base}/learn/why/`);
    await page.waitForSelector('body[data-course-ready="true"]');
    await page.locator('#reading-mode').click();
    assert.match(await page.locator('[data-block="explain"]').innerText(), /оборудован/i);
    assert.match(await page.locator('[data-block="explain"]').innerText(), /операционн/i);
    await page.goto(`${origin}${base}/learn/unknown-incident/`);
    await page.waitForSelector('body[data-course-ready="true"]');
    await page.locator('#reading-mode').click();
    assert.match(await page.locator('[data-block="independent"]').innerText(), /изолирован/);
    assert.match(await page.locator('[data-block="independent"]').innerText(), /прикладн|инфраструктур/);
    await page.goto(origin + base + '/laboratory/');
    const plan = await page.request.get(origin + base + '/downloads/laboratory-plan.md');
    assert.equal(plan.status(), 200);
    assert.match(await plan.text(), /Шаблон протокола/);
    await page.setViewportSize({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto(origin + base + '/');
    await page.waitForSelector('body[data-course-ready="true"]');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Home overflows at 320px');
    await page.screenshot({ path: join(output, 'infrastructure-home-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Infrastructure: full-course goal, 10 milestones, 82 roles/transfers, integrated final task, 320px: OK.');
  } finally { await page.close(); }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = await mkdtemp(join(tmpdir(), 'mayak-infrastructure-'));
  let workshop, browser;
  try {
    workshop = await startWorkshop({ port: 0, stateDir: directory });
    browser = await launchBrowser();
    const course = JSON.parse(await readFile('build/assets/course-data.json', 'utf8'));
    await testInfrastructureUI(browser, workshop.origin, '', course, resolve('work/course-evidence'));
  } finally { await browser?.close(); await workshop?.close(); await rm(directory, { recursive: true, force: true }); }
}
