import {launchBrowser} from '../../scripts/browser-launch.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const course=JSON.parse(await readFile('build/assets/course-data.json','utf8'));
const browser=await launchBrowser();
const page=await browser.newPage();
const plans={};
try {
 for(const lesson of course.lessons.filter(lesson=>course.practiceLabs[lesson.id])) {
  plans[lesson.id]=[];
  for(const variant of [0,1]) {
   await page.goto(`http://127.0.0.1:4180/learn/${lesson.id}/?review=${variant}`);
   await page.waitForSelector('body[data-course-ready="true"]');
   await page.locator('[data-journey-step="guided"]').click();
   await page.locator('#practice-start').click();
   const plan=await page.evaluate(id=>JSON.parse(localStorage.getItem('mayak-course-progress-v7')).lessons[id].practice,lesson.id);
   assert.equal(plan.variant,variant,lesson.id);plans[lesson.id].push(plan);
  }
 }
 await writeFile('work/stand-2026-10-28/attempts.json',JSON.stringify(plans,null,2));
 console.log(`${Object.keys(plans).length} lessons, 92 fresh browser-issued attempts`);
} finally {await browser.close();}
