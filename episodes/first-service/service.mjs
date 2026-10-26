// Отдельный процесс: перезапуск действительно меняет PID, а данные остаются в файле.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const config = JSON.parse(await readFile(process.env.WORKSHOP_CONFIG, 'utf8'));
const server = createServer(async (request, response) => {
  try {
    const note = JSON.parse(await readFile(process.env.WORKSHOP_NOTE, 'utf8'));
    response.setHeader('cache-control', 'no-store');
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ...note, pid: process.pid }));
    } else if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(note.title)}</title><style>body{margin:0;padding:32px;background:#e8efdf;color:#21372a;font:16px/1.6 system-ui}small{letter-spacing:.12em}h1{font:36px/1.15 Georgia,serif;overflow-wrap:anywhere}p{white-space:pre-wrap;overflow-wrap:anywhere}footer{margin-top:60px;font-size:12px}</style><small>МОЯ СТРАНИЦА</small><h1>${escape(note.title)}</h1><p>${escape(note.message)}</p><footer>HTTP 200 · версия записи ${note.revision}</footer></html>`);
    } else {
      response.writeHead(404).end('Не найдено');
    }
  } catch (error) {
    console.error(`Не удалось прочитать данные: ${error.code ?? error.message}`);
    response.writeHead(500).end('Не удалось прочитать данные');
  }
});
server.on('error', (error) => { console.error(error.code ?? error.message); process.exit(1); });
server.listen(config.listen.port, config.listen.host, () => {
  console.log(`PID ${process.pid}: слушаю 127.0.0.1:${server.address().port}`);
  process.send?.({ ready: true });
});
process.on('disconnect', () => server.close(() => process.exit(0)));
