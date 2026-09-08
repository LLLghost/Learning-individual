// Инструмент вычитки банка заданий: показывает и заменяет только те строки
// study-data, которые видит студент. Служебные поля (id, module, kind, answer,
// version) не отдаются и не переписываются, поэтому правка текста не может
// сломать проверку ответов.
//
//   node scripts/study-strings.mjs list [--latin]
//   node scripts/study-strings.mjs apply patch.json
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const file = resolve(process.cwd(), 'public', 'course.html');
const source = await readFile(file, 'utf8');

const opening = '<script type="application/json" id="study-data">';
const start = source.indexOf(opening);
if (start < 0) throw new Error('course.html: блок study-data не найден');
const from = start + opening.length;
const to = source.indexOf('</script>', from);
const raw = source.slice(from, to);
const data = JSON.parse(raw);

// Сериализация повторяет исходное форматирование блока (разделители «, » и «: »).
const serialize = (value) => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(', ')}]`;
  return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${serialize(item)}`).join(', ')}}`;
};
if (serialize(data) !== raw) throw new Error('study-strings: форматирование блока не воспроизводится — правка небезопасна');

// Пути к видимым строкам. Всё, чего здесь нет, инструменту недоступно.
const visible = [];
data.items.forEach((item, index) => {
  visible.push([`items[${index}].stem`, item.stem]);
  (item.options ?? []).forEach((option, position) => visible.push([`items[${index}].options[${position}]`, option]));
  if (item.explanation) visible.push([`items[${index}].explanation`, item.explanation]);
  (item.fields ?? []).forEach((field, position) => visible.push([`items[${index}].fields[${position}].label`, field.label]));
});
data.cases.forEach((scenario, index) => {
  visible.push([`cases[${index}].title`, scenario.title]);
  visible.push([`cases[${index}].initial`, scenario.initial]);
  visible.push([`cases[${index}].evidence`, scenario.evidence]);
  (scenario.stages ?? []).forEach((stage, position) => {
    visible.push([`cases[${index}].stages[${position}].label`, stage.label]);
    (stage.options ?? []).forEach((option, choice) => {
      visible.push([`cases[${index}].stages[${position}].options[${choice}]`, option]);
    });
  });
});

const locate = (path) => {
  const steps = path.match(/[A-Za-z]+|\d+/g) ?? [];
  let holder = data;
  for (const step of steps.slice(0, -1)) holder = holder[/^\d+$/.test(step) ? Number(step) : step];
  const last = steps.at(-1);
  return [holder, /^\d+$/.test(last) ? Number(last) : last];
};

const [command, argument] = process.argv.slice(2);

if (command === 'list') {
  let rows = visible;
  if (process.argv.includes('--latin')) rows = rows.filter(([, text]) => /[A-Za-z]{2,}/.test(text));
  process.stdout.write(rows.map(([path, text]) => JSON.stringify({ path, text })).join('\n') + '\n');
} else if (command === 'apply') {
  if (!argument) throw new Error('apply: нужен путь к JSON с правками {"путь": "новый текст"}');
  const patch = JSON.parse(await readFile(resolve(process.cwd(), argument), 'utf8'));
  const known = new Set(visible.map(([path]) => path));
  let applied = 0;
  for (const [path, value] of Object.entries(patch)) {
    if (!known.has(path)) throw new Error(`apply: путь ${path} недоступен для правки`);
    if (typeof value !== 'string') throw new Error(`apply: правка ${path} — не строка`);
    if (value.includes('</script')) throw new Error(`apply: правка ${path} закрывает <script>`);
    const [holder, key] = locate(path);
    if (holder[key] === value) continue;
    holder[key] = value;
    applied += 1;
  }
  const next = serialize(data);
  const result = source.slice(0, from) + next + source.slice(to);
  // Страховка: число заданий, сценариев и ответы обязаны совпасть с исходными.
  const before = JSON.parse(raw);
  const after = JSON.parse(next);
  const skeleton = (value) => JSON.stringify(value, (key, item) => (['stem', 'options', 'explanation', 'label', 'title', 'initial', 'evidence'].includes(key) ? (Array.isArray(item) ? item.map(() => 0) : 0) : item));
  if (skeleton(before) !== skeleton(after)) throw new Error('apply: изменилась структура банка — правка отклонена');
  await writeFile(file, result);
  process.stdout.write(`Применено правок: ${applied}\n`);
} else {
  const latin = visible.filter(([, text]) => /[A-Za-z]{2,}/.test(text));
  const words = latin.reduce((sum, [, text]) => sum + (text.match(/[A-Za-z][A-Za-z'’-]+/g) ?? []).length, 0);
  process.stdout.write(`Видимых строк банка: ${visible.length}\nИз них с латиницей: ${latin.length} (${words} латинских слов)\n`);
}
