#!/usr/bin/env node
// Проверка внешних ссылок учебника. В обычный прогон не входит: ей нужна сеть,
// а чужой сайт может лежать по причинам, к учебнику отношения не имеющим.
// Запускать руками — например перед выпуском: node scripts/check-links.mjs
//
// Мёртвая ссылка в учебнике — невыполненное обещание: читателя отправили к
// первоисточнику, а первоисточника нет. Заметить это по самой книге нельзя.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = await readFile(resolve(process.cwd(), 'public', 'course.html'), 'utf8');
const links = new Map();
for (const match of source.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
  const address = match[1].replace(/&amp;/g, '&');
  const label = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!links.has(address)) links.set(address, label);
}
console.log(`Внешних ссылок: ${links.size}`);

// Часть сайтов отвечает на HEAD отказом, хотя страница есть, поэтому при
// неуспехе повторяем обычным запросом. Тело не читаем: нужен только ответ.
const probe = async (address) => {
  for (const method of ['HEAD', 'GET']) {
    try {
      const response = await fetch(address, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
        // Заголовок обязан быть из однобайтовых символов: кириллица в нём роняет
        // запрос ещё до сети, и все ссылки разом выглядят мёртвыми.
        headers: { 'user-agent': 'course-link-check/1.0 (self-check)' },
      });
      if (response.ok) return { status: response.status, final: response.url };
      if (method === 'GET') return { status: response.status, final: response.url };
    } catch (error) {
      if (method === 'GET') return { error: error.message };
    }
  }
  return { error: 'без ответа' };
};

const limit = 6;
const entries = [...links.entries()];
const results = [];
for (let start = 0; start < entries.length; start += limit) {
  const batch = entries.slice(start, start + limit);
  results.push(...await Promise.all(batch.map(async ([address, label]) => ({ address, label, ...await probe(address) }))));
  process.stdout.write(`  проверено ${Math.min(start + limit, entries.length)} из ${entries.length}\r`);
}
process.stdout.write('\n');

const dead = results.filter((item) => item.error || item.status >= 400);
// 403 и 429 у крупных сайтов — чаще защита от роботов, чем пропавшая страница.
// Разделяем их от настоящих потерь, иначе проверка перестанет что-либо значить.
const blocked = dead.filter((item) => item.status === 403 || item.status === 429);
const broken = dead.filter((item) => !blocked.includes(item));
const moved = results.filter((item) => item.final && item.final !== item.address && !dead.includes(item));

for (const item of broken) console.log(`ОТКАЗ  ${item.status ?? item.error}  ${item.address}\n       ${item.label}`);
for (const item of blocked) console.log(`ЗАКРЫТ ${item.status}  ${item.address} — вероятно защита от роботов, проверьте руками`);
for (const item of moved) console.log(`ПЕРЕЕЗД ${item.address}\n        → ${item.final}`);

console.log(`\nЖивых: ${results.length - dead.length} · переездов: ${moved.length} · закрытых: ${blocked.length} · мёртвых: ${broken.length}`);
if (broken.length) process.exitCode = 1;
