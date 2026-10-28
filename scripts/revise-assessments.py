"""Apply explicit corrections and expose direct teaching links; never infer acceptance."""
import html
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
COURSE = ROOT / 'content/course'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p, data): p.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
bank = read(COURSE / 'assessments.json')
manifest = read(COURSE / 'manifest.json')
mapping = read(ROOT / 'quality/curriculum-map.json')
corrections = read(COURSE / 'editorial/assessment-corrections.json')
scenario_notes = read(COURSE / 'editorial/scenario-notes.json')
entries = {e['id']: e for e in mapping['assessments']}
current = {id: l['id'] for l in manifest['lessons'] for id in l['checks']}
overrides = {
 'M00-1':'latency', 'M00-2':'benchmark', 'R00':'units',
 'M01-0':'pcie', 'M01-2':'pcie', 'R02':'cpu-numa',
 'M03-0':'write-cache','M03-1':'filesystem','M03-2':'filesystem',
 'M04-1':'boot','M04-2':'logs','R04':'permissions',
 'M06-2':'prefix','R06':'prefix',
 'M07-0':'mtu','M07-2':'mtu','R07':'mtu',
 'M08-0':'availability','M08-1':'firewall','R08':'availability',
 'M09-1':'ecc','M11-1':'power','R11':'power',
 'M12-1':'benchmark','R12':'benchmark',
 'M13-0':'lvm','M13-2':'lvm','R13':'lvm','M13-1':'database-write',
 'M14-1':'storage-path','M15-0':'multipath','M15-2':'multipath','R15':'multipath',
 'M18-0':'latency','R18':'latency',
 'M19-0':'vm-backup','M20-1':'restore-point','M20-2':'alert','M20-0':'alert',
 'M21-1':'shell-failure','M22-0':'api-pages','M22-1':'python-result',
 'M23-0':'ansible-state','M23-1':'ansible-state','M23-2':'ansible-state',
 'M24-0':'container-network','M25-1':'terraform',
 'M26-0':'service-selector', 'M27-1':'secure-boot','M27-2':'firmware-phases',
 'M28-1':'acpi','M29-2':'acpi','M30-2':'tls',
 'M31-1':'duration','M32-1':'restore-point','R32':'restore-point',
 'M35-1':'decommission',
 'L03A#why':'filesystem','L03B#why':'memory',
 'L04B#why':'boot','L06B#why':'prefix','L07B#why':'mtu',
 'L08B#why':'firewall','L15A#why':'multipath',
}
groups = {'S00:':'benchmark','S03:':'filesystem','S06:':'prefix','S07:':'mtu',
          'S13:':'lvm','S15:':'multipath','S23:':'ansible-state',
          'C02-':'process','S2-':'process','C07-0':'dns','C07-1':'mtu',
          'S31:':'time'}
