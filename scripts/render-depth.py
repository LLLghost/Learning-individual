"""Replace legacy depth with authored explanations, keeping a transparent concordance."""
import html
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
COURSE = ROOT / 'content/course'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')


spec = importlib.util.spec_from_file_location('authored_depth', COURSE/'editorial/depth.py')
depth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(depth)
manifest = read(COURSE/'manifest.json')
map_path = ROOT/'quality/depth-map.json'
esc = html.escape

if map_path.exists():
    mapping = read(map_path)
else:
    # Capture only provenance, not a second copy of old course prose.
    entries = []
    for lesson in manifest['lessons']:
        if lesson['id'] not in depth.LESSONS:
            continue
        text = (COURSE/lesson['file']).read_text(encoding='utf-8')
        if '<details data-block="depth">' not in text:
            continue
        legacy = text.split('<details data-block="depth">', 1)[-1]
        for match in re.finditer(r'<section\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)(?=<section\b|</details>|\Z)', legacy):
            id, body = match.groups()
            heading = re.search(r'<h[1-6][^>]*>([\s\S]*?)</h[1-6]>', body)
            title = html.unescape(re.sub('<[^>]*>', '', heading[1])).strip() if heading else id
            entries.append(dict(id=id, lesson=lesson['id'], sourceTitle=title,
                                target=f'{lesson["id"]}-depth-model',
                                archive='/archive/v6/book/#'+id))
    mapping = dict(schema='course-depth-map-v1', date='2026-10-27',
                   method='thematic-consolidation',
                   note='Old headings are concordance entries, not 1248 separately rewritten explanations. New lesson depth consolidates topics; complete old text remains in archive/v6.',
                   entries=entries)
    write(map_path, mapping)

assert set(depth.LESSONS) == {l['id'] for l in manifest['lessons'][6:]}, 'Expected 76 authored lessons'
assert len({e['id'] for e in mapping['entries']}) == len(mapping['entries']), 'Duplicate provenance anchor'
for lesson in manifest['lessons']:
    id = lesson['id']
    if id not in depth.LESSONS:
        continue
    data = depth.LESSONS[id]
    path = COURSE/lesson['file']
    text = path.read_text(encoding='utf-8')
    index = text.find('<details data-block="depth">')
    if index < 0:
        assert not any(e['lesson']==id for e in mapping['entries']), f'Missing legacy depth: {id}'
        index = text.rfind('</article>')
    assert index >= 0, id
    body = f'<details data-block="depth"><summary>Углубление: {esc(data["title"])}</summary>\n'
    body += f'<section id="{id}-depth-model"><h2>{esc(data["title"])}</h2><p>{esc(data["model"])}</p><p>{esc(data["detail"])}</p></section>\n'
    body += f'<section id="{id}-depth-case"><h3>Другие условия: разобранный случай</h3><p><strong>Даны наблюдения:</strong> {esc(data["facts"])}</p><p><strong>Разбор:</strong> {esc(data["interpretation"])}</p><p>Это учебные данные, а не протокол выполненного действия.</p></section>\n'
    body += f'<section id="{id}-depth-transfer"><h3>Проверь перенос понимания</h3><p>{esc(data["task"])}</p><p><strong>Граница вывода и безопасного действия:</strong> {esc(data["boundary"])}</p><p>Сохрани решение в своих наблюдениях. При остановке запиши последнее подтверждённое состояние и следующий вопрос; позже начни с проверки этого состояния.</p></section>\n'
    sources = {
        'systemd': ('https://manpages.debian.org/bookworm/systemd/systemd.unit.5.en.html', 'systemd в Debian 12: unit dependencies'),
        'memory': ('https://docs.kernel.org/admin-guide/mm/concepts.html', 'Linux: concepts of memory management'),
        'filesystem': ('https://docs.kernel.org/filesystems/ext4/journal.html', 'Linux ext4: journal и режимы данных'),
        'ceph': ('https://docs.ceph.com/en/squid/rados/configuration/pool-pg-config-ref/', 'Ceph Squid: replicated pool size/min_size'),
        'cpu-numa': ('https://docs.kernel.org/arch/x86/topology.html', 'Linux x86: уровни топологии CPU'),
        'container-network': ('https://docs.docker.com/engine/network/port-publishing/', 'Docker: публикация портов; различия до 28.0.0'),
    }
    if id in sources:
        source, label = sources[id]
        body += f'<p class="depth-source">Первоисточник: <a href="{esc(source)}">{esc(label)}</a>. Сверяй установленную версию: документация другой ветви может описывать иное поведение.</p>\n'
    if id in {'uefi','secure-boot','firmware-phases','acpi'}:
        body += '<p class="depth-source">Базовая модель: UEFI 2.10, PI 1.8 и ACPI 6.5; это не утверждение о версии конкретной платы. <a href="https://uefi.org/specifications">Спецификации UEFI Forum</a>. Возможности реализации сверяют по документации платформы.</p>\n'
    # Old URLs land on an explicit index entry, not on stale prose masquerading as new.
    provenance = [e for e in mapping['entries'] if e['lesson']==id]
    if provenance:
        body += '<details class="legacy-concordance"><summary>Соответствие разделам прежнего издания</summary><p>Повторные миссии, примеры и итоги объединены в разбор выше. Здесь сохранены прежние адреса; полный исходный текст доступен в архиве.</p>\n'
        for entry in provenance:
            body += f'<section id="{esc(entry["id"])}" data-origin="v6-index"><h3>{esc(entry["sourceTitle"])}</h3><p><a href="#{esc(entry["target"])}">Новый разбор темы</a> · <a href="{esc(entry["archive"])}">Исходный раздел в архиве</a></p></section>\n'
        body += '</details>\n'
    body += '</details>\n</article>\n'
    path.write_text(text[:index]+body, encoding='utf-8', newline='\n')
    lesson['depthRevision'] = '2026-10-27'
write(COURSE/'manifest.json', manifest)
print(f'{len(depth.LESSONS)} authored depth replacements; {len(mapping["entries"])} explicit old-section concordance entries. Review flags unchanged.')
