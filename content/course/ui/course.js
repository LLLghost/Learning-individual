import { labValid, labRows, evaluate } from './checker.js';
const base=document.querySelector('meta[name="course-base"]').content;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notice=(s)=>{const el=document.querySelector('#notice');el.hidden=false;el.textContent=s;};
const KEY='mayak-course-progress-v7';
const [course,bank]=await Promise.all(['course-data','assessments'].map(n=>fetch(`${base}/assets/${n}.json`).then(r=>{if(!r.ok)throw Error('Данные курса недоступны');return r.json()})));
const items=new Map(bank.items.map(x=>[x.id,x]));
const newState=()=>({schema:'course-journey-v7',version:7,lessons:{},results:{},reports:{},legacy:{},last:null});
let state;try{state=JSON.parse(localStorage.getItem(KEY)||'null')}catch{}
if(!state||state.schema!=='course-journey-v7')state=newState();
state.legacy??={};
for(const key of Object.keys(localStorage))if(key.startsWith('server-infrastructure-')&&!Object.hasOwn(state.legacy,key))state.legacy[key]=localStorage.getItem(key);
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state));return true}catch{notice('Не удалось сохранить прогресс в браузере. Скачай резервную копию перед закрытием.');return false}};
const lesson=course.lessons.find(l=>l.id===document.body.dataset.lesson);
const at=id=>id==='@reference'?`${base}/reference/`:`${base}/learn/${id}/`;
if(lesson){state.last=lesson.id;state.lessons[lesson.id]??={startedAt:Date.now(),read:false,prediction:'',reflection:'',note:'',local:[]};const requested=Number(new URLSearchParams(location.search).get('review'));if(Number.isInteger(requested)&&requested>0&&requested>(state.lessons[lesson.id].reviewCount??0))state.lessons[lesson.id].reviewCount=requested;save();}
const record=()=>state.lessons[lesson.id];
const summary=()=>{
 const target=document.querySelector('#progress-summary');if(!target)return;
 const rows=Object.values(state.lessons), reports=Object.values(state.reports);
 target.innerHTML=`<div class="stats"><span><strong>${rows.filter(x=>x.read).length}</strong> уроков прочитано</span><span><strong>${Object.values(state.results).filter(x=>x.correct&&x.source===course.sourceSha256).length}</strong> заданий выполнено</span><span><strong>${reports.filter(x=>x.verified&&x.kind==='dataset').length}</strong> отчётов по данным</span><span><strong>${reports.filter(x=>x.verified&&x.kind!=='dataset').length}</strong> стендовых отчётов</span></div><p>Эти результаты относятся к сохранённым попыткам. Выполненное упражнение по данным не подтверждает действие на настоящем оборудовании.</p>`;
 document.querySelector('#legacy-summary').textContent=`Сохранено прежних наборов данных: ${Object.keys(state.legacy).length}. Они остаются в исходном виде внутри резервной копии.`;
 const oldNotes=[];
 for(const raw of Object.values(state.legacy)){try{const data=typeof raw==='string'?JSON.parse(raw):raw;if(Array.isArray(data?.notes))for(const n of data.notes){const text=typeof n==='string'?n:n.text??n.body??n.note;if(typeof text==='string')oldNotes.push(text);}}catch{}}
 if(oldNotes.length){const section=document.createElement('section');section.innerHTML='<h2>Сохранённые заметки прежнего курса</h2>'+oldNotes.map(n=>`<p>${esc(n)}</p>`).join('');target.append(section);}
 document.querySelector('#review-list').innerHTML='<h2>Возвращение к пройденному</h2>'+Object.entries(state.lessons).filter(([,r])=>r.read).map(([id,r])=>`<p><a href="${at(id)}?review=${(r.reviewCount??0)+1}">${esc(course.lessons.find(l=>l.id===id)?.title??id)}</a> — ${r.due<=Date.now()?'пора повторить':`следующая проверка ${new Date(r.due).toLocaleDateString('ru-RU')}`}</p>`).join('');
};
summary();
const resume=document.querySelector('#resume');if(resume&&state.last)resume.href=at(state.last);
const revealAnchor=()=>{try{if(!location.hash)return;const target=document.getElementById(decodeURIComponent(location.hash.slice(1)));if(!target)return;for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;target.scrollIntoView({block:'start'});}catch{}};
revealAnchor();addEventListener('hashchange',revealAnchor);
for(const el of document.querySelectorAll('[data-course-lesson]'))if(state.lessons[el.dataset.courseLesson]?.read)el.classList.add('read');
for(const field of document.querySelectorAll('[data-draft]')){
 field.value=record()[field.dataset.draft]??'';
 field.addEventListener('input',()=>{record()[field.dataset.draft]=field.value;save()});
}
const question=(item)=>`<details class="question" data-question="${esc(item.id)}"><summary>${esc(item.stem)}</summary>${item.context?`<pre>${esc(item.context)}</pre>`:''}<form>${item.fields?item.fields.map((f,i)=>`<label>${esc(f.label)}<input name="field-${i}" required></label>`).join(''):(item.options??[]).map((text,i)=>`<label class="choice"><input type="radio" name="answer" value="${i}" required>${esc(text)}</label>`).join('')}${item.reason?`<fieldset><legend>Почему выбран этот ответ?</legend>${item.reason.options.map((text,i)=>`<label class="choice"><input type="radio" name="reason" value="${i}" required>${esc(text)}</label>`).join('')}</fieldset>`:''}<button>Проверить ответ</button></form><div class="answer-feedback" role="status"></div></details>`;
const assessment=document.querySelector('#assessment');
if(assessment){let assigned=lesson.checks.map(id=>items.get(id)).filter(Boolean);const groups=new Map();for(const item of assigned)if(item.variantGroup){const pool=groups.get(item.variantGroup)??[];pool.push(item);groups.set(item.variantGroup,pool)}assigned=assigned.filter(item=>!item.variantGroup||groups.get(item.variantGroup)[(record().reviewCount??0)%groups.get(item.variantGroup).length]===item);const core=assigned.filter(x=>x.core),depth=assigned.filter(x=>!x.core);assessment.innerHTML=`${record().reviewCount?'<p class="help">Повторение: в пулах вопросов выбран другой вариант. Для работы по данным подготовь новый каталог и новый отчёт.</p>':''}${core.length?'<h2>Проверь понятия</h2>'+core.map(question).join(''):''}${depth.length?`<details><summary>Задания углубления (${depth.length})</summary><p>Эти задания используют подробные механизмы из раскрываемого разбора выше. Если тема ещё незнакома, сначала вернись к объяснению. Основной опыт урока и эти упражнения учитываются отдельно.</p>${depth.map(question).join('')}</details>`:''}${!assigned.length?'<p>В этом уроке главное — собственное наблюдение и объяснение. Автоматической оценки свободного текста нет.</p>':''}`;
 assessment.addEventListener('submit',event=>{
  event.preventDefault();const card=event.target.closest('[data-question]'),item=items.get(card.dataset.question),data=new FormData(event.target);
  const response=item.fields?item.fields.map((_,i)=>data.get(`field-${i}`)):Number(data.get('answer'));
  const correct=evaluate(item,response)&&(!item.reason||Number(data.get('reason'))===item.reason.answer);
  const old=state.results[item.id];state.results[item.id]={correct,attempts:(old?.attempts??0)+1,at:Date.now(),source:course.sourceSha256};
  card.querySelector('.answer-feedback').textContent=(correct?'Ответ и выбранное объяснение согласуются с разбором. ':'Ответ пока не подтверждён. ')+(item.explanation??'Вернись к соответствующему техническому разбору и сравни наблюдения.');save();
 });}
