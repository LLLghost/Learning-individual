// Общий локальный сервер собранного сайта для smoke-обхода и предметных
// регрессий. Раньше этот callback жил двумя копиями — в smoke-browser.mjs и
// regress-harness.mjs, — и любое исправление доставки приходилось вносить
// дважды: копии гарантированно разошлись бы при первом же лечении. Сервер
// слушает только loopback и раздаёт каталог build как он есть.
//
//   const { server, origin } = await startStaticServer(root);
//   ... server.close();
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

export async function startStaticServer(root) {
  // realpath нужен и самому root: если build — симлинк, сравнивать пути
  // приходится с настоящим расположением, иначе честный файл внутри
  // выглядел бы побегом из каталога.
  const realRoot = await realpath(resolve(root));
  const server = createServer(async (request, response) => {
    let path;
    try {
      path = decodeURIComponent(request.url.split('?')[0]);
    } catch {
      // Запрос с битой процент-кодировкой (/%ZZ) раньше ронял callback
      // необработанным исключением до всякого HTTP-ответа. Это ошибка
      // клиента: она отвечает 400 и не мешает остальным запросам.
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('некорректно закодированный адрес');
      return;
    }
    const file = path.endsWith('/') ? resolve(root, `.${path}index.html`) : resolve(root, `.${path}`);
    try {
      // Побег из root ловится дважды: resolve разматывает «..» в тексте
      // адреса (закодированный %2e%2e и %2f декодируются до того), а
      // realpath — симлинк внутри build, ведущий наружу. Отказ обозначается
      // отдельной веткой ответа, а не броском Error: в общем catch брошенное
      // исключение неотличимо от ошибки файловой системы, и «выход за root»
      // пришлось бы приписывать любой ошибке подряд.
      const real = await realpath(file);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('нет такого файла');
        return;
      }
      const body = await readFile(real);
      response.writeHead(200, { 'content-type': TYPES[extname(real)] ?? 'application/octet-stream' });
      response.end(body);
    } catch (error) {
      // Отсутствующий путь (ENOENT) и файл на месте компонента каталога
      // (ENOTDIR) — обычное «файла нет», каким путём оно ни возникло. Всё
      // остальное — отказ серверной стороны (нет прав EACCES, исчерпаны
      // дескрипторы EMFILE): такой запрос отвечает 500, а подробности
      // уходят в диагностический лог — читателю в ответе они не нужны.
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('нет такого файла');
        return;
      }
      console.error(`static-server: ${request.method} ${request.url} → ${file}: ${error?.message ?? error}`);
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('внутренняя ошибка сервера');
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
