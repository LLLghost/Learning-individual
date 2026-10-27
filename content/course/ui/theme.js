// Run in the head before styles: theme must also work without course data.
(()=>{
 const key='mayak-course-theme';
 const valid=value=>value==='light'||value==='dark';
 let theme='dark';
 try{const saved=localStorage.getItem(key);if(valid(saved))theme=saved;}catch{}
 const apply=value=>{
  theme=value;
  document.documentElement.dataset.theme=theme;
  const button=document.querySelector('#theme-toggle');
  if(button){
   const next=theme==='dark'?'светлую':'тёмную';
   button.textContent=theme==='dark'?'Светлая тема':'Тёмная тема';
   button.setAttribute('aria-label',`Переключить на ${next} тему`);
  }
 };
 apply(theme);
 const bind=()=>{
  apply(theme);
  document.querySelector('#theme-toggle')?.addEventListener('click',()=>{
   apply(theme==='dark'?'light':'dark');
   try{localStorage.setItem(key,theme);}catch{}
  });
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
 addEventListener('storage',event=>{if(event.key===key)apply(valid(event.newValue)?event.newValue:'dark');});
})();
