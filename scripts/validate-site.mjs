import {readFile,stat}from'node:fs/promises';
import {resolve}from'node:path';
const manifest=JSON.parse(await readFile('content/course/manifest.json','utf8'));
const map=JSON.parse(await readFile('quality/curriculum-map.json','utf8'));
const oldMap=JSON.parse(await readFile('quality/coverage-map.json','utf8'));
const bank=JSON.parse(await readFile('content/course/assessments.json','utf8'));
const built=JSON.parse(await readFile('build/course-build.json','utf8'));
const base=(process.env.BASE_PATH??'').replace(/\/+$/,'');
if(manifest.editorialStatus==='accepted')await import('./check-editorial.mjs');
await import('./check-infrastructure.mjs');
const failures=[],seen=new Set(),anchors=new Map();
const linkedFiles=new Map();
const linkedBody=async file=>{if(!linkedFiles.has(file))linkedFiles.set(file,readFile(file,'utf8'));return linkedFiles.get(file);};
const plain=s=>s.replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot);/g,e=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"'}[e])).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(n)).replace(/\s+/g,' ').replace(/\s+([.,:;!?])/g,'$1').trim();
const htmls=new Map();
for(const l of manifest.lessons){
 if(seen.has(l.id))failures.push(`Повтор урока ${l.id}`);seen.add(l.id);
 for(const p of l.prerequisites)if(!seen.has(p)||p===l.id)failures.push(`Нарушен порядок ${l.id} ← ${p}`);
 const html=await readFile(resolve('content/course',l.file),'utf8');htmls.set(l.id,html);
 for(const block of ['goal','explain','example','guided','independent','reflection'])if(!html.includes(`data-block="${block}"`))failures.push(`${l.id}: нет блока ${block}`);
 for(const a of html.matchAll(/\bid="([^"]+)"/g)){if(anchors.has(a[1]))failures.push(`Повтор якоря ${a[1]}`);anchors.set(a[1],l.id);}
 if(!built.routes.includes(`/learn/${l.id}/`))failures.push(`Не собран ${l.id}`);
 if(['vm','stand'].includes(l.environment)){
  const data=JSON.parse(await readFile('build/assets/course-data.json','utf8'));
  if(!data.practiceLabs?.[l.id])failures.push(`${l.id}: нет цикла новой практики`);
 }
 const page=await readFile(`build/learn/${l.id}/index.html`,'utf8');
 for(const m of page.matchAll(/(?:href|src)="([^"]+)"/g)){
  const address=m[1];if(/^(?:https?:|mailto:|#)/.test(address))continue;
  const [rawPath,hash]=address.split('#'),path=rawPath.split('?')[0];
  if(!path.startsWith('/'))continue;
  if(base&&!path.startsWith(base+'/')){failures.push(`${l.id}: потерян BASE_PATH ${address}`);continue;}
  const relative=base?path.slice(base.length):path,file=resolve('build','.'+relative+(relative.endsWith('/')?'index.html':''));
  try{await stat(file);if(hash){const body=await linkedBody(file);if(!body.includes(`id="${hash}"`))failures.push(`${l.id}: отсутствует ${address}`)}}catch{failures.push(`${l.id}: отсутствует файл ${address}`)}
 }
}
if(map.chapters.length!==34||map.modules.length!==37)failures.push('Потеряна глава или модуль прежнего курса');
const ids=new Set(map.assessments.map(x=>x.id));
const assigned=manifest.lessons.flatMap(l=>l.checks);
if(new Set(assigned).size!==assigned.length)failures.push('Одна проверка назначена нескольким урокам');
for(const item of bank.items)if(!assigned.includes(item.id))failures.push(`${item.id}: задание потеряно в маршруте`);
for(const check of map.foundationAssessments??[])if(!plain(htmls.get(check.lesson)??'').includes(plain(check.evidence)))failures.push(`${check.id}: нет объяснения начального понятия`);
for(const entry of oldMap.entries)if(!ids.has(entry.id))failures.push(`Не перенесено задание ${entry.id}`);
if(ids.size!==530||map.assessments.length!==530)failures.push('Нарушен состав 530 оцениваемых пунктов');
for(const x of map.assessments){
 if(!manifest.lessons.some(l=>l.id===x.lesson&&l.checks.includes(x.id)))failures.push(`${x.id}: потеряна привязка к уроку`);
 if(!bank.items.some(i=>i.id===x.id))failures.push(`${x.id}: нет задания`);
 const html=htmls.get(x.lesson)??'';
 if(!html.includes(`id="${x.source}"`))failures.push(`${x.id}: раздел ${x.source} отсутствует`);
 const section=html.match(new RegExp(`<section id="${x.source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"[^>]*>([\\s\\S]*?)</section>`))?.[1];
 if(!section||!plain(section).includes(plain(x.evidence)))failures.push(`${x.id}: объяснение отсутствует в указанном разделе`);
 const item=bank.items.find(i=>i.id===x.id);
 if(item?.mechanism!==x.source)failures.push(`${x.id}: ссылка задания расходится с объяснением`);
}
for(const chapter of map.chapters)for(const s of chapter.sections)if(anchors.get(s.id)!==s.lesson)failures.push(`Не перенесён раздел ${s.id}`);
const pendingLessons=manifest.lessons.filter(l=>l.reviewed!==true).length;
const pendingAssessments=map.assessments.filter(x=>x.reviewed!==true).length;
if(process.argv.includes('--strict')&&(pendingLessons||pendingAssessments||manifest.editorialStatus!=='accepted'))failures.push(`Редакционная приёмка не завершена: ${pendingLessons} уроков и ${pendingAssessments} привязок. Выпуск заблокирован.`);
if(process.argv.includes('--strict')){
 const live=JSON.parse(await readFile('quality/live-acceptance.json','utf8'));
 if(live.status!=='accepted'||live.sourceSha256!==built.sourceSha256||live.collectorSha256!==built.collectorSha256||live.checkerSha256!==built.checkerSha256)failures.push('Нет стендовой приёмки текущей версии содержания, сборщика и проверяющего кода.');
 if(live.practiceSha256!==built.practiceSha256)failures.push('Нет стендовой приёмки текущей версии новых исполнителей практики.');
 for(const lab of bank.labs.filter(x=>x.kind!=='dataset'))if(!live.runs.some(r=>r.lab===lab.id&&r.firstPassed&&r.repeatPassed&&r.restored&&r.reportAccepted&&r.commit&&r.vmState))failures.push(`${lab.id}: нет полного свежего протокола нового курса.`);
 for(const lesson of manifest.lessons.filter(x=>['vm','stand'].includes(x.environment)))if(!live.runs.some(r=>r.lesson===lesson.id&&r.firstPassed&&r.repeatPassed&&r.restored&&r.reportAccepted&&r.commit&&r.vmState))failures.push(`${lesson.id}: нет приёмки практического результата урока на ВМ.`);
}
if(failures.length)throw Error(failures.slice(0,35).join('\n'));
console.log(`Курс: ${manifest.lessons.length} урока; 34 главы, 37 модулей, 530 заданий и исходные разделы сохранены.`);
console.log(`Редакционная приёмка: осталось ${pendingLessons} уроков и ${pendingAssessments} привязок. Это проверка структуры, а не готовности содержания.`);
