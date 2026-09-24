#!/usr/bin/env node
// Проверка внешних ссылок учебника. В обычный прогон не входит: ей нужна сеть,
// а чужой сайт может лежать по причинам, к учебнику отношения не имеющим.
// Запускать руками — например перед выпуском: node scripts/check-links.mjs
//
// Только подтверждённые 404/410 называем мёртвыми. Тайм-аут, DNS, TLS и
// защита от роботов ничего не доказывают о доступности страницы для читателя.
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
  let lastError;
  for (const method of ['HEAD', 'GET', 'GET']) {
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
      lastError = error.cause?.code ?? error.code ?? error.message;
    }
  }
  return { error: lastError ?? 'без ответа' };
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

const broken = results.filter((item) => item.status === 404 || item.status === 410);
const blocked = results.filter((item) => item.status === 401 || item.status === 403 || item.status === 429);
const uncertain = results.filter((item) => item.error || (item.status >= 400 && !broken.includes(item) && !blocked.includes(item)));
const live = results.filter((item) => item.status >= 200 && item.status < 400);
const moved = live.filter((item) => item.final && item.final !== item.address);

for (const item of broken) console.log(`МЁРТВА ${item.status}  ${item.address}\n        ${item.label}`);
for (const item of blocked) console.log(`ЗАКРЫТ ${item.status}  ${item.address} — проверьте в браузере`);
for (const item of uncertain) console.log(`НЕЯСНО ${item.status ?? item.error}  ${item.address} — повторите позже или проверьте в браузере`);
for (const item of moved) console.log(`ПЕРЕЕЗД ${item.address}\n        → ${item.final}`);

console.log(`\nЖивых: ${live.length} · переездов: ${moved.length} · закрытых: ${blocked.length} · неясных: ${uncertain.length} · мёртвых: ${broken.length}`);
if (broken.length) process.exitCode = 1;
