const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const list = values => `<ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul>`;

export function infrastructureOverview(curriculum) {
  return `<section class="infrastructure-overview"><h2>К чему ведёт курс</h2><p>${esc(curriculum.goal)}</p>
    <p><strong>Итог:</strong> ${esc(curriculum.finalResult)}</p>
    <figure class="simple-model">${curriculum.model.map(part => `<span>${esc(part)}</span>`).join(' → ')}<figcaption>Уровни связаны: один симптом может иметь причины на разных границах.</figcaption></figure></section>`;
}

export function laboratoryPlan(curriculum, manifest, base) {
  const milestones = manifest.units.map((unit, index) => {
    const spec = curriculum.units[unit.id];
    const lessons = manifest.lessons.filter(lesson => lesson.unit === unit.id);
    return `<section class="laboratory-milestone" id="milestone-${unit.id}" data-milestone="${unit.id}">
      <p class="eyebrow">Этап ${index + 1} · ${esc(unit.title)}</p><h2>${esc(spec.result)}</h2>
      <p>${esc(spec.task)}</p><h3>Что сохранить</h3>${list(spec.artifacts)}
      <h3>Как проверить результат</h3>${list(spec.checks)}
      <p><a href="${base}/learn/${lessons[0].id}/">Начать блок</a> · <a href="${base}/learn/${lessons.at(-1).id}/">Вернуться к заключительному уроку блока</a></p></section>`;
  }).join('');
  return `<div id="laboratory-plan"><p class="eyebrow">Отдельные навыки → работающая система</p><h1>Моя инфраструктурная лаборатория</h1>
    ${infrastructureOverview(curriculum)}<section><h2>Как работать с этим планом</h2>
    <p>Собирай лабораторию постепенно после соответствующих уроков. Не нужно заранее знать все термины или разворачивать весь стек. Страница с заметкой — только первый небольшой опыт; приложением в итоговой системе может быть уже изученная служба.</p>
    <p>Минимальная схема: компьютер клиента, выделенный Linux-гость, хост Proxmox и копия данных вне исходного ресурса. Клиентом сначала может быть твой компьютер. Дополнительные узлы, сегменты и средства автоматизации добавляй после их изучения. Рабочие данные и сеть управления отделяй от экспериментов.</p>
    <p>Подготовку ресурсов выполняй по <a href="${base}/learn/lab-setup/">уроку о стенде</a>. Не меняй маршруты управляющего доступа и физические диски ради задачи. Неисправности создавай только в изолированной копии выделенных ресурсов, с проверенным возвратом.</p>
    <p>Сохраняй схемы, конфигурации без секретов, команды с фактическим выводом и свои объяснения. Используй заметки к урокам и экспорт результатов либо собственный инженерный журнал. <a href="${base}/downloads/laboratory-plan.md" download>Скачать план и шаблон протокола</a>.</p>
    <p class="quality-note">Прочитанный урок и принятый отчёт отдельного тренажёра не подтверждают приёмку всей лаборатории. Этот план содержит самостоятельные работы; их целостность и объяснение проверяются по протоколам, автоматически зачёт здесь не выставляется. Отсутствующее оборудование отмечай как непроверенное.</p></section>
    <nav aria-label="Этапы лаборатории">${manifest.units.map((unit, index) => `<a href="#milestone-${unit.id}">${index + 1}. ${esc(unit.title)}</a>`).join(' · ')}</nav>
    ${milestones}</div>`;
}

export function laboratoryMarkdown(curriculum, manifest) {
  const stages = manifest.units.map((unit, index) => {
    const stage = curriculum.units[unit.id];
    return `## ${index + 1}. ${unit.title}\n\n${stage.result}\n\n${stage.task}\n\nЧто сохранить:\n${stage.artifacts.map(x => '- ' + x).join('\n')}\n\nПроверка:\n${stage.checks.map(x => '- [ ] ' + x).join('\n')}`;
  }).join('\n\n');
  return `# Моя инфраструктурная лаборатория\n\n${curriculum.goal}\n\n${curriculum.finalResult}\n\nЭто план самостоятельной работы. Его заполнение не является автоматической приёмкой. Работай в изолированной учебной области; не включай секреты в комплект передачи.\n\n${stages}\n\n## Шаблон протокола\n\n- Дата, версии, узлы и состояние среды:\n- Пользовательская задача и исходный результат:\n- Разрешённая область изменений и способ возврата:\n- Наблюдения до изменения (команда, место, права, фактический вывод):\n- Гипотезы и различающая проверка:\n- Одно выбранное изменение:\n- Результат той же пользовательской пробы после:\n- Проверка данных и соседнего пути:\n- Восстановление из независимой копии, содержимое и время:\n- Объяснение причины и оставшиеся альтернативы:\n- Откат и повтор с другим вариантом:\n- Что не проверено (включая физическое оборудование):\n`;
}
