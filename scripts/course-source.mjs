// Общий доступ к исходнику учебника для инструментов правки.
//
// Редактируемый источник — фрагменты content/ (порядок и адреса — в
// content/manifest.json). Инструменты вычитки работают с книгой как с целым
// документом: читают её собранной, а правки записывают обратно в те фрагменты,
// которым принадлежат. Это возможно потому, что сами инструменты (text-nodes,
// study-strings) физически не могут менять разметку и идентификаторы, на
// которых держатся границы фрагментов, — иначе правка прозы означала бы
// ручной перенос текста по сотне файлов.
//
//   import { readCourse, writeCourse } from './course-source.mjs';
//   const html = await readCourse();      // собранный документ
//   await writeCourse(edited);            // правки — в content/ и public/course.html
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assembleCourse } from './assemble-course.mjs';

const markerOf = (html, id) => {
  const index = html.indexOf(`id="${id}"`);
  if (index < 0) throw new Error(`course: не найден маркер id="${id}"`);
  return html.lastIndexOf('<', index);
};

// Разрешение начальной границы фрагмента в собранном документе. Виды локаторов
// те же, что в build-static.mjs: маркер по идентификатору, тег и производные
// от конца <script>. Граница обязана найтись — иначе документ уже не той
// структуры, которую умеет собирать манифест, и запись молча «съехала» бы
// не в тот фрагмент.
const locate = (html, start) => {
  if (start.kind === 'offset') return start.at;
  if (start.kind === 'tag') {
    const at = html.indexOf(start.tag);
    if (at < 0) throw new Error(`course: не найден тег ${start.tag}`);
    return at;
  }
  if (start.kind === 'last-tag') {
    const at = html.lastIndexOf(start.tag);
    if (at < 0) throw new Error(`course: не найден тег ${start.tag}`);
    return at;
  }
  if (start.kind === 'marker') return markerOf(html, start.id);
  if (start.kind === 'script-end') {
    const end = html.indexOf('</script>', markerOf(html, start.id));
    if (end < 0) throw new Error(`course: не закрыт блок id="${start.id}"`);
    return end + 9;
  }
  if (start.kind === 'plain-script-after') {
    const after = html.indexOf('</script>', markerOf(html, start.id)) + 9;
    const at = html.indexOf('<script>', after);
    if (at < 0) throw new Error(`course: не найден скрипт после блока id="${start.id}"`);
    return at;
  }
  throw new Error(`content/manifest.json: неизвестный локатор ${start.kind}`);
};

export async function readCourse(root = process.cwd()) {
  return (await assembleCourse(root)).html;
}

export async function writeCourse(html, root = process.cwd()) {
  const { html: current, manifest } = await assembleCourse(root);
  if (html === current) return { changed: [] };
  // Границы ищутся в правленом документе заново: текст вокруг них менялся,
  // а сами опорные идентификаторы инструменты правки сохранить обязаны.
  const starts = manifest.fragments.map((fragment) => locate(html, fragment.start));
  starts.forEach((at, index) => {
    if (at < 0 || (index && at <= starts[index - 1])) {
      throw new Error(`write-back: граница фрагмента content/${manifest.fragments[index].file} не разрешается по порядку — структура документа изменилась`);
    }
  });
  const changed = [];
  for (let index = 0; index < manifest.fragments.length; index += 1) {
    const fragment = manifest.fragments[index];
    const from = starts[index];
    const to = index + 1 < starts.length ? starts[index + 1] : html.length;
    const body = html.slice(from, to);
    if (fragment.anchor && body.split(`id="${fragment.anchor}"`).length - 1 !== 1) {
      throw new Error(`write-back: content/${fragment.file} теряет якорь id="${fragment.anchor}" — правка отклонена`);
    }
    const file = resolve(root, 'content', fragment.file);
    if (await readFile(file, 'utf8').catch(() => null) !== body) {
      await writeFile(file, body);
      changed.push(`content/${fragment.file}`);
    }
  }
  // Контроль обратной сборки: записанные фрагменты обязаны дать ровно тот
  // документ, который записывали, — иначе запись расщепила книгу.
  if ((await assembleCourse(root)).html !== html) {
    throw new Error('write-back: фрагменты не воспроизводят правленый документ — запись отклонена');
  }
  await writeFile(resolve(root, manifest.target ?? 'public/course.html'), html);
  return { changed };
}