let labState=null;
const labContainer=document.querySelector('#local-experiment');
if(labContainer&&document.querySelector('[data-practice-slot]'))document.querySelector('[data-practice-slot]').append(labContainer);
const localCall=async(action,body={})=>{
 const response=await fetch(`/api/${action}`,{method:'POST',headers:{'content-type':'application/json','x-workshop-token':document.querySelector('meta[name="workshop-token"]').content},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw Error(data.error??'Локальный опыт не выполнен');labState=data.state;return data;
};
const localOutput=(s)=>{const el=document.querySelector('#local-output');if(el)el.textContent=s;};
if(labContainer&&lesson.environment==='local'){
 try{const response=await fetch('/api/state');if(response.ok){labState=await response.json();state.legacy['first-service']=JSON.stringify(labState);save()}}catch{}
 if(!labState)labContainer.innerHTML=`<h2>Опыт на твоём компьютере</h2><p>Для настоящего запроса и запуска программы открой локальную мастерскую: из каталога курса выполни <code>npm run episode</code>, затем открой <a href="http://127.0.0.1:4180${at(lesson.id)}">этот урок на своём компьютере</a>. Здесь текст доступен и без запущенной лаборатории.</p>`;
 else if(lesson.id==='request'){
  labContainer.innerHTML='<h2>Отправь настоящий запрос</h2><form id="local-greeting"><label>Имя для приветствия<input name="name" value="Гость" maxlength="40" required></label><button>Запросить приветствие</button></form><pre id="local-output" role="status"></pre>';
  document.querySelector('#local-greeting').onsubmit=async e=>{e.preventDefault();try{const r=await localCall('introduction-example',{name:new FormData(e.target).get('name')});localOutput(r.example.reply);record().local.push({kind:'greeting',at:Date.now()});save()}catch(error){notice(error.message)}};
 }else{
  labContainer.innerHTML=`<h2>Твоя настоящая страница</h2><p>Здесь используются сохранённые данные первой мастерской. Изменения выполняются отдельной программой на твоём компьютере.</p><form id="local-note"><label>Название<input name="title" value="${esc(labState.note?.title??'Мои планы')}" maxlength="80" required></label><label>Заметка<textarea name="message" maxlength="1800" required>${esc(labState.note?.message??'Хочу научиться поддерживать свой сервис.')}</textarea></label><button>Сохранить страницу</button></form><div class="actions">${[['status','Проверить запуск'],['request public','Запросить страницу'],['restart','Перезапустить'],['journal','Прочитать журнал'],['config service','Настройки программы'],['config gateway','Настройки входа']].map(([command,label])=>`<button data-local-command="${command}">${label}</button>`).join('')}<button id="local-verify">Проверить результат</button></div><pre id="local-output" role="status"></pre>`;
  document.querySelector('#local-note').onsubmit=async e=>{e.preventDefault();try{
   const data=new FormData(e.target),title=data.get('title'),message=data.get('message');
   if(labState.phase==='welcome'){
    if(!labState.introduction.example)throw Error('Сначала отправь приветствие в уроке о запросе и ответе.');
    if(!bank.items.some(x=>x.variantGroup==='I-service'&&state.results[x.id]?.correct&&state.results[x.id]?.source===course.sourceSha256))throw Error('Сначала ответь на вопрос о нашей программе в первом вводном уроке.');
    await localCall('introduction-check',{answer:'service'});await localCall('introduction-complete');await localCall('create',{title});
   }
   const r=await localCall('note',{title,message});localOutput(r.message);record().local=[];record().verified=false;save();
  }catch(error){notice(error.message)}};
  for(const button of labContainer.querySelectorAll('[data-local-command]'))button.onclick=async()=>{try{
   if(record().prediction&&labState.records[labState.phase])await localCall('prediction',{text:record().prediction});
   const r=await localCall('command',{command:button.dataset.localCommand});localOutput(r.output);
   if(button.dataset.localCommand==='restart')record().verified=false;save();
  }catch(error){notice(error.message)}};
  document.querySelector('#local-verify').onclick=async()=>{try{const r=await localCall('check');localOutput(r.message);record().verified=r.ok;record().local.push({kind:'check',at:Date.now(),ok:r.ok,checks:r.checks});save()}catch(error){notice(error.message)}};
  if(lesson.id==='page-failure'){
   const controls=document.createElement('section');
   controls.innerHTML=`<h3>Последовательность опыта</h3><p>Сначала подтверди сохранность страницы в предыдущем уроке. Здесь начни эксперимент, проверь предположение, измени настройку и запроси страницу снова. После успешной проверки сохрани разбор. Затем переходи к новому варианту.</p><div class="actions"><button data-local-action="fault">Начать эксперимент</button><button data-local-action="reflection">Сохранить мой разбор</button><button data-local-action="challenge">Новый вариант самостоятельно</button><button data-local-action="finish">Завершить опыт</button></div><details><summary>Изменить порты программы и входа</summary><p>Вход должен обращаться к тому адресу и порту, где программа принимает запросы. Сначала сравни наблюдения, затем выбери изменение.</p><form id="local-config"><label>Программа принимает на<select name="service">${Object.entries(labState.ports).map(([key,value])=>`<option value="${key}" ${labState.config.service===key?'selected':''}>127.0.0.1:${value}</option>`).join('')}</select></label><label>Вход обращается к<select name="gateway">${Object.entries(labState.ports).map(([key,value])=>`<option value="${key}" ${labState.config.gateway===key?'selected':''}>127.0.0.1:${value}</option>`).join('')}</select></label><button>Применить и перезапустить</button></form></details>`;
   labContainer.append(controls);
   const sync=()=>{for(const key of ['service','gateway'])document.querySelector(`#local-config [name="${key}"]`).value=labState.config[key]};
   for(const b of controls.querySelectorAll('[data-local-action]'))b.onclick=async()=>{try{const action=b.dataset.localAction,r=await localCall(action,action==='reflection'?{text:record().reflection}:{});if(['fault','challenge'].includes(action))record().verified=false;sync();localOutput(r.message);save()}catch(error){notice(error.message)}};
   document.querySelector('#local-config').onsubmit=async e=>{e.preventDefault();try{const data=new FormData(e.target),r=await localCall('config',{service:data.get('service'),gateway:data.get('gateway')});record().verified=false;sync();localOutput(r.message);save()}catch(error){notice(error.message)}};
  }
 }
}
const labId=document.querySelector('#lab-id');
function describeLab(){if(!labId)return;const l=bank.labs.find(x=>x.id===labId.value);document.querySelector('#lab-description').innerHTML=`<h3>${esc(l.title)}</h3><p><strong>${l.kind==='dataset'?'Упражнение по выданным данным':'Работа с фактами своей системы'}</strong></p><p>${esc(l.intro)}</p><p>Команды выполняются внутри указанной учебной машины. Подготовка системной неисправности требует root; наблюдение и сбор выполняются учащимся согласно инструкции. После работы восстанови исходное состояние.</p><pre>${esc(l.commands)}</pre><fieldset><legend>${esc(l.why.q)}</legend>${l.why.options.map((s,i)=>`<label class="choice"><input type="radio" name="lab-why" value="${i}">${esc(s)}</label>`).join('')}</fieldset>`;}
if(labId){labId.onchange=describeLab;describeLab();document.querySelector('#lab-report').onchange=async e=>{
 try{
  const file=e.target.files[0];if(!file||file.size>1e6)throw Error('Выбери JSON-отчёт размером до 1 МБ.');
  const report=JSON.parse(await file.text()),lab=bank.labs.find(x=>x.id===labId.value);
  if(report.lab!==lab.id||!labValid(report))throw Error('Формат или выбранная работа не совпали с отчётом.');
  const rows=labRows(report,lab),why=Number(document.querySelector('[name="lab-why"]:checked')?.value??-1);
  const fresh=report.collector_sha256===course.collectorSha256&&Date.parse(report.collected_utc)>=record().startedAt;
  const verified=rows.every(r=>r.ok)&&why===lab.why.answer&&fresh;
  state.reports[lab.id]={kind:lab.kind,verified,historical:!fresh,at:Date.now(),report,why,source:course.sourceSha256};save();
  document.querySelector('#lab-feedback').textContent=rows.map(r=>`${r.ok?'✓':'×'} ${r.name}: ${r.note}`).join('\n')+`\n${fresh?'Версия сборщика и время соответствуют текущей попытке.':'Отчёт исторический: собери новый после начала этой попытки текущей версией сборщика.'}\n${why===lab.why.answer?'Объяснение согласуется с механизмом.':'Выбери и проверь объяснение механизма.'}\n${verified?'Факты отчёта подтверждены.':'Подтверждение новой работы пока не получено.'}`;
 }catch(error){document.querySelector('#lab-feedback').textContent=error.message;}
 };}
document.addEventListener('click',async event=>{
 const action=event.target.closest('[data-action]')?.dataset.action;
 if(action==='read'){record().read=true;const days=[1,7,21][Math.min(record().reviewCount??0,2)];record().due=Date.now()+days*86400000;if(save())notice('Место чтения сохранено. Выполнение опыта учитывается отдельно.');}
 if(action==='export'){
  const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download='mayak-progress-v7.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
 }
 if(action==='offline'){try{const registration=await navigator.serviceWorker.ready;if(!registration.active)throw Error();registration.active.postMessage({type:'save-course'});notice('Сохраняем страницы курса для чтения без сети…')}catch{notice('Копию без сети можно сохранить при открытии сайта по HTTP или HTTPS.')}}
});
const importer=document.querySelector('#import-progress');if(importer)importer.onchange=async e=>{
 try{
  const f=e.target.files[0];if(!f||f.size>25e6)throw Error('Нужен JSON размером до 25 МБ.');const data=JSON.parse(await f.text());
  if(data.schema==='course-journey-v7'){
   if(data.version!==7||!data.lessons||!data.results||!data.reports||[data.lessons,data.results,data.reports].some(x=>Array.isArray(x)||typeof x!=='object'))throw Error('Неподходящий формат прогресса.');
   const incoming=newState();
   for(const [id,r]of Object.entries(data.lessons)){if(!course.lessons.some(l=>l.id===id)||!r||typeof r.read!=='boolean'||!Number.isFinite(r.startedAt))throw Error('Некорректная запись урока.');incoming.lessons[id]={...r};}
   for(const[id,r]of Object.entries(data.results)){if(!items.has(id)||!r||typeof r.correct!=='boolean')throw Error('Некорректный результат.');incoming.results[id]=r;}
   for(const[id,r]of Object.entries(data.reports)){const lab=bank.labs.find(x=>x.id===id);if(!lab||!labValid(r.report))throw Error('Некорректный отчёт.');incoming.reports[id]={...r,verified:false,historical:true};}
   incoming.legacy={...state.legacy,...data.legacy};incoming.last=course.lessons.some(l=>l.id===data.last)?data.last:null;state={...incoming,lessons:{...state.lessons,...incoming.lessons},results:{...state.results,...incoming.results},reports:{...state.reports,...incoming.reports}};
  }else if(data.data&&typeof data.data==='object'){for(const[k,v]of Object.entries(data.data))if(k.startsWith('server-infrastructure-')&&typeof v==='string')state.legacy[k]=v;}
  else if(data.schema==='course-study-progress'){state.legacy['imported-v6']=JSON.stringify(data);}
  else throw Error('Этот формат резервной копии не поддерживается.');
  const persisted=save();summary();if(persisted)notice('Копия объединена с сохранёнными результатами. Импортированные стендовые отчёты считаются историческими до новой проверки.');
 }catch(error){notice(error.message)}
};
document.querySelector('#search-form').onsubmit=async e=>{e.preventDefault();const q=document.querySelector('#search').value.trim().toLocaleLowerCase('ru');const target=document.querySelector('#search-results');target.hidden=false;if(!q){target.textContent='Введи слово или название темы.';return;}const index=await fetch(`${base}/assets/search-course.json`).then(r=>r.json());const matches=index.filter(l=>(l.title+' '+l.text).toLocaleLowerCase('ru').includes(q)).slice(0,25);target.innerHTML='<h2>Найденные уроки</h2>'+matches.map(l=>`<p><a href="${at(l.id)}">${esc(l.title)}</a></p>`).join('')||'Не найдено';};
if('serviceWorker'in navigator&&location.protocol!=='file:'){navigator.serviceWorker.register(`${base}/sw-course.js`,{scope:`${base}/`}).catch(()=>{});navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='course-offline-progress')notice(`Сохранено ${e.data.done} из ${e.data.total}; ошибок: ${e.data.failed}.`)});}
