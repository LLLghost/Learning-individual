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
//
// Сам поиск маркера (markerOf) и конец скриптового блока (endOfScript)
// экспортируются наружу только для регрессионных проверок
// scripts/regress-marker.mjs: правки инструментов границы не должны молча
// менять правила распознавания.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assembleCourse } from './assemble-course.mjs';

// HTML ASCII whitespace — точный набор, которым разметка отделяет имя тега
// от атрибутов: space, TAB, LF, FF, CR. Не JS `\s`: тот захватывает NBSP,
// вертикальную табуляцию и прочие разделители Юникода, которых HTML-токенайзер
// не знает — `<script\u{A0}…>` из-за этого считался тегом скрипта, хотя для
// браузера NBSP продолжает имя тега.
const HTML_SPACE = ' \\t\\n\\f\\r';

// Маркер — атрибут id настоящего открывающего тега, а не любое вхождение
// строки: indexOf находил `id="…"` и в прозе, и в комментарии, и в тексте
// скрипта, и граница молча уезжала на такое совпадение — запись тогда
// раскладывала бы правки по чужим фрагментам. Документ проходится один раз
// сканером с теми же правилами, по которым его читает браузер:
//   • комментарий <!-- … --> пропускается целиком, включая приманку внутри;
//   • текст внутри <script>…</script> пропускается (блок заканчивается на
//     первом же </script>, как и для браузера), но атрибуты самого тега
//     <script …> настоящие — так находятся блоки данных вида
//     <script type="application/json" id="lab-data">;
//   • внутри текста скрипта открывающий `<SCRIPT id="…">` — тоже просто
//     текст: блок закрывается первым </script, и приманка в строковом
//     литерале не становится ни границей, ни маркером — в любом регистре;
//   • скриптом считается только целое имя тега: сразу после него идёт
//     HTML-пробел из набора выше, «/» или «>», но не NBSP, не дефис и не
//     буква — `<script-data>` и `<scripting>` обычные элементы, их
//     содержимое сканером не накрывается, и маркер внутри них находится;
//   • открывающий и закрывающий теги скрипта распознаются без учёта
//     регистра, в том числе с разным регистром внутри пары (<SCRIPT> …
//     </ScRiPt>): браузеру регистр безразличен, а до фикса содержимое
//     нераспознанного блока сканировалось как разметка, и приманка внутри
//     него принималась за маркер;
//   • в открывающем теге атрибут id узнаётся как отдельное слово — перед ним
//     HTML-пробел, кавычка или слэш, но не NBSP, не «[» и не часть другого
//     имени: `data-id="…"` и `[id="…"` маркером не считаются. Ловушка внутри
//     значения чужого атрибута (`title='x id="…"'`) остаётся за границами
//     защиты: инструменты правки разметку не меняют, а полноценный
//     разбор атрибутов здесь не нужен.
//   • открывающий тег скрипта (и любой другой тег) кончается первым «>»
//     вне кавычек значений атрибутов: приманка `</script>` или «>» внутри
//     `title="…"` тег не закрывает, атрибут id после такой приманки —
//     настоящий атрибут тега, а хвост значения сканером не разбирается.
export const markerOf = (html, id) => {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attribute = new RegExp(`["'${HTML_SPACE}/]id="${escaped}"`);
  const carriesId = (tag) => attribute.test(tag.slice(1).replace(/\/?>$/, ''));
  const scan = new RegExp(
    `<(\\/?)script(?=[${HTML_SPACE}/>])[^>]*>|<!--[\\s\\S]*?-->|<([a-zA-Z][^<>]*)>`,
    'gi',
  );
  let inScript = false;
  for (let match; (match = scan.exec(html)); ) {
    if (match[1] !== undefined) {
      if (match[1]) inScript = false;
      else if (inScript) continue;
      else {
        // Сканируемый тег мог «закрыться» на «>» внутри кавычек значения:
        // честный конец дальше, и атрибуты после приманки видны только в
        // полном тексте тега — от него же откладывается дальнейший обход.
        const tagEnd = endOfOpenTag(html, match.index);
        scan.lastIndex = tagEnd;
        inScript = true;
        if (carriesId(html.slice(match.index, tagEnd))) return match.index;
      }
      continue;
    }
    if (match[2] === undefined) continue;
    if (inScript) continue;
    const tagEnd = endOfOpenTag(html, match.index);
    scan.lastIndex = tagEnd;
    if (carriesId(html.slice(match.index, tagEnd))) return match.index;
  }
  throw new Error(`course: не найден маркер id="${id}"`);
};

// Честный конец открывающего тега — первый «>» вне кавычек значений
// атрибутов. `title="</script>"` несёт и приманку-закрытие, и «>» внутри
// значения: без учёта кавычек тег обрывался бы на первом же «>», до
// атрибутов после приманки (включая id) ни маркер, ни поиск конца блока
// не доезжали, а script-end начинал искать закрытие внутри значения и
// резал открывающий тег пополам. Это не разбор атрибутов: кавычки нужны
// ровно затем, чтобы найти настоящий конец тега.
const endOfOpenTag = (html, at) => {
  let quote = null;
  for (let i = at + 1; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i + 1;
  }
  throw new Error('course: открывающий тег не закрыт — нет «>» вне кавычек атрибутов');
};

// Конец скриптового блока — первый закрывающий тег `</script`, опознанный
// теми же правилами, что и маркер: любой регистр, за именем HTML-пробел,
// «/» или «>» (`</ScRiPt >` и `</script\n>` — закрытия, `</scriptx>` — нет).
// Поиск начинается после честного конца открывающего тега: закрытие-приманка
// внутри значения атрибута лежит до него. Регистрозависимый indexOf пропускал
// `</ScRiPt>` и молча искал закрытие в чужом блоке ниже по документу, а
// отсутствие закрытия давало (-1) + 9 — «границу» в самом начале документа
// вместо отказа.
export const endOfScript = (html, id) => {
  const close = new RegExp(`</script(?=[${HTML_SPACE}/>])[^>]*>`, 'gi');
  close.lastIndex = endOfOpenTag(html, markerOf(html, id));
  const match = close.exec(html);
  if (!match) throw new Error(`course: не закрыт блок id="${id}"`);
  return match.index + match[0].length;
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
    return endOfScript(html, start.id);
  }
  if (start.kind === 'plain-script-after') {
    // Ровно `<script>` без атрибутов — так в книге выглядит «следующий
    // обычный скрипт», и регистр здесь часть конвенции: блок данных может
    // закончиться `</ScRiPt>`, но скрипт после него ищется буквально.
    const after = endOfScript(html, start.id);
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
