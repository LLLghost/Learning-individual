import json
from pathlib import Path
from controller import ROOT,ssh,run

program=r'''
import json,subprocess
from pathlib import Path
active=[str(p) for p in Path('/var/lib/mayak-practice').glob('*/state.json') if json.loads(p.read_text()).get('active')]
assert not active,active
commands=[['ip','netns','list'],['losetup','-a'],['zpool','list','-H'],['dmsetup','ls'],['docker','ps','-a','--format','{{.Names}}'],['findmnt','-rn','-o','TARGET']]
facts=[]
for cmd in commands:
 p=subprocess.run(cmd,capture_output=True,text=True);facts.append(dict(command=cmd,code=p.returncode,stdout=p.stdout,stderr=p.stderr))
assert not facts[0]['stdout'].strip(),facts[0]
assert not facts[1]['stdout'].strip(),facts[1]
assert not facts[2]['stdout'].strip(),facts[2]
assert 'No devices found' in facts[3]['stdout'] or not facts[3]['stdout'].strip(),facts[3]
assert not facts[4]['stdout'].strip(),facts[4]
assert not any('/var/lib/mayak-practice/' in line or 'legacy-acceptance' in line for line in facts[5]['stdout'].splitlines()),facts[5]
print(json.dumps(dict(active=active,checks=facts),indent=2))
'''
result=ssh('172.30.253.20','python3','-c',program)
(ROOT/'clean-guest-resources.json').write_text(result.stdout)
host=[]
for cmd in [['pveversion'],['uname','-a'],['lscpu','--json'],['free','-m'],['lsblk','-d','-o','NAME,TYPE,SIZE,MODEL'],['systemd-detect-virt']]:
 p=run(cmd,tolerate=True);host.append(dict(command=cmd,code=p.returncode,stdout=p.stdout,stderr=p.stderr))
(ROOT/'platform-observations.json').write_text(json.dumps(host,indent=2))
print('Clean resource audit: no active attempts, namespaces, loop devices, pools, mappings or containers',flush=True)