cards = {l['id']: [] for l in manifest['lessons']}
changed = []
for item in bank['items']:
    id = item['id']
    if id not in entries:
        continue
    patch = corrections.get(id, {})
    scenario = re.fullmatch(r'S(\d\d):(\d)', id)
    if scenario:
        number,step=map(int,scenario.groups())
        note=scenario_notes[str(number)]
        item.setdefault('initialContext',item['context'])
        item.setdefault('discoveredFacts',item['explanation'])
        context='Учебный разбор предоставленных данных. Это не выполненное действие на ВМ.\n'+item['initialContext']
        if step>=1: context+='\nФакт после предыдущей проверки: '+note.get('finding',item['discoveredFacts'])
        if step>=2 and note.get('repairCondition'):context+='\nУсловия выбора изменения: '+note['repairCondition']
        item['context']=context
        item['explanation']=note['mechanism']
        if number==23:item['stem']=item['stem'].replace('Ложная идемпотентность','Сходимость к неверной конфигурации')
    if 'options' in patch: item['options'] = patch['options']
    if 'reasonOptions' in patch: item['reason']['options'] = patch['reasonOptions']
    if 'fieldLabels' in patch:
        for field,label in zip(item['fields'],patch['fieldLabels'],strict=True): field['label']=label
    for key in ['stem', 'explanation']:
        if key in patch: item[key] = patch[key]
    if 'correct' in patch: item['options'][item['answer']] = patch['correct']
    if 'reasonCorrect' in patch: item['reason']['options'][item['reason']['answer']] = patch['reasonCorrect']
    if any(k not in ('reviewed','reviewNote') for k in patch): changed.append(id)
    target = overrides.get(id)
    if target is None:
        target = next((v for prefix,v in groups.items() if id.startswith(prefix)), current[id])
    anchor = 'mechanism-' + re.sub('[^A-Za-z0-9_-]', '-', id)
    entry = entries[id]
    entry.setdefault('previousSource', entry['source'])
    entry.setdefault('previousEvidence', entry['evidence'])
    paragraph = item.get('explanation', '')
    if item.get('reason'):
        paragraph += ' ' + item['reason']['options'][item['reason']['answer']] + '.'
    elif item.get('options'):
        paragraph += ' Применение к описанным условиям: ' + item['options'][item['answer']] + '.'
    elif item.get('fields'):
        paragraph += ' ' + '; '.join(f'{f["label"]}: {f["answer"]}' for f in item['fields']) + '.'
    entry.update(lesson=target, source=anchor, evidence=paragraph)
    # Acceptance is explicit in the authored correction after inspecting alternatives,
    # never derived from paragraph existence or from running this generator.
    if patch.get('reviewed') is True: entry['reviewed']=True
    item['mechanism'] = anchor
    item['lesson'] = target
    if item.get('type') == 'lab':
        lab = next(l for l in bank['labs'] if l['id']==item['labId'])
        for key in ['options','answer','explanation']:
            lab['why'][key] = item[key]
        lab['why']['q'] = item['stem']
    cards[target].append(f'<section id="{anchor}" data-assessment-source="{html.escape(id)}"><h3>{html.escape(id)}: {html.escape(item["stem"])}</h3><p>{html.escape(paragraph)}</p></section>')
for lesson in manifest['lessons']:
    foundation = [id for id in lesson['checks'] if id not in entries]
    lesson['checks'] = foundation + [i['id'] for i in bank['items'] if i['id'] in entries and i['lesson']==lesson['id']]
    path = COURSE / lesson['file']
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'<!-- ASSESSMENT-MECHANISMS -->[\s\S]*?<!-- /ASSESSMENT-MECHANISMS -->\n?', '', text)
    if cards[lesson['id']]:
        block = '<!-- ASSESSMENT-MECHANISMS --><details data-block="mechanisms"><summary>Механизмы для заданий углубления</summary><p>Прочитай механизм до решения. Вопросы и варианты ответов сверены с этими объяснениями; сохранены идентификаторы прежних заданий. Новые углубления разбирают другие условия; подробный исходный текст остаётся в архиве.</p>'+''.join(cards[lesson['id']])+'</details><!-- /ASSESSMENT-MECHANISMS -->\n'
        boundary = text.find('<details data-block="depth">')
        if boundary < 0: boundary = text.rfind('</article>')
        text = text[:boundary]+block+text[boundary:]
    path.write_text(text,encoding='utf-8')
foundation_reviews = read(COURSE / 'editorial/foundation-assessments.json')
for item in bank['items']:
    if item['id'] in foundation_reviews:
        item.update({key: value for key, value in foundation_reviews[item['id']].items() if key != 'evidence'})
for item in mapping.get('foundationAssessments', []):
    item['evidence'] = foundation_reviews[item['id']]['evidence']
write(COURSE / 'manifest.json',manifest)
write(COURSE / 'assessments.json',bank)
write(ROOT / 'quality/curriculum-map.json',mapping)
write(ROOT / 'quality/assessment-revision.json',{
    'date':'2026-10-27', 'corrected':changed,
    'directExplanations':len(entries), 'acceptedChecks':[id for id,p in corrections.items() if p.get('reviewed')], 'acceptance':'accepted' if all(e['reviewed'] for e in entries.values()) else 'partial',
    'note':'Manual review decisions are explicit in the editorial source. Assessment acceptance is separate from lesson editorial hashes and live lab acceptance.'})
print(f'{len(changed)} corrections; {sum(p.get("reviewed") is True for p in corrections.values())} explicitly reviewed items; {len(entries)} direct teaching links.')
