import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const folder = resolve(process.argv[2] ?? 'quality/live-labs/2026-09-24');
const ids = ['L04A', 'L06B', 'L07B', 'L12A', 'L13B', 'L14B', 'L16B', 'L30B', 'L31A'];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve('build/assessment/index.html')).href);
  for (const id of ids) {
    const report = JSON.parse(await readFile(resolve(folder, `${id}.json`), 'utf8'));
    const result = await page.evaluate((report) => {
      const lab = JSON.parse(document.getElementById('lab-data').textContent).labs.find((entry) => entry.id === report.lab);
      if (!lab) return { valid: false, checks: 0, passed: 0, negative: 0 };
      const rows = window.CourseQA.labRows(report, lab);
      let negative = 0;
      lab.checks.forEach((check, index) => {
        const altered = structuredClone(report);
        if (check.field) altered.claim[check.field] = '__wrong__';
        else if (check.fact) altered.facts[check.fact] = null;
        if (window.CourseQA.labRows(altered, lab)[index]?.ok === false) negative += 1;
      });
      return { valid: window.CourseQA.labValid(report), checks: rows.length, passed: rows.filter((row) => row.ok).length, negative };
    }, report);
    console.log(`${id}: ${result.passed}/${result.checks} принято, ${result.negative}/${result.checks} подмен отклонено, формат ${result.valid ? 'верен' : 'неверен'}`);
    if (report.lab !== id || !result.valid || result.passed !== result.checks || result.negative !== result.checks) process.exitCode = 1;
  }
} finally {
  await browser.close();
}
