import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function testJourneyUI(browser,origin,base,course,output){
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const ready=()=>page.waitForSelector('body[data-course-ready="true"]');
 const step=async id=>{await page.locator(`[data-journey-step="${id}"]`).click();await page.waitForSelector(`[data-step-panel="${id}"]:visible`);};
 try{
  await page.goto(origin+base+'/');await ready();
  assert.match(await page.locator('#resume').innerText(),/Начать/);
  assert.equal(await page.locator('[data-course-lesson]').count(),0,'Home still exposes the entire catalog');
  await page.screenshot({path:join(output,'journey-home.png'),fullPage:true});
  await page.goto(origin+base+'/route/');await ready();assert.equal(await page.locator('[data-course-lesson]').count(),82);
  await page.locator('#route-filter').fill('DNS');await page.waitForFunction(()=>document.querySelector('#route-count').textContent.includes('Найдено'));
  assert.ok(await page.locator('[data-course-lesson]:visible').count()>0);
  await page.locator('#route-filter').fill('совсемнесуществующаятема');assert.equal(await page.locator('[data-course-lesson]:visible').count(),0);
  let visited=0;
  for(const l of course.lessons){
   await page.goto(`${origin}${base}/learn/${l.id}/`);await ready();
   assert.equal(await page.locator('[data-journey-step]').count(),6,l.id);
   for(const id of ['goal','explain','example','guided','independent','reflection']){
    await step(id);assert.equal(await page.locator('[data-step-panel]:visible').count(),1,l.id+'/'+id);
    assert.equal(await page.locator(`[data-step-panel="${id}"] [data-block="${id}"]`).count(),1,l.id+'/'+id);
   }
   assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('mayak-course-progress-v7')).lessons[id].read,l.id),false,'Opening steps is not completion');
   visited++;
  }
  await page.goto(`${origin}${base}/learn/process/`);await ready();await step('guided');
  assert.equal(await page.locator('[data-draft="prediction"]').isVisible(),true);
  assert.equal(await page.locator('#practice-start').isVisible(),true);
  await page.locator('[data-draft="prediction"]').fill('Найду PID по метке процесса, а не по возрасту программы.');
  await page.reload();await ready();assert.equal(await page.locator('[data-step-panel="guided"]').isVisible(),true);
  assert.match(await page.locator('[data-draft="prediction"]').inputValue(),/PID/);
  await page.goto(`${origin}${base}/learn/memory/`);await ready();
  await page.goto(origin+base+'/');await ready();assert.match(await page.locator('#resume').getAttribute('href'),/process.*#process-guided$/,'Browsing replaced the engaged lesson');
  await page.goto(origin+base+'/progress/');await ready();
  const downloadEvent=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const download=await downloadEvent;
  const exported=await readFile(await download.path(),'utf8');
  await page.evaluate(()=>localStorage.removeItem('mayak-course-progress-v7'));await page.reload();await ready();
  await page.locator('#import-progress').setInputFiles({name:'journey.json',mimeType:'application/json',buffer:Buffer.from(exported)});
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('объединена'));
  await page.goto(origin+base+'/');await ready();assert.match(await page.locator('#resume').getAttribute('href'),/process.*#process-guided$/);
  await page.locator('#resume').click();await ready();assert.match(await page.locator('[data-draft="prediction"]').inputValue(),/PID/);
  await page.locator('[data-journey-step="goal"]').focus();await page.keyboard.press('Home');assert.equal(await page.locator('[data-journey-step="goal"]').getAttribute('aria-current'),'step');
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-step-panel="explain"]').isVisible(),true);
  await page.locator('#reading-mode').click();assert.equal(await page.locator('[data-step-panel]:visible').count(),6);
  await page.emulateMedia({media:'print'});assert.equal(await page.locator('[data-step-panel]:visible').count(),6);assert.equal(await page.locator('.session-header h1').isVisible(),true);assert.equal(await page.locator('[data-block="independent"]').isVisible(),true);await page.emulateMedia({media:'screen'});
  await step('guided');await page.screenshot({path:join(output,'journey-practice.png'),fullPage:true});
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});
   for(const id of ['goal','guided','independent','reflection']){await step(id);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}/${id}`);}
   const zoom=await page.addStyleTag({content:'html{font-size:200% !important}'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}/200%`);await zoom.evaluate(n=>n.remove());
  }
  await page.locator('#theme-toggle').click();await step('guided');await page.screenshot({path:join(output,'journey-mobile-light.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(`Учебный маршрут: ${visited} урока × 6 шагов; прогноз рядом с опытом, возврат, экспорт/импорт шага, клавиатура, печать, 320/390 px и 200%: OK.`);
 }finally{await page.close();}
}
