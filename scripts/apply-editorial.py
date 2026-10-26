"""Render explicitly authored lesson blocks; retain legacy sections and their anchors."""
import html
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
COURSE = ROOT / 'content/course'
spec = importlib.util.spec_from_file_location('lesson_editorial', COURSE / 'editorial/remaining.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
authored = {**json.loads((COURSE / 'editorial/linux.json').read_text(encoding='utf-8')), **module.LESSONS}
manifest = json.loads((COURSE / 'manifest.json').read_text(encoding='utf-8'))
diagrams = json.loads((COURSE / 'editorial/diagrams.json').read_text(encoding='utf-8'))
escape = html.escape

for lesson in manifest['lessons']:
    if lesson['id'] not in authored:
        continue
    data = authored[lesson['id']]
    path = COURSE / lesson['file']
    original = path.read_text(encoding='utf-8')
    depth = original.find('<details data-block="depth">')
    mechanisms = original.find('<!-- ASSESSMENT-MECHANISMS -->')
    if mechanisms >= 0:
        depth = min(depth, mechanisms) if depth >= 0 else mechanisms
    tail = original[depth:] if depth >= 0 else '</article>\n'
    if depth < 0 and re.search(r'\bid="(?!lesson-)[^"]+"', original):
        # Newly authored block IDs are safe to replace; unknown legacy IDs are not.
        ids = re.findall(r'\bid="([^"]+)"', original)
        if any(id not in {f'{lesson["id"]}-{b}' for b in ('goal','explain','example','guided','independent','reflection')} and id != f'lesson-{lesson["id"]}' for id in ids):
            raise ValueError(f'Unmapped legacy anchor in {lesson["id"]}')
    blocks = (
        ('goal', lesson['title'], f'<p><strong>Результат:</strong> {escape(data["goal"])}</p><p><strong>Объект:</strong> {escape(data["object"])}</p>'),
        ('explain', 'Разберёмся до действия', f'<p>{escape(data["explain"])}</p><p><strong>Среда и права:</strong> {escape(data["rights"])}</p>'),
        ('example', 'Разобранный пример', f'<p>{"Данные примера" if lesson["environment"] in ("dataset", "reading", "hardware") else "Команды примера; переменные WORK и NS задаются в инструкции практики ниже"}:</p><pre><code>{escape(data["command"])}</code></pre><p><strong>Ожидаемый результат:</strong> {escape(data["expected"])}</p><p>{escape(data["why"])}</p><p><strong>При отклонении:</strong> {escape(data["deviation"])}</p>'),
        ('guided', 'Прогноз и опыт с поддержкой', f'<p>{escape(data["guided"])}</p>'),
        ('independent', 'Самостоятельная задача', f'<p>{escape(data["independent"])}</p>'),
        ('reflection', 'Объясни и вернись позже', f'<p>{escape(data["reflection"])}</p><p>Свободное объяснение сохраняется для самопроверки; автоматическая проверка не оценивает его смысл.</p><p>Первоисточник для сверки поведения и версии: <a href="{escape(data["source"], quote=True)}">документация</a>. Команды Linux рассчитаны на Debian 12/13; доступность конкретной функции проверяется предпосылками работы.</p>'),
    )
    result = f'<article id="lesson-{lesson["id"]}">\n'
    for name, title, body in blocks:
        if name=='explain':
            body += '<figure class="simple-model">'+' → '.join(f'<span>{escape(label)}</span>' for label in diagrams[lesson['id']])+'<figcaption>Связи, которые проверяем в этом уроке.</figcaption></figure>'
        tag = 'h1' if name == 'goal' else 'h2'
        result += f'<section data-block="{name}" id="{lesson["id"]}-{name}"><{tag}>{escape(title)}</{tag}>{body}</section>\n'
    # Base explanation acceptance is deliberately separate from full depth/assessment review.
    path.write_text(result + tail, encoding='utf-8')
    lesson['baseRevision'] = '2026-10-27'

(COURSE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(f'{len(authored)} authored lesson chains rendered; legacy depth review flags were not changed.')
