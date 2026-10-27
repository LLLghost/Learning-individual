// Presentation and additive progress fields only. Assessment and lab verdicts stay in course.js.
const STEPS=[['goal','Задача урока'],['explain','Разберись'],['example','Посмотри пример'],['guided','Попробуй'],['independent','Реши сам'],['reflection','Подведи итог']];
const ENV={reading:'Чтение и наблюдение',local:'Опыт на своём компьютере','local-terminal':'Терминал своего компьютера',vm:'Выделенная Linux-ВМ',stand:'Учебный Proxmox',dataset:'Работа с данными',hardware:'Данные или выделенное оборудование'};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=n=>Number.isFinite(n)?new Date(n).toLocaleDateString('ru-RU'):'не назначено';
const make=(tag,cls,html='')=>{const n=document.createElement(tag);n.className=cls;n.innerHTML=html;return n;};
export function mountJourney({course,state,save,lesson,at,base}){
 const stepOK=x=>STEPS.some(([id])=>id===x);
 const lessonOf=id=>course.lessons.find(l=>l.id===id);
 const focus=()=>lessonOf(state.focus?.lesson)?state.focus:null;
 const link=(l,step='goal')=>`${at(l.id)}?study=1#${l.id}-${stepOK(step)?step:'goal'}`;
 const due=()=>course.lessons.filter(l=>state.lessons[l.id]?.read&&Number.isFinite(state.lessons[l.id]?.due)&&state.lessons[l.id].due<=Date.now());
 const status=l=>{
  const r=state.lessons[l.id],solved=l.checks.filter(id=>state.results[id]?.correct&&state.results[id].source===course.sourceSha256).length;
  const labs=[...new Set([...(l.labIds??[]),...l.checks.filter(x=>x.endsWith('#why')).map(x=>x.split('#')[0]),`P:${l.id}`])];
  const reports=labs.map(id=>state.reports[id]).filter(r=>r?.verified&&r.source===course.sourceSha256);
  return {read:!!r?.read,solved,vm:reports.some(x=>x.kind!=='dataset'),data:reports.some(x=>x.kind==='dataset'),due:!!r?.read&&r.due<=Date.now()};
 };
 const badges=l=>{const s=status(l);return `<span class="lesson-status">${s.read?'<span>Прочитано</span>':'<span>Не отмечено прочитанным</span>'}${s.solved?`<span>${s.solved} упр. решено</span>`:''}${s.vm?'<span class="confirmed">Отчёт стенда принят</span>':''}${s.data?'<span>Отчёт по данным</span>':''}${s.due?'<span>Пора повторить</span>':''}</span>`;};
 const home=document.querySelector('#study-home');
 const renderHome=()=>{
  if(!home)return;
  const active=focus(),l=lessonOf(active?.lesson)??course.lessons[0],step=active?.step??'goal',index=Math.max(0,STEPS.findIndex(([id])=>id===step)),reviews=due();
  home.innerHTML=`<div class="dashboard-intro"><p class="eyebrow">Самостоятельный практический курс</p><h1>Понимай систему.<br>Проверяй на практике.</h1><p class="lead">Собери свою страницу с заметками и научись поддерживать её работу — от первого запроса до восстановления системы.</p></div><div class="dashboard-grid"><section class="current-lesson"><p class="eyebrow">${active?'Твоё занятие':'С чего начать'} · Урок ${l.order+1} из ${course.lessons.length}</p><h2 id="resume-title">${escape(l.title)}</h2><p>${active?`Шаг ${index+1} из ${STEPS.length}: ${STEPS[index][1]}. Место и записи сохранены на этом устройстве.`:'Сначала разберёмся, что происходит между браузером и компьютером. Подготовка стенда пока не нужна.'}</p><p class="environment-label">${ENV[l.environment]}</p><a class="button" id="resume" href="${link(l,step)}">${active?'Продолжить занятие':'Начать вводный урок'}</a>${active?badges(l):''}</section><aside class="today-panel"><h2>Вернуться к пройденному</h2>${reviews.length?`<p>${reviews.length} ${reviews.length===1?'урок ждёт':'урока ждут'} повторения.</p><a href="${at(reviews[0].id)}?review=${(state.lessons[reviews[0].id].reviewCount??0)+1}&study=1#${reviews[0].id}-independent">${escape(reviews[0].title)}</a>`:'<p>После занятия здесь появится повторение. Оно помогает проверить, что осталось в памяти.</p>'}<a class="quiet-link" href="${base}/progress/">Результаты и заметки</a></aside></div><section class="route-preview"><div><h2>Твой путь</h2><p>10 частей: первые действия, Linux, сеть, данные, автоматизация и эксплуатация.</p></div><a class="secondary button" href="${base}/route/">Весь маршрут · ${course.lessons.length} урока</a></section><details class="home-about"><summary>Как устроены занятия и практика</summary><p>Один урок — один результат. Сначала объяснение и пример, затем опыт и самостоятельная задача. Последний шаг помогает сформулировать вывод и назначает возвращение к теме.</p><p>${course.liveAcceptance?.accepted?'Программные работы этой версии прошли авторский прогон на Proxmox.':'Сценарии стенда этой версии ещё ожидают авторской приёмки.'} Подключение своей учебной ВМ выполняется отдельно. Прочитанный текст и принятый стендовый отчёт учитываются раздельно.</p><a href="${at('lab-setup')}">Подготовка лаборатории</a></details>`;
 };
 renderHome();
 if(home&&location.hash.startsWith('#unit-'))location.replace(`${base}/route/${location.hash}`);
 const route=document.querySelector('#course-route');
 const renderRoute=()=>{
  if(!route)return;
  for(const a of route.querySelectorAll('[data-course-lesson]')){
   const l=lessonOf(a.dataset.courseLesson);if(!l)continue;
   a.href=link(l,state.lessons[l.id]?.journeyStep??'goal');
   a.querySelector('.route-state')?.remove();a.append(make('span','route-state',badges(l)));
  }
 };
 renderRoute();
 if(route){
  const reveal=()=>{const target=document.getElementById(location.hash.slice(1));if(target?.matches('details.unit'))target.open=true;};reveal();addEventListener('hashchange',reveal);
  const search=document.querySelector('#route-filter');search?.addEventListener('input',()=>{
   const q=search.value.trim().toLocaleLowerCase('ru');let count=0;
   for(const unit of route.querySelectorAll('.unit')){
    let matches=0;for(const a of unit.querySelectorAll('[data-course-lesson]')){const l=lessonOf(a.dataset.courseLesson);a.hidden=!!q&&!`${l.id} ${l.title} ${course.units.find(x=>x.id===l.unit).title}`.toLocaleLowerCase('ru').includes(q);if(!a.hidden)matches++;}
    unit.hidden=matches===0;if(q&&matches)unit.open=true;count+=matches;
   }
   document.querySelector('#route-count').textContent=q?`Найдено уроков: ${count}`:`Все ${course.lessons.length} урока доступны`;
  });
 }
 const progress=document.querySelector('#journey-ledger');
 const renderProgress=()=>{
  if(!progress)return;
  const started=course.lessons.filter(l=>state.lessons[l.id]);
  progress.innerHTML=`<h2>По занятиям</h2>${started.length?started.map(l=>`<div class="ledger-row"><div><a href="${link(l,state.lessons[l.id].journeyStep)}">${escape(l.title)}</a>${badges(l)}</div><span>${state.lessons[l.id].read?`Повторение: ${date(state.lessons[l.id].due)}`:`Шаг ${Math.max(0,STEPS.findIndex(([id])=>id===state.lessons[l.id].journeyStep))+1} из 6`}</span></div>`).join(''):'<p>Здесь будут твои занятия. Чтение, упражнения и отчёты показываются отдельно.</p><a href="'+link(course.lessons[0])+'">Начать первый урок</a>'}`;
  const reviews=document.querySelector('#review-list'),waiting=due(),later=started.filter(l=>state.lessons[l.id].read&&!waiting.includes(l));
  if(reviews)reviews.innerHTML=`<h2>Повторение</h2>${waiting.length?waiting.map(l=>`<p><a href="${at(l.id)}?review=${(state.lessons[l.id].reviewCount??0)+1}&study=1#${l.id}-independent">Повторить: ${escape(l.title)}</a></p>`).join(''):'<p>Сейчас нет отложенных задач на повторение. После завершения чтения появится дата возвращения к теме.</p>'}${later.length?`<details><summary>Предстоящие повторения · ${later.length}</summary>${later.map(l=>`<p>${escape(l.title)} — ${date(state.lessons[l.id].due)}</p>`).join('')}</details>`:''}`;
 };
 renderProgress();
 let updateLesson=()=>{},renderObservation=()=>{};
 if(lesson){
  const record=state.lessons[lesson.id],container=document.querySelector('.lesson-content'),article=container?.querySelector('article'),tools=document.querySelector('.practice-tools');
  if(!article||!tools)throw Error(`Missing lesson structure: ${lesson.id}`);
  const title=article.querySelector('h1');
  const head=make('header','session-header');
  head.id=article.id;
  head.append(title);head.append(make('p','environment-label',ENV[lesson.environment]));
  if(lesson.prerequisites.length){const p=make('p','prerequisites','Перед этим: '+lesson.prerequisites.map(id=>`<a href="${at(id)}">${escape(lessonOf(id)?.title??id)}</a>`).join(', '));head.append(p);}
  const bar=make('div','session-toolbar','<span id="step-position" role="status"></span><button type="button" id="reading-mode" aria-pressed="false">Показать урок целиком</button>');
  const nav=make('nav','journey-nav');nav.setAttribute('aria-label','Шаги занятия');
  const panes=new Map();
  for(const [id,label] of STEPS){
   const section=article.querySelector(`[data-block="${id}"]`);if(!section)throw Error(`Missing ${id}: ${lesson.id}`);
   const pane=make('section','journey-pane');pane.id=`journey-${id}`;pane.dataset.stepPanel=id;
   const h=make('h2','step-heading',label);h.id=`heading-${id}`;h.tabIndex=-1;pane.setAttribute('aria-labelledby',h.id);pane.append(h,section);panes.set(id,pane);
   const b=make('button','step-link',`<span aria-hidden="true">${panes.size}</span>${label}`);b.type='button';b.dataset.journeyStep=id;b.setAttribute('aria-controls',pane.id);nav.append(b);
  }
  const controls=make('div','journey-controls','<button type="button" id="step-back">Назад</button><p class="step-save" role="status">Место сохраняется автоматически</p><button type="button" id="step-next" class="primary-action">Дальше</button>');
  const resources=make('details','lesson-resources','<summary>Объяснения к заданиям, углубление и исходные разделы</summary>');
  while(article.firstChild)resources.append(article.firstChild);
  article.remove();document.querySelector('.lesson-outline')?.remove();container.parentElement.classList.add('guided-layout');
  const prediction=document.querySelector('[data-draft="prediction"]')?.closest('label');
  const reflection=document.querySelector('[data-draft="reflection"]')?.closest('label');
  const note=document.querySelector('[data-draft="note"]')?.closest('label');
  if(prediction)panes.get('guided').append(prediction);
  const local=panes.get('guided').querySelector('#local-experiment')??document.querySelector('#local-experiment');if(local)panes.get('guided').append(local);
  const vm=document.querySelector('#vm-practice');
  if(vm){
   const setup=make('details','lab-setup','<summary>Подготовка ВМ и исполнителя</summary>');
   for(const n of [...vm.children])if(n.matches('[data-guest-instructions]')||n.querySelector('a[download]')||n.textContent.startsWith('SHA-256:'))setup.append(n);
   vm.insertBefore(setup,vm.querySelector('#practice-start'));panes.get('guided').append(vm);
  }
  const assessment=document.querySelector('#assessment');if(assessment)tools.prepend(panes.get('independent').querySelector('[data-block="independent"]'),assessment);
  for(const n of [...tools.children])if(n.tagName==='H2'||n.matches('.notes-fields'))n.remove();
  const read=document.querySelector('[data-action="read"]');
  if(read){read.textContent='Сохранить итог и назначить повторение';panes.get('reflection').append(read);}
  const localReflection=local?.querySelector('[data-local-action="reflection"]')?.closest('.actions');
  if(reflection&&localReflection)localReflection.before(reflection);
  for(const n of [localReflection?null:reflection,note])if(n)panes.get('reflection').insertBefore(n,read??null);
  const observed=make('p','attempt-status');
  if(vm)vm.querySelector('#practice-start').before(observed);
  const localSummary=make('p','local-reflection-summary');if(localReflection)panes.get('reflection').append(localSummary);
  renderObservation=()=>{const r=state.lessons[lesson.id],report=state.reports[`P:${lesson.id}`];if(vm)observed.textContent=report?.verified?`Последний отчёт принят: ${date(report.at)}. После изменения ВМ выполни check и загрузи новый отчёт.`:r.practice?'Попытка подготовлена в браузере. Выполни команды в учебной среде и загрузи отчёт — он покажет результат проверки.':'Попытка ещё не начата. Сначала проверь среду, затем подготовь отдельную попытку.';if(localReflection)localSummary.textContent=r.reflection?`Твой разбор опыта: ${r.reflection}`:'Разбор опыта сохраняется на шаге «Попробуй», рядом с результатом действия.';};renderObservation();
  const oldReports=tools.querySelector(':scope > section:not([data-block])');
  if(oldReports){const advanced=make('details','legacy-practice','<summary>Дополнительные работы и совместимые отчёты</summary>');advanced.append(oldReports);tools.append(advanced);}
  tools.querySelector('.help')?.remove();panes.get('independent').append(tools);
  panes.get('reflection').append(make('p','completion-note','Эта отметка подтверждает чтение и сохраняет вывод. Ответы и действие на стенде учитываются отдельно.'));
  container.prepend(head,bar,nav,...panes.values(),controls,resources);
  let current=stepOK(record.journeyStep)?record.journeyStep:'goal',all=false;
  const remember=()=>{record.journeyStep=current;state.focus={lesson:lesson.id,step:current};save();};
  if(!focus()||new URLSearchParams(location.search).has('study'))remember();
  updateLesson=()=>{
   const i=STEPS.findIndex(([id])=>id===current);
   for(const [id,pane] of panes)pane.hidden=!all&&id!==current;
   for(const b of nav.querySelectorAll('button')){if(b.dataset.journeyStep===current)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');}
   document.querySelector('#step-position').textContent=all?'Все шаги урока':`Шаг ${i+1} из ${STEPS.length} · ${STEPS[i][1]}`;
   document.querySelector('#step-back').disabled=all||i===0;
   document.querySelector('#step-next').disabled=all||i===STEPS.length-1;
   const mode=document.querySelector('#reading-mode');mode.setAttribute('aria-pressed',String(all));mode.textContent=all?'Вернуться к шагам':'Показать урок целиком';
   container.classList.toggle('reading-all',all);
   const neighbors=container.querySelector('.lesson-navigation');if(neighbors)neighbors.hidden=!all&&current!=='reflection';
  };
  const select=(id,{focusHeading=false,hash=true}={})=>{
   if(!stepOK(id))return;current=id;all=false;remember();updateLesson();
   if(hash)history.replaceState(null,'',`#${lesson.id}-${id}`);
   if(focusHeading)panes.get(id).querySelector('.step-heading').focus({preventScroll:false});
  };
  nav.addEventListener('click',e=>{const b=e.target.closest('[data-journey-step]');if(b)select(b.dataset.journeyStep,{focusHeading:true});});
  nav.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const i=STEPS.findIndex(([id])=>id===current),n=e.key==='Home'?0:e.key==='End'?5:Math.max(0,Math.min(5,i+(e.key==='ArrowRight'?1:-1)));e.preventDefault();select(STEPS[n][0]);nav.querySelector(`[data-journey-step="${current}"]`).focus();});
  document.querySelector('#step-back').onclick=()=>select(STEPS[STEPS.findIndex(([id])=>id===current)-1]?.[0],{focusHeading:true});
  document.querySelector('#step-next').onclick=()=>select(STEPS[STEPS.findIndex(([id])=>id===current)+1]?.[0],{focusHeading:true});
  document.querySelector('#reading-mode').onclick=()=>{all=!all;updateLesson();};
  container.addEventListener('input',remember);
  container.addEventListener('click',e=>{if(e.target.closest('button:not(#reading-mode),[data-action]')&&!e.target.closest('.journey-nav'))remember();});
  const reveal=()=>{if(!location.hash)return;let target;try{target=document.getElementById(decodeURIComponent(location.hash.slice(1)));}catch{return;}if(!target)return;const pane=target.closest('[data-step-panel]');if(pane)select(pane.dataset.stepPanel,{hash:false});for(let p=target;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;requestAnimationFrame(()=>target.scrollIntoView({block:'start'}));};
  addEventListener('hashchange',reveal);updateLesson();reveal();
  for(const pre of container.querySelectorAll('pre')){
   if(pre.id==='practice-commands')continue;
   const button=make('button','copy-command','Скопировать');button.type='button';button.setAttribute('aria-label','Скопировать текст команды или примера');
   button.onclick=async()=>{try{await navigator.clipboard.writeText(pre.textContent);button.textContent='Скопировано';}catch{button.textContent='Выдели текст для копирования';}};pre.after(button);
  }
 }
 const refresh=()=>{renderHome();renderProgress();renderRoute();renderObservation();};
 const searchMenu=document.querySelector('#search-menu');
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&searchMenu?.open){searchMenu.open=false;searchMenu.querySelector('summary').focus();}
  if(e.key==='/'&&searchMenu&&!e.target.matches('input,textarea,select,[contenteditable]')){e.preventDefault();searchMenu.open=true;document.querySelector('#search').focus();}
 });
 document.addEventListener('click',e=>{if(e.target.closest('[data-action="read"]'))queueMicrotask(()=>{refresh();const out=document.querySelector('.completion-note');if(out&&lesson)out.textContent=`Итог сохранён. Возвращение к теме: ${date(state.lessons[lesson.id].due)}. Для проверки навыка выполни новую задачу.`;});});
 // Import replaces the state object, so the owner remounts the page instead of retaining stale closures.
 return {refresh,steps:STEPS.map(([id])=>id)};
}
