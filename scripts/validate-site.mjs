import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const root = resolve(process.cwd(), 'build');
// Тот же базовый путь, с которым собирался сайт: ссылки на страницах начинаются
// с него, а файлы по-прежнему лежат в корне build.
const BASE = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');
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
  if (BASE && decoded === BASE) return resolve(root, 'index.html');
  if (decoded.startsWith('/')) {
    if (BASE && !decoded.startsWith(`${BASE}/`)) return resolve(root, 'missing-base-prefix');
    const rooted = BASE ? decoded.slice(BASE.length) : decoded;
    return resolve(root, rooted.slice(1), rooted.endsWith('/') ? 'index.html' : '');
  }
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

// Страница всей книги повторяет прозу глав целиком: она для печати, PDF и
// читалки. В индексе поиска она удвоила бы каждую находку и сам файл
// (1,6 → 2,9 МБ), а в офлайн-копии — её объём, ничего не добавив читателю.
const DUPLICATE_ROUTES = new Set(['/book/']);
const assessment = cache.get(resolve(root, 'assessment', 'index.html'));
const siteJs = await readFile(resolve(root, 'assets', 'site.js'), 'utf8');
const siteCss = await readFile(resolve(root, 'assets', 'site.css'), 'utf8');
if (!siteJs.includes('server-infrastructure-reader-v1') || !siteJs.includes('data-highlight-color')) failures.push('site.js: missing reader notebook behavior');
if (!siteCss.includes('.notes-panel') || !siteCss.includes('.reader-highlight')) failures.push('site.css: missing reader notebook styles');
if (!siteJs.includes('recordQuickCheck') || !siteCss.includes('.chapter-trainer')) failures.push('assets: missing chapter trainer behavior or styles');
// Промах не показывает ни верный вариант, ни разбор: он меняет вопрос внутри
// слота. Раньше неверный ответ подсвечивал верный и печатал разбор — и кнопка
// «Проверить ещё раз» не значила ничего, оставалось повторить увиденное. В
// разметке эта разница не видна: подсветку ставит класс, а разбор берётся из
// data-атрибута, и оба места выглядят одинаково при любом исходе.
if (!siteJs.includes('data-trainer-variant')) failures.push('site.js: the trainer never swaps the question after a miss');
for (const [pattern, what] of [
  [/dataset\.explanation/g, 'the explanation is read outside the two correct-answer branches'],
  [/classList\.add\('is-correct'\)/g, 'the correct option is marked outside the two correct-answer branches'],
]) {
  const hits = siteJs.match(pattern)?.length ?? 0;
  if (hits !== 2) failures.push(`site.js: ${what} (${hits} places instead of 2)`);
}
// Полнотекстовый поиск: индекс собран по всем маршрутам и доступен с каждой страницы.
if (!siteJs.includes('loadSearchIndex') || !siteCss.includes('.search-panel')) failures.push('assets: missing full-text search behavior or styles');
try {
  // Индекс хранится компактно: страницы отдельной таблицей, раздел — массивом.
  // Правила работают на развёрнутом виде, чтобы не повторять формат в двух местах.
  const packed = JSON.parse(await readFile(resolve(root, 'assets', 'search.json'), 'utf8'));
  if (packed.v !== 2 || !Array.isArray(packed.p) || !Array.isArray(packed.s)) throw new Error('shape');
  const searchIndex = packed.s.map(([page, anchor, heading, text]) => ({ u: packed.p[page]?.[0], t: packed.p[page]?.[1], a: anchor, h: heading, x: text }));
  const indexedRoutes = new Set(searchIndex.map((entry) => entry.u));
  if (searchIndex.length < 400) failures.push(`search index: only ${searchIndex.length} sections`);
  if (indexedRoutes.size !== htmlFiles.length - DUPLICATE_ROUTES.size) failures.push(`search index: covers ${indexedRoutes.size} of ${htmlFiles.length - DUPLICATE_ROUTES.size} routes`);
  for (const url of DUPLICATE_ROUTES) if (indexedRoutes.has(url)) failures.push(`search index: ${url} repeats prose that is already indexed`);
  const malformed = searchIndex.filter((entry) => !entry.u || !entry.h || !entry.x);
  if (malformed.length) failures.push(`search index: ${malformed.length} sections without url, heading or text`);
  for (const entry of searchIndex) {
    if (entry.a && !cache.get(resolve(root, entry.u.slice(1), 'index.html'))?.includes(`id="${entry.a}"`)) {
      failures.push(`search index: dangling anchor ${entry.u}#${entry.a}`);
      break;
    }
  }
} catch { failures.push('assets: missing or invalid search.json'); }
// Рядом с индексом лежит он же сжатым: офлайн-копия хранит именно его, и
// расхождение между файлами не видно ниоткуда — поиск без сети просто начнёт
// отвечать по устаревшей книге. Сверяем не размер, а сами байты.
try {
  const plain = await readFile(resolve(root, 'assets', 'search.json'));
  const packed = await readFile(resolve(root, 'assets', 'search.json.gz'));
  if (!gunzipSync(packed).equals(plain)) failures.push('assets: search.json.gz does not unpack to search.json');
  if (packed.length >= plain.length) failures.push('assets: search.json.gz is not smaller than the plain index');
  if (!siteJs.includes('DecompressionStream')) failures.push('site.js: the search does not try the packed index');
} catch (error) {
  failures.push(`assets: search.json.gz is missing or broken (${error.message})`);
}
for (const [file, html] of cache) {
  if (!html.includes('data-search-open')) failures.push(`${file}: missing site search entry point`);
}
// Справочник терминов: база должна быть встроена в site.js и содержать глоссарий целиком.
const termsMatch = siteJs.match(/const TERMS=(\[[\s\S]*?\]);\r?\nconst defineCard/);
// База нужна двум правилам: здесь — целостность записей, ниже — покрытие текста.
// Разбор один: две копии регулярки разошлись бы с генератором поодиночке.
const terms = termsMatch ? JSON.parse(termsMatch[1]) : [];
if (!termsMatch) failures.push('site.js: missing term reference base');
else {
  if (terms.length < 200) failures.push(`site.js: term base too small (${terms.length})`);
  for (const required of ['NUMA', 'iowait', 'Multipath', 'Readiness probe', 'Page cache']) {
    if (!terms.some((entry) => entry.term === required)) failures.push(`term base: missing "${required}"`);
  }
  const broken = terms.filter((entry) => !entry.html || (entry.chapter !== null && !(entry.chapter >= 0 && entry.chapter <= 33)));
  if (broken.length) failures.push(`term base: ${broken.length} entries with empty text or bad chapter`);
  // Имя и написание принадлежат одной статье. Индекс панели занимает ключ первым
  // совпадением и молча отбрасывает второе: «mac» отвечал статьёй Ethernet вместо
  // «MAC-адрес», «плейбук» — статьёй YAML вместо Ansible, а «Тайм-аут» и Timeout
  // были двумя статьями об одном понятии, из которых читатель видел только одну.
  // В разметке и в сборке этого не видно: панель просто отвечает не тем.
  const owner = new Map();
  const clashes = [];
  terms.forEach((entry, index) => {
    for (const variant of [entry.term, ...(entry.aliases ?? [])]) {
      const key = String(variant).toLowerCase().trim();
      if (!key) continue;
      const held = owner.get(key);
      if (held === undefined) owner.set(key, index);
      // Повтор внутри одной статьи безвреден: ответ тот же. Ловим только случай,
      // когда написание уводит читателя в чужую статью.
      else if (held !== index) clashes.push(`${variant}: ${terms[held].term} / ${entry.term}`);
    }
  });
  if (clashes.length) failures.push(`term base: one spelling claimed twice — ${clashes.slice(0, 6).join('; ')}`);
}
if (!siteCss.includes('.define-card')) failures.push('site.css: missing definition card styles');
// Контраст текста к фону. Цвет — единственное место в оформлении, где дефект
// не виден именно тому, кто его вносит: правка палитры выглядит нормально на
// хорошем экране, а порог WCAG она уже не проходит. Проверка axe нашла 187
// таких узлов: ссылка в прозе давала 4.34 при нужных 4.5, а надзаголовок
// «ЧАСТЬ I» бирюзовым по кремовому — 2.66. Тёмная тема при этом была чиста,
// то есть глазами расхождение между темами не ловится вовсе.
{
  const luminance = (hex) => {
    const channels = [0, 2, 4].map((at) => {
      const value = parseInt(hex.slice(1 + at, 3 + at), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (fg, bg) => {
    const [high, low] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  };
  const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
  const themes = {
    'светлая': tokens(siteCss.slice(siteCss.indexOf(':root{'), siteCss.indexOf('}', siteCss.indexOf(':root{')))),
    'тёмная': tokens(siteCss.slice(siteCss.indexOf('html[data-theme=dark]{'), siteCss.indexOf('}', siteCss.indexOf('html[data-theme=dark]{')))),
  };
  // Цвета текста и поверхности, на которых этот текст действительно стоит.
  for (const [theme, palette] of Object.entries(themes)) {
    for (const ink of ['ink', 'muted', 'link', 'teal-ink']) {
      for (const surface of ['paper', 'white', 'soft']) {
        const fg = palette[ink];
        const bg = palette[surface];
        if (!fg || !bg) { failures.push(`site.css: ${theme} theme lost token --${fg ? surface : ink}`); continue; }
        const value = contrast(fg, bg);
        if (value < 4.5) failures.push(`site.css: ${theme} тема, --${ink} на --${surface} даёт контраст ${value.toFixed(2)} при нужных 4.5`);
      }
    }
  }
}

// «Что нового» на странице «О курсе» собирается из верхней записи CHANGELOG.md.
// Файл и страница расходятся молча: в репозитории запись есть, а на сайте
// осталась прошлая — читатель узнаёт об изменениях последним.
{
  const about = cache.get(resolve(root, 'about', 'index.html')) ?? '';
  const changelog = await readFile(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8').catch(() => '');
  if (!changelog) failures.push('build: CHANGELOG.md is missing');
  else {
    const latest = changelog.match(/\n## ([^\n]+)\n([\s\S]*?)(?=\n## |$)/);
    const items = [...(latest?.[2] ?? '').matchAll(/^- (.+)$/gm)].map((match) => match[1]);
    if (items.length < 3) failures.push(`CHANGELOG.md: the newest entry has ${items.length} lines, expected at least three`);
    if (!about.includes('id="whats-new"')) failures.push('/about/: missing the "what is new" block');
    else if (latest && !about.includes(latest[1])) failures.push(`/about/: shows an entry other than the newest one (${latest[1]})`);
    const shown = [...about.matchAll(/<li>([\s\S]{20,}?)<\/li>/g)].map((match) => match[1].replace(/<[^>]+>/g, ''));
    const first = items[0]?.replace(/\*\*/g, '').slice(0, 40);
    if (first && !shown.some((line) => line.startsWith(first.slice(0, 30)))) {
      failures.push('/about/: the "what is new" block does not match the newest CHANGELOG entry');
    }
  }
}
// Метаданные страницы. Без og-разметки ссылка на главу, отправленная в
// мессенджер, остаётся голым адресом — и заметить это по самой странице нельзя.
// Описание не должно повторять заголовок: в выдаче поисковика тогда две
// одинаковые строки вместо строки и пояснения.
{
  let robots = null;
  try { robots = await readFile(resolve(root, 'robots.txt'), 'utf8'); } catch { failures.push('build: missing robots.txt'); }
  const site = (process.env.SITE_URL ?? '').replace(/\/+$/, '');
  if (site) {
    let sitemap = null;
    try { sitemap = await readFile(resolve(root, 'sitemap.xml'), 'utf8'); } catch { failures.push('build: SITE_URL is set but sitemap.xml is missing'); }
    if (sitemap) {
      const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
      const missing = htmlFiles
        .map((file) => site + file.slice(root.length).replace(/index\.html$/, '').replace(/\\/g, '/'))
        .filter((url) => !listed.has(url) && !DUPLICATE_ROUTES.has(BASE ? url.slice(BASE.length) : url));
      if (missing.length) failures.push(`sitemap.xml: ${missing.length} routes are missing, first ${missing[0]}`);
    }
    if (robots && !robots.includes('Sitemap:')) failures.push('robots.txt: no Sitemap line while SITE_URL is set');
  }
  const thin = [];
  for (const [file, html] of cache) {
    if (!html.includes('property="og:title"')) { failures.push(`${file.slice(root.length)}: missing link preview tags`); break; }
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/ · Серверная инфраструктура$/, '');
    const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
    if (title && description === title) thin.push(file.slice(root.length));
  }
  // Служебные страницы (тренажёр, справочник) описываются своим заголовком
  // осмысленно; правило ловит случай, когда так живут все 34 главы.
  if (thin.filter((file) => file.includes('chapters/')).length) {
    failures.push(`chapters: ${thin.filter((file) => file.includes('chapters/')).length} pages describe themselves with their own title`);
  }
}
// Скрипт стенда и глава 0 описывают одну топологию. Разъехавшись, они не
// ломают ни сборку, ни разметку: стенд поднимется, просто не тот, о котором
// написаны работы, — и читатель будет искать ошибку у себя.
{
  let stand = null;
  try { stand = await readFile(resolve(root, '..', 'scripts', 'stand', 'course-stand.sh'), 'utf8'); } catch { failures.push('build: missing scripts/stand/course-stand.sh'); }
  const chapter0 = cache.get(resolve(root, 'chapters', '00', 'index.html')) ?? '';
  if (stand) {
    const table = stand.match(/STAND_NODES=\(([\s\S]*?)\n\)/)?.[1] ?? '';
    const rows = [...table.matchAll(/'([a-z0-9]+)\|[^']*'/g)].map((match) => match[1]);
    if (rows.length !== 6) failures.push(`course-stand.sh: expected six nodes in the address table, got ${rows.length}`);
    for (const address of new Set([...table.matchAll(/\d+\.\d+\.\d+\.\d+\/\d+/g)].map((match) => match[0]))) {
      if (!chapter0.includes(address)) failures.push(`course-stand.sh: ${address} is not in the chapter 0 address plan`);
    }
    // Имя узла проверяется вместе со всеми его адресами: «ansible» встречается
    // в главе прозой, и простая проверка вхождения пропустила бы переименованный
    // узел. Порядок адресов в строке главы свой — он идёт от смысла интерфейса,
    // а не от номера, поэтому сверяется состав, а не последовательность.
    for (const row of table.split('\n')) {
      const node = row.match(/'([a-z0-9]+)\|(?:[^|]*\|){4}([^']*)'/);
      if (!node) continue;
      const [name, links] = [node[1], node[2]];
      if (name === 'router') continue;
      const line = chapter0.match(new RegExp(`${name}\\s*-&gt;([^<]*)`))?.[1];
      if (!line) { failures.push(`course-stand.sh: chapter 0 never gives ${name} an address`); continue; }
      for (const address of links.match(/\d+\.\d+\.\d+\.\d+\/\d+/g) ?? []) {
        if (!line.includes(address)) failures.push(`course-stand.sh: chapter 0 does not give ${name} the address ${address}`);
      }
    }
    for (const bridge of ['vmbr10', 'vmbr20', 'vmbr30']) {
      if (!stand.includes(bridge) || !chapter0.includes(bridge)) failures.push(`course-stand.sh: bridge ${bridge} is missing from the script or from chapter 0`);
    }
    // Строка из книги должна вести в существующий файл: переименованный скрипт
    // оставляет в главе команду, которая скачивает пустоту.
    const link = chapter0.match(/raw\.githubusercontent\.com\/[^"<)\s]+/)?.[0];
    if (!link) failures.push('chapter 0: the one-line stand command is gone from the prose');
    else if (!link.endsWith('/scripts/stand/course-stand.sh')) failures.push(`chapter 0: the one-line command points at ${link}`);
    // Скрипт меняет чужую машину, поэтому обязан показывать план прежде
    // действия, не трогать чужие идентификаторы и убирать только своё.
    for (const [needle, what] of [
      ['ACTION="${1:-${STAND_ACTION:-plan}}"', 'plan is not the default action'],
      ['идентификаторы заняты', 'existing VMIDs are not refused'],
      ['не наша машина', 'destroy does not skip machines without the tag'],
      ['не меняется: на нём живёт управление', 'the management bridge is not declared untouched'],
      // Пять узлов выходят в сеть через router, а он в этот момент ещё
      // загружается. Список packages выполняется один раз и без повторов —
      // гости остались бы без агента и tcpdump, а сообщение об этом ушло бы в
      // журнал гостя, куда читатель не смотрит.
      ['getent hosts', 'guest setup does not wait for the router to come up'],
      // Без пароля и без ключа у гостя нет ни того, ни другого: в консоль
      // Proxmox он тоже не войдёт. Шесть недоступных машин — ровно тот случай,
      // ради которого скрипт и писался.
      ['нечем входить в гостей', 'create does not refuse when there is no way to log into the guests'],
      // Совет, который читателю надо выполнить, печатается готовым. Первая
      // версия печатала его с подстановкой $(…): у читателя она разворачивалась
      // в несколько слов, и pvesm отвечал «too many arguments».
      ['storage_field "$SNIPPETS" content', 'the snippets refusal does not print a ready command'],
      // qm set принимает несуществующий мост молча: отказ всплывает только на
      // qm start, когда машина уже создана. Поэтому и мост управления, и мосты
      // стенда проверяются по /sys/class/net до запуска, а имя vmbr0 не
      // зашивается: оно частое, но не обязательное.
      ['detect_wan()', 'the management bridge is hard-coded instead of detected'],
      ['моста $WAN_BRIDGE на хосте нет', 'create does not check that the management bridge exists'],
      ['так и не поднялся', 'the lab bridges are not verified after the network reload'],
      // Управление хоста может жить не на мосту, а на обычном интерфейсе:
      // подключить к нему машину нельзя, а перекладывать управляющий интерфейс
      // в мост по чужому совету — верный способ потерять доступ к хосту.
      ['[ "$WAN_MODE" = nat ]', 'there is no way out for a host whose management is not on a bridge'],
      ['MASQUERADE', 'the nat mode does not actually translate addresses'],
      // Сводка «что изменится» печатается прямо перед вопросом «нажимать ли
      // yes», поэтому собирается из тех же данных, что и действия. Написанная
      // рукой, она отстала от кода: режим трансляции заводит ещё один мост и
      // правило на хосте, а строка об этом молчала.
      ['for entry in "${STAND_BRIDGES[@]}"; do touched=', 'the summary of what changes is written by hand'],
      // «running» говорит лишь то, что процесс машины жив: про готовность гостя
      // оно не говорит ничего — тот же урок, что и с «Up» у контейнера в главе
      // 22. Настройка гостя заканчивается установкой агента, поэтому его ответ
      // и есть признак того, что гость настроился, а не просто включился.
      ['qm agent "$id" ping', 'status calls a machine ready when its process is merely running'],
      // Диск cloud-init лежит на SCSI, а не на ide2 из документации Proxmox. В
      // машине q35 привод ide2 висит на AHCI, а в облачном ядре Debian собраны
      // драйверы только виртуальных устройств: диска с меткой cidata в госте
      // нет, ds-identify источник данных не находит и снимает все юниты
      // cloud-init с загрузки. Шесть машин при этом поднимаются до конца и
      // молча — без имени, без пользователя и без адреса, и ни create, ни
      // журнал гостя об этом не говорят ничего.
      ['"--scsi${CI_SLOT}" "$STORAGE:cloudinit"', 'the cloud-init drive is not on the bus of the root disk'],
      // Прерванная сборка и стенд, собранный прежней версией скрипта, — это
      // заведённые машины, которым не хватает настройки. Пересоздавать их
      // значит терять то, что читатель на них успел сделать, а отказываться по
      // занятому идентификатору — оставлять его без стенда. Чужие машины при
      // этом по-прежнему не трогаются вовсе.
      ['машина уже есть — донастраиваю', 'create recreates machines that already exist instead of configuring them'],
      ['&& ! ours "$id"', 'the busy-VMID refusal does not tell our own machines from foreign ones'],
      // Прежняя версия ставила диск cloud-init на ide2. Оставить оба — значит
      // оставить гостю два источника данных, и выберет он не тот.
      ['ci_slots()', 'a cloud-init drive left in the old slot is not moved'],
      // План печатается для того, чтобы его прочитали и переслали, — и пароль от
      // всех шести машин уезжал вместе с ним: в переписку, в историю терминала,
      // в вырезку на экране. Выполняется настоящее значение, скрыт только показ.
      ['[ "$prev" = --cipassword ]', 'the printed command shows the cloud-init password in clear text'],
      // Proxmox по умолчанию просит cloud-init обновить систему на первой
      // загрузке, и делает это раньше runcmd — то есть раньше нашего ожидания
      // связи. Пойманное на живом хосте: гость, запущенный за пятнадцать секунд
      // до того, как router поднял трансляцию, ушёл в apt по неработающей сети
      // и провисел в нём двадцать минут. Сам apt при этом не отвалился ни по
      // какому таймауту, а cloud-init не двинулся дальше: машина «running»,
      // гость молчит, в журнале хоста ни строки. Единственный apt в госте
      // должен быть наш — после проверки связи.
      ['--ciupgrade 0', 'the cloud-init package upgrade runs before the guest has checked for network'],
      // Фиксированной паузы после запуска router не хватало и не могло хватать:
      // он поднимает трансляцию после установки пакетов, через две-три минуты.
      // Ждать надо признак, а не время — агент router отвечает только тогда,
      // когда трансляция уже есть.
      // Ищем вызов, а не объявление: оставшаяся в файле функция выглядит в
      // разметке скрипта точно так же, как работающая, — а сборка машин при
      // этом снова идёт по слепой паузе.
      ['wait_router "$id"', 'the stand waits a fixed number of seconds for router instead of waiting for it to be ready'],
      ['qm agent "$id" ping >/dev/null 2>&1', 'the wait for router does not ask the guest agent whether it is ready'],
      // Агент ставится отдельной командой и последним. Попади он в общий список
      // пакетов, он отвечал бы с середины настройки — и «гость настроен» в
      // status, и ожидание router означали бы «гость на полпути», а у router —
      // что трансляции ещё нет.
      ['$apt install -y qemu-guest-agent', 'the guest agent is not the last thing the guest setup installs'],
      // Правила трансляции применяются из файла. С nft add rule повторная
      // настройка гостя — её делает повторный create — клала ещё одно такое же
      // правило, и прежняя версия сохраняла дубль в /etc/nftables.conf, где он
      // переживал перезагрузку. Трансляция работает и с дублем: заметить его
      // можно только сравнив nft list ruleset с выводом, напечатанным в книге.
      ['nft -f /etc/nftables.conf', 'the router adds nat rules instead of applying them from a file'],
      // Учебные диски получают WWN, а не только серийный номер. Книга учит
      // адресовать диск по /dev/disk/by-id — «стабильные имена по WWN или
      // серийнику», — а udev берёт идентификатор со страницы VPD 0x83, куда
      // QEMU кладёт имя слота: без WWN упражнение показывает читателю ссылку
      // drive-scsi1, то есть ровно то, от чего оно его отучает. В lsblk
      // серийник при этом виден, и подмены не заметить.
      ['wwn=0x', 'the lab disks have no WWN, so /dev/disk/by-id names them by slot instead of by identity'],
      // Номер стенда: заводится один раз, кладётся в каждого гостя и в карточку
      // для кабинета. Без него метка /etc/course-lab-stand остаётся одинаковой
      // у всех, и работа, ломающая настройки машины, запустится на любой, где
      // метку завели руками.
      ['ensure_stand_id\n', 'the stand number is defined but never used'],
      ['- path: /etc/course-lab-stand', 'the stand number does not reach the guests'],
      ['course-stand\\",\\"stand', 'the card the cabinet reads is not written'],
    ]) if (!stand.includes(needle)) failures.push(`course-stand.sh: ${what}`);
    // Тот же случай с другой стороны: агент в общем списке пакетов снова начнёт
    // отвечать до конца настройки, и оба признака готовности станут ложными.
    if (/install -y (?:\S+ )+qemu-guest-agent|install -y qemu-guest-agent[ \t]+\S/.test(stand)) failures.push('course-stand.sh: the guest agent is installed together with the other packages, so it answers before the setup is over');
    // С --vga serial0 кнопка «Console» в веб-интерфейсе показывает пустой экран,
    // и первый гипервизор выглядит сломанным.
    // Ищем флаг в команде, а не где угодно: в комментарии рядом он назван тем
    // же текстом, и простая проверка вхождения срабатывала на объяснении.
    if (/^[^#\n]*--vga serial0/m.test(stand)) failures.push('course-stand.sh: the web console is turned off by --vga serial0');
    // Каталог сниппетов берётся из настройки хранилища: с STAND_SNIPPETS на
    // другом хранилище зашитый путь развёл бы файлы и то место, где их ищет qm,
    // и гость поднялся бы вообще без настройки.
    if (/^[^#\n]*\/var\/lib\/vz\/snippets/m.test(stand)) failures.push('course-stand.sh: the snippets directory is hard-coded instead of read from the storage');
    // Тот же случай с другой стороны: вернуть привод на ide2 — значит вернуть
    // шесть молча недонастроенных машин. Ищем флаг в команде, а не где угодно:
    // в комментарии рядом он назван тем же текстом.
    if (/^[^#\n]*--ide2/m.test(stand)) failures.push('course-stand.sh: the cloud-init drive is back on ide2, where the cloud kernel never sees it');
  }
}
// Работа без сети. Обслуживающий скрипт не разбирается сборкой так же, как и
// остальной клиентский код: синтаксическая ошибка в нём проходит молча, а сайт
// после этого просто перестаёт открываться офлайн — в разметке ни следа.
{
  let worker = null;
  try { worker = await readFile(resolve(root, 'sw.js'), 'utf8'); } catch { failures.push('build: missing sw.js'); }
  if (worker) {
    try { new Function(worker); } catch (error) { failures.push(`sw.js: syntax error — ${error.message}`); }
    if (!/const VERSION='[0-9a-f]{8,}'/.test(worker)) failures.push('sw.js: cache version is missing, a new build would not replace the old copy');
    const listed = new Set(JSON.parse(worker.match(/const ROUTES=(\[[^\]]*\])/)?.[1] ?? '[]'));
    const missing = htmlFiles
      .map((file) => file.slice(root.length).replace(/index\.html$/, '').replace(/\\/g, '/'))
      .map((url) => (BASE ? BASE + url : url))
      .filter((url) => !listed.has(url) && !DUPLICATE_ROUTES.has(BASE ? url.slice(BASE.length) : url));
    if (missing.length) failures.push(`sw.js: ${missing.length} routes are not saved for offline use, first ${missing[0]}`);
    // Число страниц в офлайн-копии названо на «Маршруте» прозой. Оно не равно
    // числу маршрутов: «/book/» в кэш не идёт намеренно. Написанное рукой, оно
    // разошлось бы с манифестом молча — читатель видит одно число, кнопка кладёт
    // другое.
    const route = cache.get(resolve(root, 'route', 'index.html')) ?? '';
    const promised = route.match(/весь курс — ([0-9]+) страниц/)?.[1];
    if (!promised) failures.push('route: the offline section never says how many pages the button saves');
    else if (Number(promised) !== listed.size) failures.push(`route: promises ${promised} offline pages, sw.js caches ${listed.size}`);
    if (!siteJs.includes('serviceWorker.register')) failures.push('site.js: service worker is never registered');
    const page = cache.get(resolve(root, 'index.html')) ?? '';
    if (!page.includes("worker-src 'self'")) failures.push('index.html: the policy forbids the service worker it registers');
  }
}
for (let number = 0; number < 34; number += 1) {
  const chapter = cache.get(resolve(root, 'chapters', String(number).padStart(2, '0'), 'index.html'));
  if (!chapter?.includes(`data-chapter-trainer="${number}"`)) failures.push(`chapter ${number}: missing quick trainer`);
  const count = chapter?.match(/data-trainer-question=/g)?.length ?? 0;
  if (count !== 2) failures.push(`chapter ${number}: expected 2 quick questions, got ${count}`);
  // Свободное воспроизведение идёт до мини-тренажёра: узнавание вариантов, увиденное
  // первым, подсказывает формулировки и обесценивает попытку вспомнить.
  if (!chapter?.includes(`data-chapter-recall="${number}"`)) failures.push(`chapter ${number}: missing free-recall block`);
  else if (chapter.indexOf('data-chapter-recall=') > chapter.indexOf('data-chapter-trainer=')) {
    failures.push(`chapter ${number}: free recall must come before the quick trainer`);
  }
  if (/data-recall-topic[^>]*checked/.test(chapter ?? '')) failures.push(`chapter ${number}: recall topics must start unchecked`);
  // Вопрос до чтения стоит во вводной части: после первого нумерованного раздела
  // он перестаёт быть вопросом до чтения и становится обычной самопроверкой.
  const pretest = chapter?.indexOf('class="pretest"') ?? -1;
  if (pretest < 0) failures.push(`chapter ${number}: missing pre-reading question`);
  else {
    const firstSection = chapter.search(new RegExp(`<h2 id="[^"]+">${number}\\.\\d`));
    if (firstSection >= 0 && pretest > firstSection) failures.push(`chapter ${number}: pre-reading question must sit before section ${number}.1`);
  }
  // Верный ответ мини-тренажёра не печатается в разметку открытым номером.
  for (const match of chapter?.matchAll(/data-answer="([^"]*)"/g) ?? []) {
    if (/^\d+$/.test(match[1])) failures.push(`chapter ${number}: quick trainer prints the answer index in the markup`);
  }
}
// Вводная часть «Начало»: пять уроков для читателя без опыта. Она живёт вне
// нумерации глав, поэтому обычные проверки глав её не касаются — и без
// отдельных правил её падение осталось бы незамеченным.
const LESSON_COUNT = 5;
for (let number = 1; number <= LESSON_COUNT; number += 1) {
  const file = resolve(root, 'start', String(number).padStart(2, '0'), 'index.html');
  const lesson = cache.get(file);
  if (!lesson) { failures.push(`lesson ${number}: page is missing`); continue; }
  const headings = lesson.match(/<h1[^>]*>/g)?.length ?? 0;
  const expected = number === 1 ? 2 : 1;
  if (headings !== expected) failures.push(`lesson ${number}: expected ${expected} h1, got ${headings}`);
  // Урок без разбора — это чтение без проверки: свёрнутый блок «Проверьте себя»
  // единственное место, где читатель может убедиться, что понял.
  if (!lesson.includes('<summary>Проверьте себя</summary>')) failures.push(`lesson ${number}: missing the self-check block`);
  // Разбор прячется за своим катом внутри блока. Лежащий рядом с вопросами, он
  // читается раньше попытки вспомнить — а попытка и есть то, ради чего блок
  // стоит. В разметке разница не видна: текст тот же, на месте.
  const cut = /<details class="answer-cut">\s*<summary>Показать разбор<\/summary>\s*<p><strong>Разбор\.<\/strong>/;
  if (lesson.includes('<strong>Разбор.</strong>') && !cut.test(lesson)) {
    failures.push(`lesson ${number}: the answer sits next to the questions instead of behind its own cut`);
  }
}
// Последний урок обязан вести в главу 00: вводная часть кончается там, где
// начинается курс, и тупика в конце быть не должно.
const lastLesson = cache.get(resolve(root, 'start', '05', 'index.html')) ?? '';
if (!/<nav class="pager"[^>]*>[\s\S]*?href="[^"]*\/chapters\/00\/"[\s\S]*?<\/nav>/.test(lastLesson)) {
  failures.push('lesson 5: the pager must lead on to chapter 00');
}
// Вход в неё виден с главной и из программы, иначе часть существует, но её не находят.
for (const [name, file] of [['home', resolve(root, 'index.html')], ['curriculum', resolve(root, 'curriculum', 'index.html')]]) {
  if (!cache.get(file)?.includes('/start/01/')) failures.push(`${name}: no entry point into the introductory part`);
}
// Заголовок части забирает первый урок: на странице «О курсе» ему делать нечего.
if (cache.get(resolve(root, 'about', 'index.html'))?.includes('id="start-part"')) {
  failures.push('about: the introductory part heading leaked onto the about page');
}
// Практикум нумеруется по академическим модулям U00–U36, а главы — отдельно.
// Ссылка «Теория» с работы L<N> обязана вести в ту главу, внутри которой физически
// находится заголовок модуля U<N>, иначе связка практикума и теории разъезжается.
const MODULE_COUNT = 37;
const chapterHtml = Array.from({ length: 34 }, (_, number) => cache.get(resolve(root, 'chapters', String(number).padStart(2, '0'), 'index.html')));
const linkedModules = new Set();
for (let number = 0; number < MODULE_COUNT; number += 1) {
  const padded = String(number).padStart(2, '0');
  const owner = chapterHtml.findIndex((html) => html?.includes(`id="ch${padded}"`));
  if (owner < 0) { failures.push(`module ch${padded}: not found in any chapter page`); continue; }
  // Работа больше не отдельная страница: её текст лежит секцией на странице
  // практики. Связка «работа → теория» от этого не изменилась, проверяется она
  // теперь по ссылке внутри самой секции.
  const section = assessment?.match(new RegExp(`<section data-lab-module="${number}">([\\s\\S]*?)</section>`))?.[1];
  if (!section) { failures.push(`lab ${padded}: text is missing from the practice page`); continue; }
  const expected = `href="${BASE}/chapters/${String(owner).padStart(2, '0')}/#ch${padded}"`;
  if (!section.includes(expected)) failures.push(`lab ${padded}: theory link must point to chapter ${String(owner).padStart(2, '0')} (module U${padded} lives there)`);
}
for (const html of chapterHtml) {
  if (!html?.includes('class="chapter-practice"')) failures.push('chapter: missing practicum bridge');
  for (const match of html?.matchAll(/href="[^"]*\/assessment\/\?module=(\d+)"/g) ?? []) linkedModules.add(Number(match[1]));
  for (const match of html?.matchAll(/href="[^"]*\/labs\/(\d+)\//g) ?? []) linkedModules.add(Number(match[1]));
}
for (let number = 0; number < MODULE_COUNT; number += 1) {
  if (!linkedModules.has(number)) failures.push(`module ${number}: unreachable from any chapter page`);
}
// Каждая глава, кроме нулевой, разбирает одно типичное заблуждение.
for (let number = 1; number < 34; number += 1) {
  const html = chapterHtml[number];
  if (!html?.includes('Типичная ошибка')) failures.push(`chapter ${number}: missing misconception block`);
}
// Разобранный пример объявлен во введении как схема из пяти шагов. Глава 33 устроена
// иначе (последовательность аварий), у главы 00 разбора нет — остальные обязаны схему держать.
const WORKED_EXAMPLE_STEPS = ['Ситуация', 'Стратегия', 'Действия', 'Интерпретация', 'Вывод'];
for (let number = 1; number < 33; number += 1) {
  const html = chapterHtml[number] ?? '';
  const headings = Array.from(html.matchAll(/<h([23])[^>]*>(.*?)<\/h\1>/gs))
    .map((match) => ({ level: Number(match[1]), text: match[2].replace(/<[^>]+>/g, '').trim() }));
  const start = headings.findIndex((heading) => heading.level === 2 && heading.text.includes('Разобранный пример'));
  if (start < 0) { failures.push(`chapter ${number}: missing worked example`); continue; }
  let end = start + 1;
  while (end < headings.length && headings[end].level === 3) end += 1;
  const steps = headings.slice(start + 1, end).map((heading) => heading.text);
  const missing = WORKED_EXAMPLE_STEPS.filter((step) => !steps.includes(step));
  if (missing.length) failures.push(`chapter ${number}: worked example lacks ${missing.join(', ')}`);
}

const chapter00 = cache.get(resolve(root, 'chapters', '00', 'index.html'));
const chapter01 = cache.get(resolve(root, 'chapters', '01', 'index.html'));
if (chapter00?.includes('id="b00-s060"')) failures.push('chapter 00: next part introduction leaked into chapter 00');
if (!chapter01?.includes('id="b00-s060"')) failures.push('chapter 01: missing Part I introduction');
let bankSize = { items: 0, cases: 0 };
let data = null;
const dataMatch = assessment?.match(/<script type="application\/json" id="study-data">(.*?)<\/script>/s);
if (!dataMatch) failures.push('assessment: missing study-data');
else {
  data = JSON.parse(dataMatch[1]);
  bankSize = { items: data.items?.length ?? 0, cases: data.cases?.length ?? 0 };
  if (data.items?.length !== 111) failures.push(`assessment: expected 111 items, got ${data.items?.length}`);
  if (data.cases?.length !== 37) failures.push(`assessment: expected 37 cases, got ${data.cases?.length}`);
  // Тип задания обязан соответствовать его форме: «Расчёт» без числовых полей —
  // обычный вопрос с выбором, и обещание расчёта в таком задании ложно.
  for (const item of data.items ?? []) {
    if (item.kind === 'calculation' && !item.fields?.length) failures.push(`item ${item.id}: kind "calculation" without numeric fields`);
    if (item.kind === 'concept' && !item.options?.length) failures.push(`item ${item.id}: kind "concept" without options`);
  }
}
// --- единообразие исходника учебника ---
// Оглавление, нумерация разделов и типографика ломаются незаметно: сайт
// собирается, ссылки работают, а читатель видит два разных названия одного
// раздела или «11.9» дважды. Проверяем это на исходном документе.
const course = await readFile(resolve(process.cwd(), 'public', 'course.html'), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const mainStart = course.indexOf('<main');
const mainEnd = course.lastIndexOf('</main>');
const body = course.slice(mainStart, mainEnd);
// Текст без разметки, кода и скриптов нужен трём правилам ниже. Тело книги —
// больше мегабайта, и каждая лишняя цепочка replace копирует его целиком,
// поэтому чистка делается один раз. Сущности убираются здесь же: «&nbsp;»
// иначе выглядит как часто встречающееся слово «nbsp».
// Мини-тренажёр главы и банк кабинета — разные ярусы проверки, и их вопросы
// обязаны различаться. Тренажёр брал два первых задания модуля прямо из
// `study-data`: читатель отвечал на те же вопросы, которые потом оцениваются,
// и видел их разбор заранее. В разметке это незаметно — вопросы там настоящие,
// просто чужие. Правило сверяет тексты вопросов обеих проверок между собой.
{
  const quick = JSON.parse(course.match(/id="chapter-quick-data"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? 'null');
  if (!quick) failures.push('course.html: missing chapter-quick-data block');
  else {
    const positions = new Map();
    const words = (text) => new Set(String(text).toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter((word) => word.length > 3));
    // Короткая формулировка («Зачем нужен scrub?») состоит из двух значимых слов,
    // и доля совпадения у неё скачет до единицы от одного общего слова. Поэтому
    // кроме доли требуется и абсолютное число совпавших слов.
    const overlap = (left, right) => {
      let common = 0;
      for (const word of left) if (right.has(word)) common += 1;
      return common >= 4 ? common / (Math.min(left.size, right.size) || 1) : 0;
    };
    const bank = (data?.items ?? []).map((item) => ({ id: item.id, words: words(item.stem) }));
    const lessonQuick = JSON.parse(course.match(/id="lesson-quick-data"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? 'null');
    if (!lessonQuick) failures.push('course.html: missing lesson-quick-data block');
    const sets = [['chapter', quick, 34, 0], ['lesson', lessonQuick ?? {}, 5, 1]];
    for (const [kind, source, count, from] of sets) for (let number = from; number < from + count; number += 1) {
      const items = source[String(number)];
      if (!Array.isArray(items) || items.length !== 2) {
        failures.push(`${kind} ${number}: expected two own quick slots`);
        continue;
      }
      // Слот — пул смежных вопросов об одном утверждении: промах меняет вопрос,
      // а не открывает верный вариант. Пул из одного вопроса возвращал бы тот же
      // вопрос с уже отмеченным неверным ответом — это не вторая попытка.
      if (!items.every((pool) => Array.isArray(pool) && pool.length >= 2)) {
        failures.push(`${kind} ${number}: each slot needs a pool of at least two questions`);
        continue;
      }
      for (const item of items.flat()) {
        if (!item.stem || !Array.isArray(item.options) || item.options.length !== 4) {
          failures.push(`quick ${item.id ?? number}: need a stem and four options`);
          continue;
        }
        if (new Set(item.options).size !== 4) failures.push(`quick ${item.id}: repeated option`);
        if (!(item.answer >= 0 && item.answer < 4)) failures.push(`quick ${item.id}: answer out of range`);
        if (!item.explanation) failures.push(`quick ${item.id}: missing explanation`);
        positions.set(item.answer, (positions.get(item.answer) ?? 0) + 1);
        const mine = words(item.stem);
        for (const entry of bank) {
          if (overlap(mine, entry.words) >= 0.6) {
            failures.push(`quick ${item.id}: repeats bank item ${entry.id}`);
            break;
          }
        }
      }
    }
    // Все варианты слота обязаны доехать до страницы: подмена вопроса после
    // промаха идёт без сети, и недостающий вариант вернул бы тот же вопрос.
    for (let number = 0; number < 34; number += 1) {
      const pools = quick[String(number)];
      if (!Array.isArray(pools)) continue;
      const expected = pools.reduce((sum, pool) => sum + (Array.isArray(pool) ? pool.length : 0), 0);
      const page = cache.get(resolve(root, 'chapters', String(number).padStart(2, '0'), 'index.html')) ?? '';
      const printed = page.match(/data-trainer-variant=/g)?.length ?? 0;
      if (printed !== expected) failures.push(`chapter ${number}: ${printed} question variants on the page, ${expected} in the pool`);
    }
    // Тот же урок, что и с банком: собранный по привычке набор проходится
    // выбором одного и того же номера.
    const total = [...positions.values()].reduce((sum, value) => sum + value, 0);
    const most = Math.max(...positions.values());
    if (most > total * 0.45) failures.push(`quick data: ${most} of ${total} correct answers sit at one position`);
  }
}
const bodyText = body
  // Подписи внешних ссылок — это названия чужих документов, а не проза книги:
  // «Red Hat Enterprise Linux documentation» давало слову documentation
  // пятнадцать вхождений и требовало на него статью в справочнике.
  .replace(/<a[^>]+href="https?:[^>]*>[\s\S]*?<\/a>/g, ' ')
  .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
  .replace(/<code[\s\S]*?<\/code>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ');

// Схемы. Рисунок в учебнике — единственное место, где смысл лежит вне текста,
// поэтому у каждой схемы обязаны быть <title> и <desc> для экранного диктора
// и подпись для всех остальных. Идентификаторы внутри SVG — общие для всего
// документа: четыре схемы с одинаковым id="tip" уже сложились в четыре
// одинаковых идентификатора, и стрелки во второй схеме просто исчезали бы,
// если бы браузер разошёлся с валидатором. Ширина у SVG не задаётся: схема
// тянется по колонке через viewBox, иначе она вылезает за меру строки.
{
  const figures = [...body.matchAll(/<figure class="scheme">([\s\S]*?)<\/figure>/g)].map((match) => match[1]);
  if (figures.length < 4) failures.push(`course.html: expected at least 4 schemes, found ${figures.length}`);
  for (const figure of figures) {
    const name = (figure.match(/<title[^>]*>([^<]*)/) ?? [, '(без заголовка)'])[1];
    if (!/<svg[^>]+role="img"/.test(figure)) failures.push(`scheme "${name}": <svg> without role="img"`);
    if (!/<desc[^>]*>/.test(figure)) failures.push(`scheme "${name}": no <desc> — a screen reader gets nothing but the caption`);
    if (!/<figcaption>/.test(figure)) failures.push(`scheme "${name}": no <figcaption>`);
    if (/<svg[^>]+\swidth=/.test(figure)) failures.push(`scheme "${name}": fixed width on <svg> — it must scale with the column`);
    if (/style="/.test(figure)) failures.push(`scheme "${name}": style= attribute is blocked by the content policy`);
  }
}

// Справочник A: разделы A.1–A.24 на месте, и у каждой команды, которая меняет
// состояние, стоит пометка «Осторожно». Справочник читают в спешке и наискось —
// команда без предупреждения там опаснее, чем её отсутствие.
const appendixA = body.slice(body.indexOf('id="b33-s044"'), body.indexOf('id="b33-s053"'));
const sectionNumbers = [...appendixA.matchAll(/<h2[^>]*>A\.(\d+)\./g)].map((match) => Number(match[1]));
for (let number = 1; number <= 24; number += 1) {
  if (!sectionNumbers.includes(number)) failures.push(`course.html: appendix A is missing section A.${number}`);
}
for (const command of ['--delete', 'sed -i', '-w /tmp/capture.pcap', 'chmod -R 777', 'strace -f -p', 'ssh -N -R']) {
  const at = appendixA.indexOf(command);
  if (at < 0) { failures.push(`appendix A: lost the "${command}" entry`); continue; }
  // Предупреждение может стоять и до команды, и после неё — важно, что оно
  // есть в том же разделе, который читатель видит целиком.
  const from = appendixA.lastIndexOf('<h2', at);
  const to = appendixA.indexOf('<h2', at);
  const section = appendixA.slice(from < 0 ? 0 : from, to < 0 ? undefined : to);
  if (!section.includes('Осторожно')) failures.push(`appendix A: "${command}" changes state but its section carries no warning`);
}
// Работы практикума читает один человек за одним стендом. Пять из них
// остались от аудиторного формата и описывали двоих: «учащийся по описанному
// сценарию отключает путь; студент фиксирует деградацию» — читателю в этом
// месте непонятно, кто он и что делать. Проверяем только сами работы:
// в экзаменационных рубриках ниже «студент» — законное слово.
{
  const works = body.slice(body.indexOf('id="lab00"'), body.indexOf('id="collector-code"'));
  const classroom = [...works.matchAll(/(?:^|[^а-яё])(учащ[а-яё]+|студент[а-яё]*)/gi)].map((match) => match[1]);
  if (classroom.length) {
    failures.push(`labs: the works still speak of ${[...new Set(classroom)].join(', ')} — they are done alone`);
  }
}
// Мост «глава → модуль». При двойной нумерации (глава 15 содержит U15–U17,
// глава 25 — U28) строка «Академическое продолжение этой главы» — единственная
// подсказка, где искать углубление. Она отсутствовала в десяти главах из
// тридцати трёх, а глава 2 обещала U03, который лежит в главе 3: ссылка вела
// вперёд, в чужой текст. Сверяем обещание с тем, что физически лежит в главе.
{
  const heads = [...body.matchAll(/<h1 id="b(\d\d)">/g)];
  const moduleMarks = [...body.matchAll(/id="ch(\d\d)"/g)];
  heads.forEach((head, index) => {
    const from = head.index;
    const to = heads[index + 1]?.index ?? body.length;
    const inside = moduleMarks.filter((mark) => mark.index > from && mark.index < to).map((mark) => mark[1]);
    const bridge = body.slice(from, Math.min(to, from + 900)).match(/Академическое продолжение этой главы:<\/strong>([\s\S]*?)<\/p>/);
    const named = bridge ? [...bridge[1].matchAll(/#ch(\d\d)/g)].map((match) => match[1]) : [];
    if (named.join(',') !== inside.join(',')) {
      failures.push(`chapter ${head[1]}: the module bridge names [${named.join(', ') || '—'}] but the chapter holds [${inside.join(', ') || '—'}]`);
    }
  });
}
// Обращение к читателю. Книга собиралась из разных источников, и половина
// текста говорила «ты», половина «вы» — иногда через абзац. Местоимения были
// только верхушкой: команды читателю («создай», «сравни», «переходи дальше»)
// и глаголы второго лица («пока не можешь ответить») жили в тексте ещё
// пятьюстами вхождениями. Прямая речь в кавычках («какое решение ты принял?» —
// вопрос к ядру; задача вида «сервер не работает — найди причину») под правило
// не подпадает, поэтому кавычки вырезаются до проверки.
{
  const prose = bodyText.replace(/«[^»]*»/g, ' ');
  const singular = [...prose.matchAll(/(?<![а-яё])(ты|тебя|тебе|тобой|твой|твоя|твоё|твои|твоих|твоей|твоего|твоим)(?![а-яё])/gi)];
  if (singular.length) {
    failures.push(`course.html: the reader is addressed as «ты» in ${singular.length} places, the book says «вы»`);
  }
  const present = [...prose.matchAll(/(?<![А-Яа-яЁё])[А-Яа-яЁё]{2,}(?:ешь|ишь)(?![а-яё])/gi)].map((match) => match[0]);
  if (present.length) {
    failures.push(`course.html: second-person singular verbs in prose: ${[...new Set(present)].slice(0, 5).join(', ')}`);
  }
  // Формы множественного числа берутся из самой книги: если «создайте» в ней
  // есть, то «создай» — та же команда, сказанная на «ты».
  const plural = new Set([...prose.matchAll(/(?<![А-Яа-яЁё])([А-Яа-яЁё]{3,}(?:йте|ите|ьте))(?![а-яё])/gi)].map((match) => match[1].toLowerCase()));
  // «привяжи API к loopback» в лаборатории 22.14 пережило это правило: пары
  // «привяжите» в книге не было ни разу, а формы берутся из самой книги. Глагол,
  // употреблённый в единственном числе один-единственный раз, так и остаётся
  // невидимым. Поэтому к формам из книги добавлен список команд, которыми
  // учебник обращается к читателю постоянно, — их единственное число ошибка
  // всегда, встречается такая форма в книге или нет.
  const ORDERS = ['привяжите', 'создайте', 'сделайте', 'выполните', 'запишите', 'измерьте', 'настройте', 'проверьте',
    'откройте', 'запустите', 'соберите', 'сломайте', 'поставьте', 'возьмите', 'посмотрите', 'найдите', 'сохраните',
    'покажите', 'объясните', 'назовите', 'сравните', 'проведите', 'добавьте', 'уберите', 'остановите', 'включите',
    'отключите', 'повторите', 'прочитайте', 'снимите', 'перейдите', 'ответьте', 'опишите', 'составьте', 'подключите',
    'удалите', 'замените', 'пропустите', 'зафиксируйте', 'разверните', 'подсчитайте', 'выберите'];
  for (const word of ORDERS) plural.add(word);
  const singles = new Set([...plural].map((word) => word.slice(0, -2)));
  const orders = [...prose.matchAll(/(?<![А-Яа-яЁё])([А-Яа-яЁё]{3,})(?![а-яё])/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((word) => singles.has(word));
  if (orders.length) {
    failures.push(`course.html: singular imperatives in prose: ${[...new Set(orders)].slice(0, 5).join(', ')}`);
  }
  // Команды вида «размечай», «учитывай», «упакуй» парного правила не имеют:
  // множественной формы этих глаголов в книге не было ни разу, поэтому они
  // пережили две вычитки подряд. Окончание -ай/-яй/-уй/-юй само по себе почти
  // всегда глагол — существительных с ним считанные штуки, и они перечислены.
  const NOUNS = new Set(['случай', 'край', 'обычай', 'урожай', 'сарай', 'лишай', 'рай', 'бой', 'слой', 'строй', 'настрой']);
  const informal = [...prose.matchAll(/(?<![А-Яа-яЁё])([А-ЯЁа-яё]{4,}(?:ай|яй|уй|юй))(?![а-яё])/g)]
    .map((match) => match[1].toLowerCase())
    .filter((word) => !NOUNS.has(word));
  if (informal.length) {
    failures.push(`course.html: informal imperatives in prose: ${[...new Set(informal)].slice(0, 5).join(', ')}`);
  }
}
// База справочника отставала от текста: в ней были pstore и Machine Check, но
// не было VM (146 употреблений), GiB, CPU, RTO — то есть как раз тех слов,
// которые читатель встречает первыми и выделяет чаще всего. Правило требует,
// чтобы часто встречающееся латинское слово имело определение. Русские термины
// оно не ловит намеренно: у сокращения форма одна, а русское слово пришлось бы
// разбирать по словоформам — это остаётся на совести вычитки.
// Пустая база — отдельная поломка, о ней уже сказано выше; повторять её здесь
// списком из всех слов книги бессмысленно.
// Границы кода панели в site.js: если их не найти, правило ниже проверит не то,
// что видит читатель, и об этом надо сказать вслух, а не пройти молча.
const defineFrom = siteJs.indexOf('const defNorm=');
const defineTo = siteJs.indexOf('const defSuggest=');
if (defineFrom < 0 || defineTo <= defineFrom) {
  failures.push('site.js: define panel lookup not found, term coverage unchecked');
}
if (terms.length && defineFrom >= 0 && defineTo > defineFrom) {
  // Ниже десяти употреблений начинается хвост разовой терминологии (iowait,
  // PMTU, MSS встречаются по девять раз): такое слово читатель видит в одном
  // абзаце, и требовать на него статью незачем.
  const OFTEN = 10;
  // U00–U36, T00–T36 и L00–L36 — номера модулей, самопроверок и работ, A1 —
  // имя вводного тренажёра. Ровно две цифры: без этого под правило попадал бы
  // L2 — уровень кэша, то есть настоящий термин, а не метка.
  const LABEL = /^([ult]\d\d|a1)$/;
  // Правило спрашивает ту же функцию, которой отвечает читателю панель, а не
  // разбирает термины само. Свой разбор уже разошёлся с панелью: он засчитывал
  // слово, если оно встречалось частью составного термина, — «TCP» считался
  // определённым через «TCP handshake», а панель на выделенное «TCP» отвечала
  // «Определения нет». Так прошли мимо Linux, systemd, Python и Docker.
  const defLookup = new Function('TERMS', `${siteJs.slice(defineFrom, defineTo)} return defLookup;`)(terms);
  // Составной термин вычёркиваем из текста до подсчёта: «boot» встречается
  // только внутри «Secure Boot» и «UEFI Boot Manager», «average» — только в
  // «Load average». Выделив словосочетание, читатель получает определение; а
  // без этого правило требовало бы статью на каждое слово из имени.
  const compound = terms
    .flatMap((entry) => [entry.term, ...(entry.aliases ?? [])])
    .filter((variant) => /[\s-]/.test(variant))
    .sort((left, right) => right.length - left.length);
  const masked = compound.reduce(
    (text, variant) => text.split(new RegExp(variant.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'), 'gi')).join(' '),
    bodyText,
  );
  const counted = new Map();
  for (const match of masked.matchAll(/(?<![A-Za-z0-9_/.-])[A-Za-z][A-Za-z0-9+]{1,13}(?![A-Za-z0-9_/+])/g)) {
    const word = match[0].toLowerCase();
    counted.set(word, (counted.get(word) ?? 0) + 1);
  }
  const orphans = [...counted]
    .filter(([word, times]) => times >= OFTEN && !defLookup(word) && !LABEL.test(word))
    .sort((left, right) => right[1] - left[1]);
  if (orphans.length) {
    const list = orphans.slice(0, 12).map(([word, times]) => `${word} (${times})`).join(', ');
    failures.push(`term base: no definition for ${list}`);
  }
}
// Слова, для которых в книге есть принятый русский перевод. Пока инструмент
// вычитки не видел последнюю шестую часть файла, она жила по своим правилам:
// «next hop» вместо «следующий узел», «riser» вместо «райзер», «enumeration»
// вместо «перечисление» — в тех же главах, где рядом стоял русский вариант.
// Имена объектов и параметров (Endpoints, capture_output) переводу не подлежат
// и вынесены в исключения.
{
  const keep = ['Endpoints', 'EndpointSlice', 'capture_output', 'Extensible Firmware Interface',
    'Boot:Driver:Firmware', 'upstream-документация', 'Readiness probe'];
  let prose = bodyText;
  for (const phrase of keep) prose = prose.split(phrase).join(' ');
  const settled = {
    'next hop': 'следующий узел', enumeration: 'перечисление', endpoint: 'оконечное устройство',
    riser: 'райзер', expander: 'экспандер', capture: 'перехват', production: 'рабочая система',
    benchmark: 'замер', durability: 'долговечность', toolchain: 'набор инструментов сборки',
    canary: 'канареечная партия', 'control plane': 'плоскость управления',
    userspace: 'пользовательское пространство', firmware: 'прошивка',
    'longest-prefix': 'самое длинное совпадение префикса', upstream: 'вышестоящий канал',
    backend: 'нижележащее хранилище', readiness: 'готовность', failover: 'переключение на резерв',
    detection: 'обнаружение', validation: 'проверка', regression: 'регрессия', rollout: 'развёртывание',
  };
  for (const [english, russian] of Object.entries(settled)) {
    const found = prose.match(new RegExp(`(?<![A-Za-z._/-])${english}(?![A-Za-z._/-])`, 'gi'));
    if (found) failures.push(`course.html: «${english}» left in prose ${found.length} times, the book says «${russian}»`);
  }
  // Банк заданий читают теми же глазами, что и главы, но правится он отдельным
  // инструментом — и отставал от книги: «Regression связывают … Stop condition:
  // остановить rollout» в одном разборе с русским текстом вокруг.
  if (data?.items && data?.cases) {
    const strings = [
      ...data.items.flatMap((item) => [item.stem, item.explanation, ...(item.options ?? []), ...(item.reason?.options ?? [])]),
      ...data.cases.flatMap((scenario) => [scenario.title, scenario.initial, scenario.evidence,
        ...scenario.stages.flatMap((stage) => [stage.label, ...stage.options])]),
    ];
    let bank = strings.filter(Boolean).join(' \n ');
    // Вывод команды, имя тома UEFI и имена стендов — не перевод, а данные.
    for (const phrase of ['lspci: endpoint', 'firmware volume', 'dev, staging, production',
      'staging квалифицировал digest A, production получил B']) bank = bank.split(phrase).join(' ');
    for (const [english, russian] of Object.entries(settled)) {
      const found = bank.match(new RegExp(`(?<![A-Za-z._/-])${english}(?![A-Za-z._/-])`, 'gi'));
      if (found) failures.push(`study-data: «${english}» left in ${found.length} strings, the book says «${russian}»`);
    }
  }
}
// Недельный план — единственное место, где курс разложен по времени. Он уже
// разошёлся с книгой один раз: таблица осталась на 28 позициях старой
// нумерации, когда модулей стало 37, и девять модулей просто выпали из плана.
// Ни сборка, ни ссылки этого не замечают — таблица остаётся рабочей.
{
  const planStart = body.indexOf('id="program"');
  const planEnd = body.indexOf('</table>', planStart);
  const plan = planStart < 0 || planEnd < 0 ? '' : body.slice(planStart, planEnd);
  const listed = [...plan.matchAll(/href="#ch(\d\d)"/g)].map((match) => match[1]);
  for (let number = 0; number <= 36; number += 1) {
    const times = listed.filter((value) => value === String(number).padStart(2, '0')).length;
    if (times !== 1) failures.push(`course.html: the weekly plan lists module U${String(number).padStart(2, '0')} ${times} times, expected once`);
  }
}
// Остатки markdown: список, написанный дефисами или цифрами внутри абзаца,
// браузер схлопывает в одну строку — читатель видит «причины: - права; - порт;»
// вместо перечня. В самой разметке это незаметно, поэтому проверяем отдельно.
const collapsedLists = [...body.replace(/<pre[\s\S]*?<\/pre>/g, ' ').matchAll(/<p>((?:(?!<\/?p[ >])[\s\S])*?)<\/p>/g)]
  .filter((match) => /(?:^|\n)\s*(?:-|\d+\.)\s+\S/.test(match[1]));
if (collapsedLists.length) {
  failures.push(`course.html: ${collapsedLists.length} paragraphs hold a markdown list that collapses into one line`);
}

const ids = [...course.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) failures.push(`course.html: duplicate ids ${duplicateIds.slice(0, 5).join(', ')}`);

const outline = [...body.matchAll(/<h([12])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)]
  .map((match) => ({ level: match[1], id: match[2], text: plain(match[3]) }));
const tocStart = course.indexOf('<ul id="toc">');
const tocHtml = course.slice(tocStart, course.indexOf('</ul>', tocStart));
const toc = [...tocHtml.matchAll(/<li class="level-(\d)"><a href="#([^"]+)">([\s\S]*?)<\/a><\/li>/g)]
  .map((match) => ({ level: match[1], id: match[2], text: plain(match[3]) }));
if (toc.length !== outline.length) failures.push(`course.html: table of contents has ${toc.length} items for ${outline.length} headings`);
else {
  for (const [index, entry] of toc.entries()) {
    const heading = outline[index];
    if (entry.id !== heading.id) { failures.push(`course.html: toc item ${index} points at ${entry.id}, heading is ${heading.id}`); break; }
    if (entry.level !== heading.level) failures.push(`course.html: toc level mismatch at ${entry.id}`);
    if (entry.text !== heading.text) failures.push(`course.html: toc text differs from heading ${entry.id}`);
  }
}

let currentChapter = null;
let expectedSection = 1;
for (const heading of outline) {
  if (heading.level === '1') {
    currentChapter = /^b(\d\d)$/.test(heading.id) ? Number(heading.id.slice(1)) : null;
    expectedSection = 1;
    continue;
  }
  const numbered = heading.text.match(/^(\d+)\.(\d+)([A-Z]?)\./);
  if (!numbered || currentChapter === null) continue;
  if (Number(numbered[1]) !== currentChapter) failures.push(`course.html: ${heading.id} numbered ${numbered[1]}.x inside chapter ${currentChapter}`);
  else if (!numbered[3]) {
    if (Number(numbered[2]) !== expectedSection) failures.push(`course.html: ${heading.id} is ${numbered[1]}.${numbered[2]} after ${numbered[1]}.${expectedSection - 1}`);
    expectedSection = Number(numbered[2]) + 1;
  }
}

// Разобранные примеры нумеруются номером своего U-модуля: в U18 это E18.x.
// Вставка нового модуля сдвигает шкалу, и метки в соседних модулях легко
// отстают — тогда один и тот же код E оказывается сразу в двух местах.
const moduleSpans = [...body.matchAll(/<h2 id="ch(\d\d)">/g)]
  .map((match, index, list) => ({
    module: Number(match[1]),
    start: match.index,
    end: index + 1 < list.length ? list[index + 1].index : body.length,
  }));
for (const span of moduleSpans) {
  for (const label of body.slice(span.start, span.end).matchAll(/\bE(\d+)\.\d+/g)) {
    if (Number(label[1]) !== span.module) {
      failures.push(`course.html: ${label[0]} inside module U${String(span.module).padStart(2, '0')}`);
      break;
    }
  }
}

const prose = body
  .replace(/<(pre|code|kbd|samp|script|style)\b[\s\S]*?<\/\1>/g, ' ')
  .replace(/<[^>]+>/g, ' ');
const proseRules = [
  ['straight quotation marks', /["“”]/],
  ['three dots instead of an ellipsis', /\.\.\./],
  ['hyphen used as a dash', /[а-яА-Я0-9)]\s-\s/],
  ['"алерт" instead of "оповещение"', /алерт/i],
  ['"латентность" instead of "задержка"', /латентност/i],
  ['"оверхед" instead of "накладные расходы"', /оверхед/i],
];
for (const [name, pattern] of proseRules) {
  const hit = prose.match(pattern);
  if (hit) failures.push(`course.html: ${name} — ...${prose.slice(Math.max(0, hit.index - 40), hit.index + 40).trim()}...`);
}

// Страница маршрута: чек-лист собран по всем главам, а отметки выводятся из
// прогресса — интерфейса, который проставляет дату вручную, быть не должно.
const routePage = cache.get(resolve(root, 'route', 'index.html'));
if (!routePage) failures.push('route: page is missing');
else {
  const rows = routePage.match(/data-route-row="\d+"/g)?.length ?? 0;
  if (rows !== 34) failures.push(`route: checklist has ${rows} rows for 34 chapters`);
  for (const marker of ['data-route-calendar', 'data-backup-save', 'data-backup-load']) {
    if (!routePage.includes(marker)) failures.push(`route: missing ${marker}`);
  }
  if (/<input(?![^>]*type="file")[^>]*data-route/.test(routePage)) failures.push('route: checklist must not accept manual input');
}
for (const [file, html] of cache) {
  if (!html.includes('href="/route/"') && !html.includes(`href="${BASE}/route/"`)) failures.push(`${file}: missing route link in navigation`);
}
// Сборка не разбирает клиентский код, поэтому синтаксическая ошибка в кабинете
// доходит до страницы незамеченной: сломанный скрипт просто не выполняется.
const cabinet = assessment?.match(/<script>\n\(\(\)=>\{[\s\S]*?<\/script>/)?.[0];
if (!cabinet) failures.push('assessment: cabinet script not found');
else {
  try { new Function(cabinet.slice('<script>'.length, -'</script>'.length)); }
  catch (error) { failures.push(`assessment: cabinet script does not parse — ${error.message}`); }
}

// Второй ярус: у каждого задания на механизм спрашивают рассуждение, и его
// формулировки не должны повторять слова верного варианта первого яруса —
// иначе выбор рассуждения подсказывает ответ.
if (data?.items) {
  const stop = new Set(['этот','этом','этого','который','которая','которые','поэтому','значит','может','можно','нужно','только','всегда','после','через','между','потому','самое','нельзя','должен','должна','должно','также','более','менее','если','когда','чтобы']);
  const words = (text) => new Set(String(text).toLowerCase().replace(/[^a-zа-яё0-9\s-]/gi, ' ').split(/\s+/).filter((word) => word.length >= 6 && !stop.has(word)));
  for (const item of data.items.filter((entry) => entry.kind === 'concept')) {
    const tier = item.reason;
    if (!tier || !Array.isArray(tier.options) || tier.options.length !== 3 || !Number.isInteger(tier.answer) || tier.answer < 0 || tier.answer > 2) {
      failures.push(`item ${item.id}: concept item without a three-option reason tier`);
      continue;
    }
    const right = words(item.options[item.answer]);
    const overlap = tier.options.map((text) => [...words(text)].filter((word) => right.has(word)).length);
    const others = overlap.filter((_, index) => index !== tier.answer);
    if (others.every((value) => overlap[tier.answer] > value + 2)) {
      failures.push(`item ${item.id}: reason tier leaks the correct answer through shared wording`);
    }
  }
}

// Позиция верного варианта. Банк собирался по заданию за раз, и верный ответ
// каждый раз записывался первым: в какой-то момент все 74 задания, все 74
// вторых яруса и все 148 шагов сценариев проходились выбором первого варианта,
// то есть кабинет мерил не понимание, а привычку. В разметке это не видно
// никак — только в распределении, поэтому оно и закреплено здесь.
if (data?.items && data?.cases) {
  const families = [
    ['items', data.items.filter((item) => Array.isArray(item.options)).map((item) => [item.answer, item.options.length])],
    ['reason tiers', data.items.filter((item) => item.reason).map((item) => [item.reason.answer, item.reason.options.length])],
    ['scenario stages', data.cases.flatMap((scenario) => scenario.stages.map((stage) => [stage.answer, stage.options.length]))],
  ];
  for (const [name, answers] of families) {
    const width = Math.max(...answers.map(([, length]) => length));
    for (let position = 0; position < width; position += 1) {
      const share = answers.filter(([answer]) => answer === position).length / answers.length;
      if (share > 0.5) {
        failures.push(`${name}: choosing option ${position + 1} every time passes ${Math.round(share * 100)}% of them`);
      }
      if (share === 0) failures.push(`${name}: option ${position + 1} is never the correct one`);
    }
  }
}

// Длина варианта как подсказка. Позицию верного ответа проверка выше уже
// перемешивает, но оставался второй признак того же рода: развёрнутое
// рассуждение писалось только в верный вариант, а неверные оставались
// короткими отмашками. По измерению до правки выбор самого длинного варианта
// проходил 89% заданий банка, 99% вторых ярусов, 95% шагов сценариев и 100%
// вопросов о механизме работ — кабинет мерил счёт символов, а не понимание.
// В разметке это не видно: вопросы там настоящие, длина просто коррелирует.
//
// Порог — редакционный, а не научный: при четырёх вариантах случайный выбор
// даёт 25%, и планка в 45% оставляет запас на темы, где верный ответ
// действительно требует оговорки, но закрывает систематическую привычку.
{
  const banks = [];
  const push = (name, rows) => rows.length && banks.push([name, rows]);
  if (data?.items) {
    push('банк: ответ', data.items.filter((item) => Array.isArray(item.options)).map((item) => [item.id, item.options, item.answer]));
    push('банк: объяснение', data.items.filter((item) => item.reason).map((item) => [item.id, item.reason.options, item.reason.answer]));
  }
  if (data?.cases) {
    push('сценарии', data.cases.flatMap((scenario) => scenario.stages
      .filter((stage) => Array.isArray(stage.options))
      .map((stage, order) => [`${scenario.id}:${order}`, stage.options, stage.answer])));
  }
  const labData = assessment && JSON.parse(assessment.match(/id="lab-data">([\s\S]*?)<\/script>/)?.[1] ?? '{"labs":[]}');
  push('работы: механизм', (labData?.labs ?? []).filter((lab) => lab.why).map((lab) => [lab.id, lab.why.options, lab.why.answer]));
  for (const [id, source] of [['тренажёр глав', 'chapter-quick-data'], ['тренажёр уроков', 'lesson-quick-data']]) {
    const raw = course.match(new RegExp(`id="${source}">([\\s\\S]*?)</script>`))?.[1];
    if (raw) push(id, Object.entries(JSON.parse(raw)).flatMap(([key, slots]) => slots.flatMap((pool, order) => pool.map((quiz, variant) => [`${key}.${order}/${variant}`, quiz.options, quiz.answer]))));
  }

  // Подсказкой длина становится не при любой разнице, а при заметной: два
  // лишних знака читатель не использует. Отрывом считаем 12 знаков или 15%
  // — что больше. Без этого порога измерение балансирует на острие и любая
  // правка перекидывает его в зеркальный перекос «верный самый короткий».
  const notable = (right, others, longer) => {
    const bound = longer ? Math.max(...others) : Math.min(...others);
    const margin = Math.max(12, Math.round(bound * 0.15));
    return longer ? right >= bound + margin : right + margin <= bound;
  };
  const report = [];
  for (const [name, rows] of banks) {
    let long = 0, short = 0;
    const suspects = [];
    for (const [id, options, answer] of rows) {
      const right = options[answer].length;
      const others = options.filter((_, index) => index !== answer).map((option) => option.length);
      if (notable(right, others, true)) { long += 1; suspects.push(id); }
      if (notable(right, others, false)) short += 1;
    }
    const share = (count) => Math.round((count / rows.length) * 100);
    report.push(`  ${name}: ${rows.length} вопросов, заметно длиннее ${long} (${share(long)}%), заметно короче ${short} (${share(short)}%)`);
    for (const [kind, count, ids] of [['длинного', long, suspects], ['короткого', short, []]]) {
      if (count / rows.length > 0.25) {
        failures.push(`${name}: выбор заметно более ${kind} варианта проходит ${share(count)}% вопросов (${count} из ${rows.length})`
          + (ids.length ? `; первые: ${ids.slice(0, 5).join(', ')}` : ''));
      }
    }
  }
  if (process.env.ANSWER_LENGTH_REPORT) console.log('Подсказка по длине варианта:\n' + report.join('\n'));
}

// Кабинет считает модули по одной константе. Пока их было несколько, копии
// расходились при каждом расширении курса: вариант собирался на 37 вопросов,
// записывался как 31 и отбрасывался проверкой на 28 — попытка исчезала при
// перезагрузке, а «маршрут пройден» срабатывал на 31 модуле из 37.
if (assessment) {
  if (!assessment.includes(`const MODULES=${MODULE_COUNT},`)) {
    failures.push(`assessment: cabinet must declare MODULES=${MODULE_COUNT}`);
  }
  // Попытка хранит собственный знаменатель, поэтому запись и её проверка не
  // могут разойтись; число модулей в расчётах берётся только из константы.
  if (!assessment.includes('total:MODULES')) failures.push('assessment: exam attempt must record total:MODULES');
  if (!assessment.includes('h.correct<=h.total')) failures.push('assessment: attempt history must validate against its own total');
  const literals = assessment.match(/(?:length|size|total|max)\s*[:=]+\s*(\d+)|correctCount>=(\d+)|done===(\d+)/g) ?? [];
  const stale = literals.filter((hit) => /\b(2[4-9]|3[0-6])\b/.test(hit) && !hit.includes('length:7'));
  if (stale.length) failures.push(`assessment: hand-written module counts left in the cabinet: ${[...new Set(stale)].join(', ')}`);
}
// Резервная копия обязана увозить всё локальное состояние: ключ, забытый здесь,
// теряется молча — при переносе в другой браузер исчезает только часть работы.
const backupKeys = siteJs.match(/BACKUP_KEYS=\[([^\]]*)\]/)?.[1] ?? '';
// Ключи берутся из самого кода, а не из списка рядом. Список был: он знал семь
// ключей из девяти и ничего не сказал бы про десятый — а ключ, не попавший в
// перенос, теряется молча: читатель переносит прогресс в другой браузер, файл
// выглядит полноценным, и часть работы остаётся в старом. Смотрим там, где
// ключи и заводятся: общий клиентский код и две страницы со своим — кабинет и
// «Маршрут».
{
  const sources = [siteJs,
    cache.get(resolve(root, 'assessment', 'index.html')) ?? '',
    cache.get(resolve(root, 'route', 'index.html')) ?? ''];
  const used = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/['"`](server-infrastructure-[a-z0-9-]+)['"`]/g)) used.add(match[1]);
  }
  if (used.size < 9) failures.push(`site.js: expected at least nine storage keys, found ${used.size}`);
  for (const key of used) {
    if (!backupKeys.includes(key)) failures.push(`site.js: backup does not cover ${key}`);
  }
}
// Вёрстка для телефона: правила, без которых страница перестаёт помещаться в
// экран. Браузер тогда расширяет область просмотра под самый широкий элемент и
// уменьшает масштаб — текст мельчает на всех страницах сразу, а заметить это по
// сборке нельзя. Проверять раскладку целиком здесь нечем, поэтому закрепляем
// сами правила: их удаление и было причиной каждого из найденных случаев.
const mobileRules = [
  ['.hidden-input{display:none}', 'системное поле выбора файла скрыто на всех страницах, а не только в кабинете'],
  ['.prose table{display:block;overflow-x:auto', 'широкая таблица прокручивается внутри себя'],
  ['.route-table td[data-route-cell=labs]::before', 'чек-лист маршрута разворачивается в карточки'],
  ['.search-toggle,.theme-toggle,.notes-toggle{min-width:44px;min-height:44px', 'кнопки панели — цели для пальца'],
  ['.hero-stats{grid-template-columns:1fr}', 'числа на титуле в одну колонку на узком экране'],
  ['.section-head,.progress-card,.chapter-trainer>header,.chapter-trainer>footer,.route-head{flex-direction:column',
    'пары «заголовок слева — ссылка справа» идут в столбец на телефоне'],
  ['.file-label{display:inline-flex', 'метка выбора файла не строчная — иначе её отступы налезают на соседние строки'],
  ['.study-app .controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))',
    'колонки разделов кабинета сжимаются: у простого 1fr нижняя граница — самое длинное слово, и на 280–320px строка не помещалась'],
  ['.study-app .status-box{display:grid', 'блок состояния кабинета оформлен отдельно от вводного абзаца'],
];
for (const [rule, why] of mobileRules) {
  if (!siteCss.includes(rule)) failures.push(`site.css: mobile rule lost — ${why} (${rule})`);
}
// Ширина страницы на большом экране. Три правила держат раскладку вместе;
// каждое из них уже однажды разъезжалось.
const layoutRules = [
  ['.page-layout{max-width:var(--page)', 'ширина страницы задана переменной'],
  ['padding:0 max(24px,calc((100vw - var(--page))/2))', 'верхняя панель считает поля по той же переменной, иначе логотип уезжает от текста'],
  ['.prose{width:min(100%,900px,var(--reading-measure))}',
    'мера строки — верхняя граница, а не размер: через max-width текст не замечал, что колонка уже, и уезжал под рейл разделов'],
];
for (const [rule, why] of layoutRules) {
  if (!siteCss.includes(rule)) failures.push(`site.css: layout rule lost — ${why} (${rule})`);
}
// Рейл разделов встаёт сбоку только когда рядом помещается полная строка:
// 300 боковая + 152 поля + 250 рейл + 48 зазор + ~750 текста.
const railBreakpoint = siteCss.match(/@media\s*\(min-width:\s*(\d+)px\)[^@]*\.page-main:has\(\.section-rail\)\{display:grid/);
if (!railBreakpoint) failures.push('site.css: side rail grid rule not found');
else if (Number(railBreakpoint[1]) < 1500) {
  failures.push(`site.css: side rail appears at ${railBreakpoint[1]}px — too early, it eats the reading width`);
}
// Слово «Разделы» остаётся в разметке: значок ☰ не даёт кнопке названия.
for (const [file, html] of cache) {
  if (!html.includes('<summary><span class="menu-label">Разделы</span></summary>')) {
    failures.push(`${file}: mobile menu button lost its accessible name`);
    break;
  }
}
// Строение страницы: заголовок каждого уровня стоит на своём месте. Проверки
// закрывают три случая, которые уже случались и на сборке никак не сказывались.
const railText = (html) => {
  const open = html.indexOf('data-section-rail');
  return open < 0 ? '' : html.slice(open, html.indexOf('</nav>', open));
};
for (const [file, html] of cache) {
  const opening = html.match(/<article class="[^"]*\bprose\b[^"]*">/);
  if (!opening) continue;
  const article = html.slice(opening.index + opening[0].length, html.indexOf('</article>', opening.index));
  const main = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
  const outline = main.replace(/<aside[\s\S]*?<\/aside>/g, '').replace(/<nav[\s\S]*?<\/nav>/g, '');
  // 1. Страница не кончается заголовком: так «Часть 0» висела в конце «О курсе»
  //    без единой строки под собой.
  const blocks = [...article.matchAll(/<(h[1-4]|p|ul|ol|table|pre|blockquote|details|div)[\s>]/g)].map((match) => match[1]);
  if (/^h[1-4]$/.test(blocks.at(-1) ?? '')) failures.push(`${file}: page ends with a heading and no text under it`);
  // 2. Уровни не перепрыгивают ступень: h1 → h3 ломает оглавление для чтения
  //    с экрана и оставляет раздел вне навигации по странице.
  let previous = 0;
  for (const match of outline.matchAll(/<h([1-4])[^>]*>/g)) {
    const level = Number(match[1]);
    if (previous && level > previous + 1) { failures.push(`${file}: heading level jumps h${previous} → h${level}`); break; }
    previous = level;
  }
  // 3. Навигация по разделам повторяет заголовки h2 страницы — и по составу,
  //    и по порядку: расхождение означает ссылку в никуда или потерянный раздел.
  const rail = railText(html);
  if (rail) {
    const listed = [...rail.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]).join('|');
    const present = [...main.matchAll(/<h2 id="([^"]+)"/g)].map((match) => match[1]).join('|');
    if (listed !== present) failures.push(`${file}: section rail does not match the page headings`);
  }
}
// Автоматические переносы в заголовках рвут обычные слова ради плотности
// строки, а не по нужде: «Как устро-ен учебник».
if (!/\.prose h3\{overflow-wrap:break-word;hyphens:manual\}/.test(siteCss)) {
  failures.push('site.css: headings must not hyphenate automatically');
}
// Ссылка «источник» у заметки строится из пути, а путь приезжает вместе с
// файлом резервной копии — то есть может быть чужим. Без проверки туда
// подставляется «javascript:…», и один щелчок по заметке выполняет чужой код
// на домене учебника со всем прогрессом в его localStorage. Экранирование от
// этого не спасает: браузер раскодирует сущности в href обратно.
if (!/const safePath=value=>/.test(siteJs) || !siteJs.includes('const href=safePath(item.path)')) {
  failures.push('site.js: note links must go through the internal-path guard');
}
// Шкала времени только дополняется: код не должен уметь переписать дату.
if (!siteJs.includes('stampTimeline') || !siteJs.includes("if(line.events[key])return")) {
  failures.push('site.js: timeline must be append-only');
}
// --- политика безопасности страниц ---
// GitHub Pages не отдаёт заголовков, поэтому политика едет в <meta>, а её
// script-src перечисляет хеши встроенных скриптов. Разойтись политика с
// содержимым может незаметно: разметка остаётся правильной, сборка проходит,
// и только браузер молча отказывается выполнять скрипт. Здесь проверяется то
// же, что проверил бы браузер.
const scriptBlocks = /<script([^>]*)>([\s\S]*?)<\/script>/g;
// <script type="application/json"> с банком заданий браузер не выполняет —
// хеш ему не нужен.
const executableScript = (attributes) => {
  if (/\ssrc=/.test(attributes)) return false;
  const type = /type\s*=\s*"([^"]*)"/.exec(attributes)?.[1].trim().toLowerCase();
  return !type || type === 'module' || /^(text|application)\/(java|ecma)script$/.test(type);
};
for (const [file, html] of cache) {
  const route = relative(root, file);
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1];
  if (!policy) {
    failures.push(`${route}: no Content-Security-Policy meta`);
    continue;
  }
  for (const directive of ["default-src 'none'", "style-src 'self'", "connect-src 'self'", "base-uri 'none'"]) {
    if (!policy.includes(directive)) failures.push(`${route}: policy lacks ${directive}`);
  }
  if (/unsafe-inline|unsafe-eval/.test(policy)) failures.push(`${route}: policy weakened by unsafe-*`);
  for (const [, attributes, script] of html.matchAll(scriptBlocks)) {
    if (!executableScript(attributes)) continue;
    const hash = createHash('sha256').update(script).digest('base64');
    if (!policy.includes(`'sha256-${hash}'`)) {
      failures.push(`${route}: inline script not covered by the policy (sha256-${hash})`);
    }
  }
  // style-src без 'unsafe-inline' не даёт работать ни атрибуту style, ни
  // обработчику onclick в разметке. В разметке это незаметно: выравнивание
  // столбца просто молча пропадает.
  const styleAttribute = / style="/.exec(html);
  if (styleAttribute) failures.push(`${route}: inline style attribute is blocked by the policy`);
  const handler = / on(?:click|input|change|load|submit|focus|blur)="/.exec(html);
  if (handler) failures.push(`${route}: inline event handler is blocked by the policy`);
  // Скрипт, который ищет элемент с соседней страницы, падает на первой же
  // строке и уносит с собой всё, что идёт ниже. Так на странице тренажёра A1
  // не работали все 40 вопросов: скрипт начинался с оглавления, которого на
  // ней нет.
  for (const [, attributes, script] of html.matchAll(scriptBlocks)) {
    if (!executableScript(attributes)) continue;
    const lookups = /(?:const\s+(\w+)\s*=\s*)?document\.getElementById\('([^']+)'\)(\??)/g;
    for (const [, name, id, guard] of script.matchAll(lookups)) {
      if (html.includes(`id="${id}"`) || guard === '?') continue;
      // Найденное можно положить в переменную и защитить ниже. Смотрим на
      // первое обращение к ней: если оно идёт через ?., падать нечему, а
      // обращения дальше живут внутри обработчика, который не подпишется.
      const firstUse = name && new RegExp(`\\b${name}\\s*(\\??)\\.`).exec(script);
      if (name && (!firstUse || firstUse[1] === '?')) continue;
      failures.push(`${route}: inline script reaches for #${id}, which is not on this page`);
    }
  }
}

// --- автоматическая проверка работ практикума ---
// Задание готовит скрипт, читатель решает, отчёт загружается в кабинет. Здесь
// закреплено то, что разъезжается молча: страница кабинета собирается из
// перечисленных блоков, а не из сплошного среза, поэтому забытый блок данных
// просто не доедет — и вкладка окажется пустой без единой ошибки в разметке.
{
  const labMatch = assessment?.match(/<script type="application\/json" id="lab-data">(.*?)<\/script>/s);
  const labScript = assessment?.match(/<script type="application\/json" id="lab-code-data">(.*?)<\/script>/s);
  if (!labMatch || !labScript) {
    failures.push('assessment: lab-data or lab-code-data missing from the cabinet page');
  } else {
    const labs = JSON.parse(labMatch[1]).labs;
    const code = JSON.parse(labScript[1]);
    // Инжектор меняет чужую машину — единственное место в проекте, где это так.
    // Отказ без метки стенда, откат и «показать, но не делать» — не удобства,
    // а условие, при котором такую правку вообще можно отдавать читателю.
    for (const guard of ['/etc/course-lab-stand', 'def cmd_restore', 'dry_run', 'управляющей сети']) {
      if (!code.includes(guard)) failures.push(`course_lab.py: safety guard missing (${guard})`);
    }
    // Метка одна на всех и лежит по известному пути: она отличает стенд только
    // от машины, где её забыли завести. Номер стенда кладёт в гостей сборщик, а
    // в скачиваемый скрипт подставляет кабинет — и работа, выпущенная для
    // одного стенда, на другой машине не запускается. Объявление без сверки
    // выглядит в файле точно так же, как работающая привязка, поэтому спрашиваем
    // и то и другое.
    for (const [needle, what] of [
      ["STAND_ID = ''", 'the stand number has no placeholder for the cabinet to fill in'],
      ['if here != STAND_ID:', 'the stand number is declared but never compared with the marker'],
    ]) if (!code.includes(needle)) failures.push(`course_lab.py: ${what}`);
    // Кабинет обязан подставлять номер при скачивании и проверять его форму:
    // номер попадает внутрь строки Python, и доверять загруженному файлу нельзя.
    for (const [needle, what] of [
      ['stampLab(JSON.parse(', 'the downloaded course_lab.py is not stamped with the stand number'],
      ['function standValid(v){return /^[0-9a-f]{16}$/.test(v)}', 'the stand number is substituted without checking its shape'],
    ]) if (!assessment.includes(needle)) failures.push(`assessment: ${what}`);
    // Сбор фактов и вердикт разделены: иначе ожидаемые значения уезжают к
    // читателю вместе со скриптом.
    if (/вердикт|засчитано|правильный ответ/i.test(code.replace(/вердикт выносит учебник|Отчёт не содержит вердикта/g, ''))) {
      failures.push('course_lab.py: collector must not decide the verdict');
    }
    // Операции сверки описаны в кабинете; работа не может сослаться на ту,
    // которой нет, — иначе проверка молча не сработает ни разу.
    const ops = new Set([...(assessment.match(/const LAB_OPS=\{([\s\S]*?)\n\};/)?.[1] ?? '')
      .matchAll(/^\s(\w+):/gm)].map((match) => match[1]));
    if (ops.size < 5) failures.push('assessment: check operations not found in the cabinet');
    const answerIndexes = new Set();
    for (const lab of labs) {
      const where = `lab-data ${lab.id}`;
      if (!/^L\d\d[AB]$/.test(lab.id)) failures.push(`${where}: id is not a lab part`);
      if (!Number.isInteger(lab.module) || lab.module < 0 || lab.module > 36) failures.push(`${where}: module out of range`);
      if (!['stand', 'collect', 'dataset'].includes(lab.kind)) failures.push(`${where}: unknown kind ${lab.kind}`);
      if (!lab.why || lab.why.options?.length !== 4 || !Number.isInteger(lab.why.answer)
        || lab.why.answer < 0 || lab.why.answer > 3 || !lab.why.explanation) {
        failures.push(`${where}: mechanism question must offer four options, an answer and an explanation`);
      } else answerIndexes.add(lab.why.answer);
      if (!lab.checks?.length) failures.push(`${where}: no checks`);
      for (const check of lab.checks ?? []) {
        if (!ops.has(check.op)) failures.push(`${where}: unknown check operation ${check.op}`);
        if (!check.label) failures.push(`${where}: check without a label`);
        // Сверка по хешу требует самого хеша: у работы с вариантами он в
        // variants, у остальных — в expect.
        if (check.op === 'hash') {
          const stored = lab.kind === 'stand'
            ? (lab.variants ?? []).map((variant) => variant[check.field])
            : [lab.expect?.[check.field]];
          if (!stored.length || stored.some((value) => value === undefined)) {
            failures.push(`${where}: no expected value for ${check.field}`);
          }
        }
      }
      // Ожидаемое лежит хешами: в разметку не попадает ни одно значение, по
      // которому ответ читается без решения.
      const secrets = lab.kind === 'stand'
        ? (lab.variants ?? []).flatMap((variant) => Object.values(variant))
        : Object.values(lab.expect ?? {});
      for (const value of secrets) {
        if (typeof value !== 'string' || !/^[0-9a-z]{4,9}$/.test(value) || /^\d+$/.test(value)) {
          failures.push(`${where}: expected value is not hashed (${value})`);
        }
      }
      // Текст работы и её проверка стоят на одной странице и в одном виде
      // модуля: раньше это были две страницы, между которыми читатель ходил сам.
      if (!assessment.includes(`<section data-lab-module="${lab.module}">`)) {
        failures.push(`${where}: the lab text is not on the practice page`);
      }
      // Работа, которой нет в реестре скрипта, не подготовится и не соберётся.
      if (!code.includes(`'${lab.id}': {'kind'`)) failures.push(`${where}: not registered in course_lab.py`);
    }
    // Автопроверка обещана в каждом модуле: пропуск не виден ни в сборке, ни в
    // разметке — вид модуля просто не покажет карточку, и читатель решит, что
    // так и задумано.
    const covered = new Set(labs.map((lab) => lab.module));
    const uncovered = [...Array(37).keys()].filter((module) => !covered.has(module));
    if (uncovered.length) failures.push(`lab-data: modules without an automatic check: ${uncovered.join(', ')}`);
    // Число работ с автопроверкой названо в книге прозой. Оно расходится с
    // данными после каждой добавленной работы, а проверить его глазами нельзя:
    // работы лежат в JSON, а счёт — в тексте главы о проверке.
    const aboutPage = cache.get(resolve(root, 'about', 'index.html')) ?? '';
    const stated = aboutPage.match(/Автоматическая проверка есть у всех (\d+)/);
    if (!stated) failures.push('about: the count of works with an automatic check is gone from the prose');
    else if (Number(stated[1]) !== labs.length) {
      failures.push(`about: prose says ${stated[1]} works have an automatic check, lab-data has ${labs.length}`);
    }
    // Тот же урок, что и с банком заданий: верный вариант, поставленный по
    // привычке первым, делает вопрос проходимым без чтения.
    if (labs.length > 1 && answerIndexes.size === 1) {
      failures.push('lab-data: every mechanism answer sits at the same position');
    }
    // Две шкалы. Работа на выданном наборе данных подтверждает разбор, а не
    // работу руками, и практическим навыком не становится ни при каком числе
    // верных фактов. Метка стоит в данных отдельным полем, а не выводится из
    // вида работы: сбор фактов тоже подтверждает лишь то, что перечислено в
    // его сверке, — так L16B проверял четыре факта из десяти обещанных.
    const bench = labs.filter((lab) => lab.bench === true);
    for (const lab of labs) {
      if (lab.kind === 'dataset' && lab.bench) failures.push(`lab-data ${lab.id}: a dataset work cannot prove bench practice`);
      if (lab.bench && !lab.chain) failures.push(`lab-data ${lab.id}: bench work without a chain`);
      // Граница у каждой работы своя: «проверка пройдена» без неё читается
      // как подтверждение всего, что описано в тексте работы.
      if (lab.bench && !(lab.proof?.length > 40)) failures.push(`lab-data ${lab.id}: bench work does not say what its report proves`);
    }
    if (!bench.length) failures.push('lab-data: no work feeds the bench scale at all');
    // L04A спрашивает журнал, а не systemctl show. Найдено на живом стенде:
    // юнит типа oneshot после завершения выгружается из памяти systemd, и show
    // отвечает про него значениями по умолчанию — Result=success, нулевой
    // статус, пустые отметки времени. У созданного и ни разу не запущенного
    // юнита ровно то же самое, так что «юнит завершился успешно» засчитывало
    // работу, в которой юнит только написали. Журнал спрашивается по
    // MESSAGE_ID: текст сообщений systemd переводится на язык системы.
    const l04a = labs.find((lab) => lab.id === 'L04A');
    if (l04a) for (const fact of ['ran', 'succeeded']) {
      if (!l04a.checks.some((check) => check.fact === fact)) failures.push(`lab-data L04A: nothing checks whether the unit actually ${fact === 'ran' ? 'ran' : 'succeeded'}; systemctl show says success about a unit that never started`);
    }
    // L30B отличает цепочку от одиночного сертификата издателем. Найдено на
    // стенде: один самоподписанный сертификат, поданный и корнем, и цепочкой,
    // проходит openssl verify -CAfile, не проходит без него и несёт имя в SAN —
    // то есть выглядит в фактах ровно как настоящая цепочка, которой там нет.
    const l30b = labs.find((lab) => lab.id === 'L30B');
    if (l30b && !l30b.checks.some((check) => check.fact === 'server_self_signed')) {
      failures.push('lab-data L30B: nothing tells a chain from a single self-signed certificate that is its own root');
    }
    for (const [needle, what] of [
      ['UNIT_STARTING', 'the L04A probe reads the unit state from systemctl show, which reports defaults for an unloaded unit'],
      ["json.loads(line).get('MESSAGE_ID')", 'the journal is matched by message text, which is translated on the reader machine'],
      // Файл дрейфа chrony называется по-разному: в Debian 12 chrony.drift, в
      // других сборках drift. С зашитым именем факт оставался пустым даже на
      // работающем chrony, и работа не сдавалась никогда.
      ['def chrony_drift_file(', 'the L31A probe hard-codes the chrony drift file name, which differs between builds'],
      // Признак синхронизации — Leap status, а не то, что вывод разобрался на
      // поля: на узле без источника разбор проходит точно так же.
      ["fields[13].strip() == 'Normal'", 'L31A calls a host synchronised when chronyc merely answered'],
      ['def cert_field(', 'the L30B probe never looks at who issued the certificate'],
      // df показывает пригодное место, а не размер файловой системы: у ext4 на
      // томе в гигабайт разница 33 МиБ, и «ФС догнала том» не сходилось даже
      // после честного resize2fs — работа не сдавалась никогда.
      ['def fs_size_mib(', 'L13B measures the filesystem with df, which reports usable space, not its size'],
      // Целый массив выглядит одинаково и после восстановления, и до всякой
      // аварии. Деградацию видно только в журнале ядра, и создание массива
      // даёт там resync, а не recovery.
      ['recovery of RAID array', 'L14B cannot tell a recovered array from one that was never broken'],
      // Запись FAILED в таблице соседей — след прошлых попыток разрешения: она
      // остаётся и после того, как маршрут снова пошёл через шлюз.
      ["'FAILED' not in (entry.get('state') or [])", 'L06B counts a stale FAILED neighbour entry as an ARP attempt'],
    ]) if (!code.includes(needle)) failures.push(`lab-code-data: ${what}`);
    // Базовая линия — единственное, чем работа отличает сделанное от того, что
    // на стенде и так было. L13B без неё засчитывалась за нерасширенный том,
    // L14B — за нетронутый массив.
    for (const id of ['L13B', 'L14B', 'L16B']) {
      if (!code.includes(`def baseline_${id}(`)) failures.push(`lab-code-data: ${id} takes no baseline, so its facts describe the stand rather than the work`);
    }
    // Обе шкалы считаются в кабинете раздельно и обе показываются на общем
    // экране. Слитый счёт выглядит в разметке точно так же, как раздельный.
    for (const [needle, what] of [
      ['const BENCH_LABS=LABDB.labs.filter(x=>x.bench===true)', 'the bench scale is not limited to bench works'],
      ['function benchInfo(', 'the bench scale is not computed apart from modules'],
      ['Практика на стенде подтверждена', 'the common screen never states the bench result'],
      ['Теория и тренажёры', 'the common screen never names the theory scale'],
      // Расширенная сверка не засчитывается по отчёту прежнего контракта.
      ['criteria:labCriteria(LABS.get(data.lab))', 'an accepted report is not stamped with the criteria it passed'],
      ['stale:(Number(saved.criteria)||1)<labCriteria(lab)', 'reports taken under the old contract are not marked'],
    ]) if (assessment && !assessment.includes(needle)) failures.push(`assessment: ${what}`);
    // Оба числа названы в книге прозой и расходятся с данными молча: работы
    // лежат в JSON, а счёт — в тексте главы о проверке.
    const onData = aboutPage.match(/У (\d+) работ стенд не нужен вовсе/);
    const onStand = aboutPage.match(/Оставшиеся (\d+) снимают факты с настоящего стенда/);
    if (!onData || !onStand) failures.push('about: the prose no longer splits works into bench and dataset');
    else {
      if (Number(onData[1]) !== labs.length - bench.length) failures.push(`about: prose says ${onData[1]} works need no bench, lab-data has ${labs.length - bench.length}`);
      if (Number(onStand[1]) !== bench.length) failures.push(`about: prose says ${onStand[1]} works collect bench facts, lab-data has ${bench.length}`);
    }
  }
  // Результаты работ живут внутри ключа прогресса: отдельный ключ пришлось бы
  // вносить в BACKUP_KEYS, иначе перенос в другой браузер терял бы их молча.
  if (assessment && (!assessment.includes('errors:[],labs:{}') || !assessment.includes('clean.labs[id]='))) {
    failures.push('assessment: lab results are not carried by the progress import');
  }
}

// Вся книга одной страницей. Полнота здесь не видна ниоткуда: страница
// собирается срезами, и выпавшая глава выглядит как просто более короткий
// свиток. Проверяем состав, отсутствие интерактивных блоков (на бумаге они
// пусты, потому что их рисует скрипт) и то, что перекрёстная ссылка ведёт
// внутрь страницы, а не уводит с листа обратно на сайт.
{
  const book = cache.get(resolve(root, 'book', 'index.html')) ?? '';
  if (!book) failures.push('book: the whole-book page is missing');
  else {
    for (let number = 0; number <= 33; number += 1) {
      if (!book.includes(`id="b${String(number).padStart(2, '0')}"`)) failures.push(`book: chapter ${number} is not on the page`);
    }
    for (let lesson = 1; lesson <= 5; lesson += 1) {
      if (!book.includes(`id="start0${lesson}"`)) failures.push(`book: lesson ${lesson} is not on the page`);
    }
    if (!book.includes('id="b33-s044"')) failures.push('book: the appendices are not on the page');
    for (const live of ['data-chapter-trainer', 'data-chapter-recall', 'class="chapter-practice"']) {
      if (book.includes(live)) failures.push(`book: ${live} belongs to the site, not to print`);
    }
    const ids = new Set([...book.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const strayAnchors = [...book.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]).filter((id) => !ids.has(id));
    if (strayAnchors.length) failures.push(`book: ${strayAnchors.length} local links point nowhere, first #${strayAnchors[0]}`);
    if (!siteCss.includes('.book-prose h1{break-before:page')) failures.push('site.css: chapters do not start a new sheet when printed');
    if (!siteCss.includes('.book-prose a[href^="http"]::after')) failures.push('site.css: printed pages lose the addresses of external links');
  }
}
if (htmlFiles.length !== 48) failures.push(`expected 48 routes, got ${htmlFiles.length}`);
if (failures.length) throw new Error(`Site validation failed:\n${failures.slice(0, 30).join('\n')}`);
console.log(`Validated ${htmlFiles.length} routes: links, anchors, ${bankSize.items} items, ${bankSize.cases} scenarios.`);
