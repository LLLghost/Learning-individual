#!/usr/bin/env node
// Сборка переносимого однофайлового учебника из исходных фрагментов.
//
//   node scripts/assemble-course.mjs           // собрать и записать public/course.html
//   node scripts/assemble-course.mjs --check   // только проверить: устарел ли результат
//
// Единственный редактируемый источник содержания — каталог content/: порядок
// фрагментов задаёт content/manifest.json, и этот порядок — часть контракта
// сборки: главы, уроки и работы практикума режутся в маршруты сайта по своим
// маркерам, поэтому фрагменты склеиваются строго в порядке манифеста.
// public/course.html — воспроизводимый результат, а не вторая копия для правок:
// после правки фрагментов запустите `npm run build` (он пересобирает и файл,
// и сайт) и закоммитьте фрагмент вместе с обновлённым course.html.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const contentDir = (root) => resolve(root, 'content');

const readManifest = async (root) => {
  const manifest = JSON.parse(await readFile(resolve(contentDir(root), 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.fragments) || !manifest.fragments.length) throw new Error('content/manifest.json: пустой список fragments');
  return manifest;
};

// Каждый фрагмент манифеста может объявлять anchor — идентификатор, который
// обязан встречаться в этом фрагменте ровно один раз. Это ловит и пропавший
// файл, и «главу не туда», и дубликат: два файла с якорем b12 в манифесте
// не пройдут проверку уникальности.
const checkAnchors = (fragments, bodies) => {
  const seen = new Map();
  fragments.forEach((fragment, index) => {
    if (!fragment.anchor) return;
    const count = bodies[index].split(`id="${fragment.anchor}"`).length - 1;
    if (count !== 1) {
      throw new Error(`content/${fragment.file}: якорь id="${fragment.anchor}" встречается ${count} раз, ожидается ровно один`);
    }
    if (seen.has(fragment.anchor)) {
      throw new Error(`Якорь id="${fragment.anchor}" объявлен в content/${seen.get(fragment.anchor)} и content/${fragment.file} — у фрагмента один источник`);
    }
    seen.set(fragment.anchor, fragment.file);
  });
};

// Файл без манифеста молча не попадает в сборку — это самый дорогой вид
// ошибки, поэтому висячие файлы в content/ тоже запрещены.
const listHtmlFiles = async (root) => {
  const found = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (extname(entry.name) === '.html') found.push(relative(contentDir(root), path));
    }
  };
  await walk(contentDir(root));
  return found.sort();
};

export async function assembleCourse(root) {
  const manifest = await readManifest(root);
  const listed = manifest.fragments.map((fragment) => fragment.file);
  const duplicates = listed.filter((file, index) => listed.indexOf(file) !== index);
  if (duplicates.length) throw new Error(`content/manifest.json: фрагмент указан дважды: ${duplicates.join(', ')}`);
  const bodies = [];
  for (const fragment of manifest.fragments) {
    bodies.push(await readFile(resolve(contentDir(root), fragment.file), 'utf8').catch(() => {
      throw new Error(`content/manifest.json: отсутствует файл фрагмента content/${fragment.file}`);
    }));
  }
  checkAnchors(manifest.fragments, bodies);
  const orphans = (await listHtmlFiles(root)).filter((file) => !listed.includes(file));
  if (orphans.length) throw new Error(`content/: файлы вне манифеста не попадут в сборку: ${orphans.join(', ')}`);
  return { html: bodies.join(''), manifest };
}

// CLI-часть работает только при прямом запуске: импорт из build-static и
// валидатора не должен трогать файлы. Ошибки манифеста печатаются одной
// строкой: это рабочее сообщение тому, кто правит фрагменты, а не падение.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  try {
    const root = process.cwd();
    const { html, manifest } = await assembleCourse(root);
    const target = resolve(root, manifest.target ?? 'public/course.html');
    const current = await readFile(target, 'utf8').catch(() => null);
    if (process.argv.includes('--check')) {
      if (current !== html) {
        console.error(`Устаревший результат: ${relative(root, target)} не совпадает со сборкой content/. Запустите npm run build и закоммитьте файл вместе с фрагментами.`);
        process.exit(1);
      }
      console.log(`${relative(root, target)} соответствует ${manifest.fragments.length} фрагментам content/.`);
    } else if (current !== html) {
      await writeFile(target, html);
      console.log(`${relative(root, target)} пересобран из ${manifest.fragments.length} фрагментов content/.`);
    } else {
      console.log(`${relative(root, target)} актуален (${manifest.fragments.length} фрагментов).`);
    }
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exit(1);
  }
}
