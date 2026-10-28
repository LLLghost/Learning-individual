from controller import ROOT,OWNER,config,guest,run,ssh
import json
from pathlib import Path
facts={'schema':'mayak-final-stand-audit-v1','configs':{},'status':[]}
for vmid in [9200,9201,9202]:
 c=config(vmid);assert c and c['description'].startswith(OWNER),c
 facts['configs'][str(vmid)]=c
 p=run(['qm','status',vmid]);assert 'running' in p.stdout;facts['status'].append(p.stdout)
probe=json.loads(guest(9201,'runuser','-u','mayak-observer','--','/usr/local/bin/mayak-probe'));assert probe['passed'],probe
facts['clientProbe']=probe
for vmid in [100,101,9203]:assert config(vmid) is None,vmid
volumes=run(['lvs','--noheadings','-o','lv_name']).stdout.split();assert not any(any(v.startswith(f'vm-{n}-') for n in [100,101,9203]) for v in volumes)
facts['temporaryVmIdsAbsent']=[100,101,9203];facts['temporaryVolumesAbsent']=True
facts['originals']={str(n):dict(config=config(n),status=run(['qm','status',n]).stdout,snapshots=run(['qm','listsnapshot',n]).stdout) for n in [9100,9101]}
assert all('stopped' in v['status'] for v in facts['originals'].values())
program="""import json,subprocess
from pathlib import Path
active=[str(p) for p in Path('/var/lib/mayak-practice').glob('*/state.json') if json.loads(p.read_text()).get('active')]
assert not active,active
facts={'activeAttempts':active}
for name,cmd in [('namespaces',['ip','netns','list']),('loops',['losetup','-a']),('pools',['zpool','list','-H']),('mappings',['dmsetup','ls']),('containers',['docker','ps','-a','--format','{{.Names}}'])]:
 p=subprocess.run(cmd,capture_output=True,text=True);facts[name]={'code':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
 assert not p.stdout.strip() or (name=='mappings' and 'No devices found' in p.stdout),facts[name]
print(json.dumps(facts))
"""
facts['guestResources']=json.loads(ssh('172.30.253.20','python3','-c',program).stdout)
(ROOT/'final-stand-audit.json').write_text(json.dumps(facts,indent=2))
print('FINAL AUDIT: client TLS/DNS/data OK; 3 owned VMs running; 3 temporary VMs and disks absent; no active practice resources; original VMs/snapshots preserved')

