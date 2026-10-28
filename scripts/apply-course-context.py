"""Render the authored infrastructure role and transfer task into every lesson."""
import html
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
course = root / 'content/course'
manifest = json.loads((course / 'manifest.json').read_text(encoding='utf-8'))
curriculum = json.loads((course / 'infrastructure.json').read_text(encoding='utf-8'))
assert set(curriculum['lessons']) == {lesson['id'] for lesson in manifest['lessons']}
esc = html.escape

for lesson in manifest['lessons']:
    path = course / lesson['file']
    body = path.read_text(encoding='utf-8')
    body = re.sub(r'<!-- INFRASTRUCTURE-CONTEXT -->.*?<!-- /INFRASTRUCTURE-CONTEXT -->', '', body, flags=re.S)
    role, evidence, transfer = curriculum['lessons'][lesson['id']]
    unit = curriculum['units'][lesson['unit']]
    inserts = {
        'goal': f'<aside class="infrastructure-role" data-infrastructure-role><p><strong>Часть общей системы:</strong> {esc(role)}.</p>'
                f'<p><strong>Что сохранить в инженерном журнале:</strong> {esc(evidence)}.</p></aside>',
        'reflection': f'<aside class="infrastructure-transfer" data-infrastructure-transfer><h3>Перенеси навык в свою лабораторию</h3>'
                      f'<p>{esc(transfer)}</p><p><strong>Результат блока:</strong> {esc(unit["result"])}</p>'
                      f'<p><a href="/laboratory/#milestone-{lesson["unit"]}">Собрать результат блока и проверить его</a>. '
                      'Сохрани факты в заметке к уроку или своём журнале. Свободный разбор не получает автоматического зачёта.</p></aside>'
    }
    for block, fragment in inserts.items():
        pattern = rf'(<section\b[^>]*data-block="{block}"[^>]*>.*?)(</section>)'
        body, count = re.subn(pattern, lambda match: match[1] + '<!-- INFRASTRUCTURE-CONTEXT -->' + fragment + '<!-- /INFRASTRUCTURE-CONTEXT -->' + match[2], body, flags=re.S)
        assert count == 1, (lesson['id'], block, count)
    path.write_text(body, encoding='utf-8', newline='\n')
print(f'Infrastructure roles and transfer tasks rendered: {len(manifest["lessons"])} lessons, {len(curriculum["units"])} milestones.')
