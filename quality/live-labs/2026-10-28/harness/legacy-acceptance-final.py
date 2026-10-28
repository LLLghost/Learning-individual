import json,subprocess,os,time,hashlib,traceback
from pathlib import Path
ROOT=Path('/home/course/legacy-acceptance-20261028-final');ROOT.mkdir(exist_ok=True)
COL=Path('/root/mayak-acceptance-20261028/course_lab.py')
Path('/etc/course-lab-stand').write_text('mayak-acceptance-20261028\n')
results=[];phases=[]
def run(cmd,check=True,timeout=120):
 p=subprocess.run(cmd,shell=isinstance(cmd,str),executable='/bin/bash' if isinstance(cmd,str) else None,capture_output=True,text=True,timeout=timeout)
 phases.append({'command':cmd,'code':p.returncode,'stdout':p.stdout,'stderr':p.stderr})
 if check and p.returncode:raise RuntimeError(str(phases[-1]))
 return p.stdout
COL=Path('/usr/local/lib/mayak-course-lab.py');run(['cp','/root/mayak-acceptance-20261028/course_lab.py',str(COL)])

def collector(action,lab,folder,extra=[]):
 cmd=['python3',str(COL),action,lab,str(folder),*extra]
 return run(cmd)
def answer(folder,data): (folder/'answer.json').write_text(json.dumps(data))
def save(): (ROOT/'legacy-acceptance.json').write_text(json.dumps({'collectorSha256':hashlib.sha256(COL.read_bytes()).hexdigest(),'results':results},ensure_ascii=False,indent=2))
for lab in ['L04A','L06B','L07B','L12A','L13B','L14B','L16B','L30B','L31A']:
 row={'lab':lab,'variants':[]};results.append(row)
 for variant in [0,1]:
  print('START',lab,variant,flush=True);folder=ROOT/lab/str(variant);folder.mkdir(parents=True,exist_ok=True);phases=[];v={'variant':variant,'phases':phases};row['variants'].append(v);cleanup=[];ns=[]
  try:
   extra=[];claim={};unit=f'mayak-legacy-{variant}.service';pool=f'leg{variant}s';target=f'leg{variant}t';vg=f'legvg{variant}'
   if lab=='L04A':
    u=Path('/etc/systemd/system')/unit;u.write_text('[Unit]\nDescription=Mayak real failure and recovery\n[Service]\nType=oneshot\nWorkingDirectory=/mayak-intentionally-missing\nExecStart=/bin/true\n');run('systemctl daemon-reload');run(['systemctl','start',unit],False);extra=['--unit',unit]
    cleanup=[f'systemctl stop {unit} || true; rm -rf /etc/systemd/system/{unit} /etc/systemd/system/{unit}.d; systemctl daemon-reload; systemctl reset-failed {unit} || true']
   if lab in ['L06B','L07B']:
    a=f'lega{variant}';b=f'legb{variant}';ns=[a,b]
    run(f'ip netns add {a}; ip netns add {b}; ip link add lc0 type veth peer name lp0; ip link set lc0 netns {a}; ip link set lp0 netns {b}; ip -n {a} link set lo up; ip -n {b} link set lo up; ip -n {a} link set lc0 up; ip -n {b} link set lp0 up; ip -n {a} addr add 10.10.10.11/24 dev lc0; ip -n {b} addr add 10.10.10.1/24 dev lp0; ip -n {b} addr add 10.10.20.12/32 dev lo; ip -n {a} route add default via 10.10.10.1')
    extra=['--iface','lc0','--mgmt','lo','--local','10.10.10.11','--peer','10.10.20.12','--seed',next(f'acceptance-{i}' for i in range(100) if int(hashlib.sha256(f'acceptance-{i}'.encode()).hexdigest(),16)%3==variant)]
    if lab=='L07B':
     (folder/'probe.bin').write_bytes(b'mayak'*20000);p=subprocess.Popen(['ip','netns','exec',b,'python3','-m','http.server','8080','--bind','10.10.20.12','--directory',str(folder)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);cleanup.append(f'kill {p.pid} || true');time.sleep(.3)
   if lab=='L12A':
    disks=json.loads(run(['lsblk','-J','-o','NAME,TYPE,SERIAL']))['blockdevices'];disk=next(d for d in disks if d.get('serial')=='MAYAK-LAB-EMPTY');claim={'device':disk['name'],'serial':disk['serial']}
   if lab in ['L13B','L14B']:
    loops=[]
    for i in range(1 if lab=='L13B' else 2):
     f=folder/f'disk{i}.img';run(['truncate','-s','256M',str(f)]);loops.append(run(['losetup','--find','--show',str(f)]).strip())
    cleanup += [f'losetup -d {x}' for x in loops]
    if lab=='L13B':
     m=folder/'mnt';m.mkdir();run(f'pvcreate -ff -y {loops[0]}; vgcreate {vg} {loops[0]}; lvcreate -L 64M -n data {vg}; mkfs.ext4 -F /dev/{vg}/data; mount /dev/{vg}/data {m}');(m/'control.bin').write_bytes(os.urandom(4096));extra=['--volume',f'/dev/{vg}/data','--mount',str(m)];cleanup.insert(0,f'umount {m}; vgremove -ff -y {vg}; pvremove -ff -y {loops[0]}');claim={'lv_size_mib':128,'gap_seen':True}
    else:
     run(['mdadm','--create','/dev/md127','--run','--metadata=1.2','--level=1','--raid-devices=2',*loops]);run('mdadm --wait /dev/md127',False);extra=['--array','md127'];cleanup.insert(0,'mdadm --stop /dev/md127');claim={'failed_member':loops[1]}
   if lab=='L16B':
    for name in [pool,target]:
     f=folder/f'{name}.img';run(['truncate','-s','128M',str(f)]);run(['zpool','create','-m',str(folder/name),name,str(f)]);cleanup.append(f'zpool destroy {name}')
    run(['zfs','create',pool+'/app']);control=folder/pool/'app/control.bin';control.write_bytes(os.urandom(4096));extra=['--pool',pool,'--target-pool',target,'--file',str(control)];claim={'snapshot':pool+'/app@trial','received':target+'/app@trial','restored_file':str(folder/target/'app/control.bin')}
   if lab=='L30B':
    run(f'openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=MayakRoot -days 2 -addext basicConstraints=critical,CA:TRUE -keyout {folder}/root.key -out {folder}/root.pem; openssl req -newkey rsa:2048 -nodes -subj /CN=notes.test -keyout {folder}/server.key -out {folder}/server.csr');(folder/'ext').write_text('subjectAltName=DNS:notes.test\nbasicConstraints=CA:FALSE\n');run(f'openssl x509 -req -in {folder}/server.csr -CA {folder}/root.pem -CAkey {folder}/root.key -CAcreateserial -days 2 -extfile {folder}/ext -out {folder}/server.pem');extra=['--root-cert',str(folder/'root.pem'),'--cert',str(folder/'server.pem')];claim={'error_without_root':'unable to get local issuer certificate'}
   prefix=['ip','netns','exec',ns[0]] if ns else []
   def collect(action):
    return run([*prefix,'python3',str(COL),action,lab,str(folder),*extra])
   collect('init');state=json.load(open(folder/'lab-state.json'));v['state']=state
   answer(folder,{'L04A':{'exit_status':0},'L06B':{'wrong_prefix':1},'L07B':{'path_mtu':1000},'L12A':{'device':'missing','serial':'missing'},'L13B':{'lv_size_mib':1,'gap_seen':False},'L14B':{'failed_member':'/dev/missing'},'L16B':{'snapshot':'missing@x','received':'missing@x','restored_file':'/missing'},'L30B':{'error_without_root':'wrong'},'L31A':{'drift_ppm':0}}[lab]);collect('collect');(folder/'negative.json').write_bytes((folder/'lab-report.json').read_bytes())
   if lab=='L04A':
    d=Path('/etc/systemd/system')/(unit+'.d');d.mkdir();(d/'working.conf').write_text('[Service]\nWorkingDirectory=/tmp\n');run('systemctl daemon-reload');run(['systemctl','start',unit]);claim={'exit_status':200}
   if lab=='L06B':run(['ip','-n',ns[0],'addr','del',state['address'],'dev','lc0']);claim={'wrong_prefix':int(state['address'].split('/')[1])}
   if lab=='L07B':claim={'path_mtu':int(run(['ip','-n',ns[0],'-j','link','show','lc0']).split('"mtu":')[1].split(',')[0])}
   if lab=='L13B':run(f'lvextend -L 128M /dev/{vg}/data; resize2fs /dev/{vg}/data')
   if lab=='L14B':
    run(['mdadm','/dev/md127','--fail',loops[1],'--remove',loops[1]]);run(['mdadm','/dev/md127','--add',loops[1]]);run(['mdadm','--wait','/dev/md127'],False);time.sleep(1)
   if lab=='L16B':run(f'zfs snapshot {pool}/app@trial; zfs send {pool}/app@trial | zfs receive {target}/app; zpool scrub {pool}; zpool wait -t scrub {pool}')
   if lab=='L31A':
    run(['chronyc','burst','4/4']);time.sleep(12);run(['systemctl','stop','chrony']);run(['systemctl','start','chrony']);time.sleep(10)
    drift=Path('/var/lib/chrony/chrony.drift');claim={'drift_ppm':float(drift.read_text().split()[0])}
   answer(folder,claim);collect('collect');(folder/'positive.json').write_bytes((folder/'lab-report.json').read_bytes());collect('restore');v['status']='collected'
  except Exception as e:v['status']='failed';v['error']=str(e)
  finally:
   for cmd in cleanup:
    try:run(cmd,False)
    except Exception as e:v.setdefault('cleanupErrors',[]).append(str(e))
   for n in ns:run(f'ip netns pids {n} | xargs -r kill; ip netns del {n}',False)
   save();print(lab,variant,v['status'],v.get('error','')[:350],flush=True)
