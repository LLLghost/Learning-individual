const token = document.querySelector('meta[name="workshop-token"]').content;
const workspace = document.querySelector('#workspace');
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let state, toastTimer;
const stage = () => state.records[state.phase];
const draftKey = (name) => `mayak:${state.run}:${state.phase}:${name}`;
const draft = (name, fallback = '') => { try { return localStorage.getItem(draftKey(name)) ?? fallback; } catch { return fallback; } };
const notify = (message, error = false) => {
  const element = document.querySelector('#toast');
  clearTimeout(toastTimer); element.textContent = message; element.hidden = false; element.classList.toggle('error', error);
  toastTimer = setTimeout(() => { element.hidden = true; }, error ? 13000 : 9000);
};
const call = async (path, body = {}) => {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workshop-token': token }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Действие не выполнено.');
  state = result.state;
  return result;
};
const feedback = (message, error = false) => { const el = document.querySelector('#check-feedback'); if (el) { el.textContent = message; el.classList.toggle('error', error); } };
const journey = () => {
  const index = ['welcome', 'own'].includes(state.phase) ? 0 : state.phase === 'guided' ? 1 : 2;
  document.querySelector('#journey').innerHTML = [['Сделать своим', 'Запуск и сохранение'], ['Разобраться', 'Эксперимент с подсказками'], ['Справиться самому', 'Новая ситуация']].map(([title, subtitle], i) => `<div class="journey-step ${i === index ? 'active' : i < index || state.phase === 'complete' ? 'done' : ''}"><span class="number">${i < index || state.phase === 'complete' ? '✓' : `0${i + 1}`}</span><div><strong>${title}</strong><small>${subtitle}</small></div></div>`).join('');
  document.querySelector('#process-label').textContent = state.running ? `Процесс запущен · PID ${state.pid}` : 'Сервис ещё не создан';
};
const preview = () => `<section class="panel"><div class="preview-head"><span>СТРАНИЦА ЧЕРЕЗ ВХОД</span><a href="/public/" target="_blank" rel="noopener">Открыть ↗</a></div><iframe title="Твоя страница через вход" src="/public/?v=${Date.now()}" sandbox="allow-same-origin"></iframe><p class="help">Это настоящий HTTP-ответ. После изменения состояния обнови страницу.</p><button class="secondary" data-action="refresh">Обновить страницу</button></section>`;
const theory = () => `<section class="panel tinted"><p class="tag">КОГДА ПОНАДОБИТСЯ</p><h3>Как устроен этот маленький сервис</h3><div class="diagram"><span>браузер</span> → <span>вход</span> → <span>процесс</span></div><p class="help">Вход принимает твой запрос и обращается к процессу по адресу и порту. Процесс читает запись из файла и отвечает страницей.</p><details><summary>Что означает порт?</summary><p>Порт помогает выбрать приложение на одном компьютере. В этой мастерской адрес один — <code>127.0.0.1</code>, а порты разные. Если процесс слушает один порт, запрос к другому до него не дойдёт.</p></details><details><summary>Почему «запущен» бывает недостаточно?</summary><p>Живой процесс и ответ пользователю — разные наблюдения. По пути могут мешать адрес, порт или посредник. Сравнивай проверку процесса с запросом по тому пути, которым идёт пользователь.</p></details><details><summary>Что сохраняется после перезапуска?</summary><p>У процесса исчезает память и меняется PID. Файл <code>note.json</code> остаётся на диске; новый процесс читает его снова. Этот опыт проверяет перезапуск процесса. Отключение питания и потерю диска он не проверяет.</p></details></section>`;
const terminal = () => `<section aria-label="Наблюдения"><h3>Проверь свою гипотезу</h3><p class="help">Это консоль мастерской с семью командами. Они проверяют и перезапускают настоящий сервис; произвольные команды системы здесь не выполняются.</p><div class="quick-commands">${['status', 'request public', 'journal', 'config service', 'config gateway', 'request service', 'restart'].map((command) => `<button type="button" data-command="${command}">${command}</button>`).join('')}</div><div class="terminal"><div class="terminal-head"><span>НАБЛЮДЕНИЯ</span><span>локальная сессия</span></div><div class="terminal-body" role="log" aria-label="Вывод команд" tabindex="0">${transcript()}</div><form id="command-form" class="command-form"><span aria-hidden="true">›</span><input id="command" aria-label="Команда мастерской" placeholder="help — список команд" autocomplete="off" spellcheck="false"><button type="submit">Выполнить</button></form></div></section>`;
const transcript = () => state.transcript.filter((entry) => entry.phase === state.phase).map((entry) => `<pre><span class="prompt">› ${escape(entry.command)}</span>\n${escape(entry.output)}</pre>`).join('') || '<pre>Выбери проверку выше или введи help.</pre>';
const prediction = (own = false) => `<section class="panel"><p class="tag">ПРОГНОЗ ДО ПРОВЕРКИ</p><h3>${own ? 'Переживёт ли твоя запись перезапуск?' : 'Что ты предполагаешь — и чем это проверишь?'}</h3><p class="help">${own ? 'Запиши предположение. Затем перезапусти сервис и сравни результат с прогнозом.' : 'Одного предложения достаточно. Первую гипотезу можно пересмотреть по новым фактам.'}</p><form id="prediction-form"><label for="prediction">${own ? 'Мой прогноз и причина' : 'Моя гипотеза и первая проверка'}</label><textarea id="prediction" data-draft="prediction" maxlength="1000" required placeholder="Я ожидаю…, потому что…">${escape(draft('prediction', stage()?.prediction))}</textarea><button class="secondary" type="submit">Сохранить предположение</button></form>${stage()?.prediction ? '<p class="help">Предположение сохранено в журнале.</p>' : ''}</section>`;
const reflection = () => `<section class="panel"><p class="tag">ОБЪЯСНИ СВОИМИ СЛОВАМИ</p><h3>Что именно ты доказал?</h3><p class="help">Что мешало запросу? Какие наблюдения это подтвердили? Как проверил исправление? В самостоятельной задаче добавь, чем она отличалась от предыдущей.</p><form id="reflection-form"><label for="reflection">Короткий разбор</label><textarea id="reflection" data-draft="reflection" maxlength="2200" minlength="20" required placeholder="Процесс…, но запрос… Я сравнил… После изменения проверил…">${escape(draft('reflection', stage()?.reflection))}</textarea><button class="secondary" type="submit">Сохранить разбор</button></form><p class="help">Текст сохраняется для обсуждения. Автоматическая проверка подтверждает работу сервиса, а не правильность свободного объяснения.</p></section>`;
const config = () => `<section class="panel"><details id="config-details"><summary>Изменить конфигурацию</summary><p class="help">Выбери осмысленное изменение после наблюдений. Оба порта принадлежат только этой мастерской.</p><form id="config-form"><div class="config-grid"><label for="service-port">Порт сервиса<select id="service-port">${options(state.config.service)}</select></label><label for="gateway-port">Вход обращается к порту<select id="gateway-port">${options(state.config.gateway)}</select></label></div><button class="secondary" type="submit">Применить и перезапустить</button></form></details><button class="subtle" data-action="hint">${stage()?.hints ? 'Ещё подсказка' : 'Нужна подсказка'}</button>${stage()?.hints ? `<p class="help">Открыто подсказок: ${stage().hints} из 3.</p>` : ''}</section>`;
const options = (selected) => Object.entries(state.ports).map(([key, value]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>127.0.0.1:${value}</option>`).join('');
const checkPanel = () => `<section class="panel"><h3>Проверка по пути пользователя</h3><p class="help">Проверяется ответ через вход, твоя сохранённая запись и PID процесса. Твои команды и объяснение попадут в журнал.</p><button id="check" data-action="check">${stage()?.verified ? 'Проверить ещё раз' : 'Проверить результат'}</button><div id="check-feedback" class="feedback" role="status">${stage()?.verified ? 'Последняя проверка пройдена: HTTP 200, запись получена через вход.' : ''}</div></section>`;

function render() {
  workspace.dataset.phase = state.phase;
  workspace.dataset.render = String(Number(workspace.dataset.render ?? 0) + 1);
  journey();
  workspace.setAttribute('aria-busy', 'false');
  if (state.phase === 'welcome') {
    workspace.innerHTML = `<div class="stage-head"><p class="eyebrow">01 / СДЕЛАТЬ СВОИМ</p><h2>Начнём с маленькой<br>работающей вещи.</h2><p class="lead">Сегодня у тебя появится своя страница. Ты изменишь её, проверишь перезапуск, а затем вернёшь в работу после неожиданной ошибки.</p></div><div class="layout welcome-grid"><section class="panel"><p class="tag">ТВОЙ ПРОЕКТ</p><h3>Для чего будет эта страница?</h3><p class="help">Заметка для команды, план домашней лаборатории, страница игрового сервера — выбери то, что тебе интересно.</p><form id="create-form"><label for="title">Название<input id="title" data-draft="title" maxlength="80" required value="${escape(draft('title', 'Моя лаборатория'))}"></label><button type="submit">Создать мой сервис →</button></form><p class="help">Нужен только этот браузер. Можно закрыть страницу и вернуться: работа сохраняется на компьютере.</p></section><section class="panel tinted"><div class="empty-preview"><span>СКОРО ЗДЕСЬ БУДЕТ ТВОЯ СТРАНИЦА</span><strong>Маленький сервис.<br>Настоящий результат.</strong><p>От первой записи до самостоятельного разбора.</p></div><ol class="steps"><li>Запусти и измени страницу.</li><li>Проведи эксперимент с подсказками.</li><li>Разберись в новой ситуации сам.</li></ol></section></div>`;
    return;
  }
  if (state.phase === 'complete') { renderComplete(); return; }
  const own = state.phase === 'own';
  const guided = state.phase === 'guided';
  const readyNext = stage()?.verified && (own || stage()?.reflection?.length >= 20);
  workspace.innerHTML = `<div class="stage-head"><p class="eyebrow">${own ? '01 / СДЕЛАТЬ СВОИМ' : guided ? '02 / РАЗОБРАТЬСЯ' : '03 / СПРАВИТЬСЯ САМОМУ'}</p><h2>${own ? 'Добавь то, что хочется сохранить.' : guided ? 'Процесс жив. А страница?' : 'Похожий симптом.<br>Проверь причину заново.'}</h2><p class="lead">${own ? 'Напиши свою запись. Предскажи, что с ней произойдёт при перезапуске, затем проведи опыт.' : guided ? 'После изменения настроек страница через вход перестала открываться. Выясни, где обрывается запрос, исправь настройку и подтверди результат.' : 'Вход снова не получает страницу. Не переноси прежнее исправление вслепую: собери факты и найди минимальное изменение. Подсказки доступны, если застрянешь.'}</p></div><div class="layout"><div class="left">${own ? `<section class="panel"><p class="tag">ТВОЯ СТРАНИЦА</p><form id="note-form"><label for="note-title">Название<input id="note-title" data-draft="note-title" maxlength="80" value="${escape(draft('note-title', state.note.title))}" required></label><label for="note-message">Твоя запись<textarea id="note-message" data-draft="note-message" maxlength="1800" required>${escape(draft('note-message', state.note.message))}</textarea></label><button type="submit">Сохранить запись</button></form></section>` : ''}${prediction(own)}${terminal()}${!own ? config() : ''}${checkPanel()}${!own && stage()?.verified ? reflection() : ''}${readyNext ? `<section class="panel tinted"><h3>${own ? 'Запись сохранилась. Что будет при ошибке настройки?' : guided ? 'Теперь — новая ситуация без готового разбора.' : 'Сервис восстановлен. Сохраним результат.'}</h3><p class="help">${own ? 'Начни следующий эксперимент, когда готов. Своя запись останется на месте.' : guided ? 'Симптом будет знакомым. Причину снова придётся установить по наблюдениям.' : 'В отчёте будут реальные ответы сервиса и ход твоей проверки. Через день можно вернуться к новому варианту.'}</p><button data-action="${own ? 'fault' : guided ? 'challenge' : 'finish'}">${own ? 'Начать эксперимент →' : guided ? 'Попробовать самостоятельно →' : 'Завершить эпизод →'}</button></section>` : ''}</div><div class="right">${preview()}${theory()}</div></div>`;
  const output = document.querySelector('.terminal-body'); if (output) output.scrollTop = output.scrollHeight;
}

function renderComplete() {
  const last = state.records.challenge.checks.at(-1);
  workspace.innerHTML = `<div class="stage-head"><p class="eyebrow">ПЕРВЫЙ ОПЫТ ЗАВЕРШЁН</p><h2>Ты вернул свой сервис<br>в работу.</h2><p class="lead">Страница снова отвечает через вход, запись сохранилась. Ниже — что удалось проверить действием.</p></div><div class="layout"><div><section class="panel"><p class="tag">ФАКТЫ ЭТОЙ СЕССИИ</p><div class="check-row"><span>Запись после перезапуска</span><strong>${state.records.own.verified ? 'Подтверждено' : 'Нет проверки'}</strong></div><div class="check-row"><span>Восстановление в первом опыте</span><strong>${state.records.guided.verified ? 'HTTP 200' : 'Нет проверки'}</strong></div><div class="check-row"><span>Новая ситуация</span><strong>HTTP ${last?.status ?? '—'} · PID ${last?.pid ?? '—'}</strong></div><div class="check-row"><span>Подсказки в новой ситуации</span><strong>${state.records.challenge.hints ? `${state.records.challenge.hints} из 3` : 'Без подсказок'}</strong></div><p class="help">Это подтверждает результат данной сессии. Устойчивый навык стоит проверить позже на новом варианте.</p><div class="actions"><a class="link-button" href="/api/report" download>Скачать журнал и разбор ↗</a></div></section><section class="panel tinted"><h3>Вернись через день</h3><p>Повтори диагностику, начиная с наблюдений. Задача останется доступна по этому адресу, если мастерская запущена.</p><p class="help">Ориентир: ${escape(new Date(state.reviewDue).toLocaleString('ru-RU'))}. Автоматических уведомлений нет.</p><button class="secondary" data-action="repeat">Новый вариант сейчас</button></section><section class="panel"><h3>Как тебе такой способ учиться?</h3><p class="help">Для обсуждения со мной: где было интересно, где хотелось бросить и что смог бы повторить без подсказок? Эти три ответа полезнее оценки «понравилось / не понравилось».</p><blockquote class="callout">Живой процесс ещё не доказывает, что пользователь получил ответ.</blockquote><details><summary>Мой разбор новой ситуации</summary><p>${escape(state.records.challenge.reflection)}</p></details></section></div><div class="right">${preview()}${theory()}</div></div>`;
}

workspace.addEventListener('input', (event) => {
  if (!event.target.dataset.draft) return;
  try { localStorage.setItem(draftKey(event.target.dataset.draft), event.target.value); } catch {}
});
async function execute(command) {
  const result = await call('/api/command', { command });
  render();
  document.querySelector('#command')?.focus();
  return result;
}
workspace.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target; const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    let result;
    if (form.id === 'create-form') result = await call('/api/create', { title: form.querySelector('#title').value });
    if (form.id === 'note-form') result = await call('/api/note', { title: form.querySelector('#note-title').value, message: form.querySelector('#note-message').value });
    if (form.id === 'prediction-form') result = await call('/api/prediction', { text: form.querySelector('#prediction').value });
    if (form.id === 'reflection-form') result = await call('/api/reflection', { text: form.querySelector('#reflection').value });
    if (form.id === 'config-form') result = await call('/api/config', { service: form.querySelector('#service-port').value, gateway: form.querySelector('#gateway-port').value });
    if (form.id === 'command-form') result = await execute(form.querySelector('#command').value.trim());
    if (result) { render(); if (result.message) notify(result.message); }
  } catch (error) { notify(error.message, true); }
  finally { if (button) button.disabled = false; }
});
workspace.addEventListener('click', async (event) => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.command) { button.disabled = true; try { await execute(button.dataset.command); } catch (error) { notify(error.message, true); } finally { button.disabled = false; } return; }
  const action = button.dataset.action; if (!action) return;
  if (action === 'refresh') { document.querySelector('iframe').src = `/public/?v=${Date.now()}`; return; }
  button.disabled = true;
  try {
    const result = await call(`/api/${action}`);
    render();
    if (action === 'check') feedback(result.message, !result.ok);
    else if (result.message) notify(result.message);
    if (['fault', 'challenge', 'finish', 'repeat'].includes(action)) document.querySelector('#workspace').scrollIntoView({ block: 'start' });
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});

try {
  const response = await fetch('/api/state');
  if (!response.ok) throw Error('Не удалось загрузить сохранённую сессию.');
  state = await response.json(); render();
} catch (error) {
  const fatal = document.querySelector('#fatal'); fatal.textContent = `${error.message} Проверь, запущена ли мастерская в терминале, и обнови страницу.`; fatal.hidden = false;
  workspace.setAttribute('aria-busy', 'false');
}
