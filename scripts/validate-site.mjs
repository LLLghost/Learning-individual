import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(process.cwd(), 'build');
const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
};
const htmlFiles = await walk(root);
const cache = new Map();
for (const file of htmlFiles) cache.set(file, await readFile(file, 'utf8'));
const failures = [];
const targetFile = (current, pathname) => {
  if (!pathname) return current;
  const decoded = decodeURIComponent(pathname);
  if (decoded.startsWith('/')) return resolve(root, decoded.slice(1), decoded.endsWith('/') ? 'index.html' : '');
  return resolve(dirname(current), decoded, decoded.endsWith('/') ? 'index.html' : '');
};

for (const [file, html] of cache) {
  if (!html.includes('data-notes-toggle') || !html.includes('data-notes-panel')) failures.push(`${file}: missing reader notebook controls`);
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (/^(?:https?:|mailto:|javascript:)/.test(href)) continue;
    const [pathAndQuery, anchor] = href.split('#');
    const pathname = pathAndQuery.split('?')[0];
    const target = targetFile(file, pathname);
    try {
      if (!(await stat(target)).isFile()) failures.push(`${file}: missing ${href}`);
      else if (anchor) {
        const targetHtml = cache.get(target) ?? await readFile(target, 'utf8');
        if (!targetHtml.includes(`id="${anchor}"`)) failures.push(`${file}: missing anchor ${href}`);
      }
    } catch { failures.push(`${file}: missing ${href}`); }
  }
}

const assessment = cache.get(resolve(root, 'assessment', 'index.html'));
const siteJs = await readFile(resolve(root, 'assets', 'site.js'), 'utf8');
const siteCss = await readFile(resolve(root, 'assets', 'site.css'), 'utf8');
if (!siteJs.includes('server-infrastructure-reader-v1') || !siteJs.includes('data-highlight-color')) failures.push('site.js: missing reader notebook behavior');
if (!siteCss.includes('.notes-panel') || !siteCss.includes('.reader-highlight')) failures.push('site.css: missing reader notebook styles');
if (!siteJs.includes('recordQuickCheck') || !siteCss.includes('.chapter-trainer')) failures.push('assets: missing chapter trainer behavior or styles');
for (let number = 0; number < 28; number += 1) {
  const chapter = cache.get(resolve(root, 'chapters', String(number).padStart(2, '0'), 'index.html'));
  if (!chapter?.includes(`data-chapter-trainer="${number}"`)) failures.push(`chapter ${number}: missing quick trainer`);
  const count = chapter?.match(/data-trainer-question=/g)?.length ?? 0;
  if (count !== 2) failures.push(`chapter ${number}: expected 2 quick questions, got ${count}`);
}
const chapter00 = cache.get(resolve(root, 'chapters', '00', 'index.html'));
const chapter01 = cache.get(resolve(root, 'chapters', '01', 'index.html'));
if (chapter00?.includes('id="b00-s060"')) failures.push('chapter 00: next part introduction leaked into chapter 00');
if (!chapter01?.includes('id="b00-s060"')) failures.push('chapter 01: missing Part I introduction');
const dataMatch = assessment?.match(/<script type="application\/json" id="study-data">(.*?)<\/script>/s);
if (!dataMatch) failures.push('assessment: missing study-data');
else {
  const data = JSON.parse(dataMatch[1]);
  if (data.items?.length !== 84) failures.push(`assessment: expected 84 items, got ${data.items?.length}`);
  if (data.cases?.length !== 28) failures.push(`assessment: expected 28 cases, got ${data.cases?.length}`);
}
if (htmlFiles.length !== 63) failures.push(`expected 63 routes, got ${htmlFiles.length}`);
if (failures.length) throw new Error(`Site validation failed:\n${failures.slice(0, 30).join('\n')}`);
console.log(`Validated ${htmlFiles.length} routes: links, anchors, 84 items, 28 scenarios.`);
