"""Author acceptance on owned VMs: real DNS, TLS, data, faults and independent restores."""
import hashlib
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import time
import traceback
from controller import ROOT, OWNER, KEY, KNOWN, config, guest, run, ready

IPS={9200:'172.30.253.20',9201:'172.30.253.21',9202:'172.30.253.22'}
SNAP='mayak-infrastructure-base'
DATA='/srv/mayak-infrastructure/data'
run_id=time.strftime('%Y%m%d-%H%M%S',time.gmtime())
record={'schema':'mayak-integrated-lab-v1','run':run_id,'metadata':json.loads((ROOT/'run-meta.json').read_text()),'variants':[],'events':[]}
variant=None

def save(stage=None):
    if stage:record['stage']=stage
    text=json.dumps(record,ensure_ascii=False,indent=2)
    (ROOT/f'integration-{run_id}.json').write_text(text)
    temp=ROOT/'integration-current.tmp';temp.write_text(text);temp.replace(ROOT/'integration-current.json')

def host(args,timeout=900):
    p=run(args,timeout=timeout,tolerate=True)
    record['events'].append({'scope':'host','command':[str(x) for x in args],'code':p.returncode,'stdout':p.stdout,'stderr':p.stderr})
    save()
    if p.returncode:raise RuntimeError(str(record['events'][-1]))
    return p

def remote(vmid,args,expected=0,timeout=120):
    command=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={KNOWN}',
             '-i',KEY,'root@'+IPS[vmid],shlex.join([str(a) for a in args])]
    start=time.monotonic();p=subprocess.run(command,capture_output=True,text=True,timeout=timeout)
    event={'vmid':vmid,'command':[str(a) for a in args],'code':p.returncode,'seconds':round(time.monotonic()-start,3),'stdout':p.stdout,'stderr':p.stderr,'expected':expected}
    record['events'].append(event);save()
    if p.returncode==255 or (expected is not None and p.returncode!=expected):raise RuntimeError(str(event))
    return p

def put(vmid,source,target):
    host(['scp','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={KNOWN}',
          '-i',KEY,source,f'root@{IPS[vmid]}:{target}'])

def probe(passed=True,extra=None):
    p=remote(9201,['runuser','-u','mayak-observer','--','/usr/local/bin/mayak-probe',*(extra or [])],0 if passed else 1)
    value=json.loads(p.stdout)
    assert value['passed'] is passed,value
    return value

def wait_healthy():
    deadline=time.monotonic()+45
    while True:
        p=remote(9201,['runuser','-u','mayak-observer','--','/usr/local/bin/mayak-probe'],None)
        result=json.loads(p.stdout)
        if p.returncode==0 and result['passed']:return result
        if time.monotonic()>deadline:raise RuntimeError(str(result))
        time.sleep(1)

def owned(vmid):
    vm=config(vmid);assert vm and OWNER in vm.get('description',''),vm
    return vm

def stop(vmid):
    owned(vmid)
    if 'running' in host(['qm','status',vmid]).stdout:host(['qm','shutdown',vmid,'--timeout','90'])
    assert 'stopped' in host(['qm','status',vmid]).stdout

def prepare_baseline():
    save('baseline')
    for vmid in IPS:
        stop(vmid)
        if SNAP not in host(['qm','listsnapshot',vmid]).stdout:
            host(['qm','snapshot',vmid,SNAP,'--description','Cold configured identity/network; before integrated application'])

def clean_start():
    for vmid in IPS:
        stop(vmid);host(['qm','rollback',vmid,SNAP]);host(['qm','start',vmid])
    identities=[]
    for vmid,ip in IPS.items():
        ready(vmid)
        addresses=json.loads(guest(vmid,'ip','-j','address'))
        assert any(a.get('local')==ip for n in addresses for a in n.get('addr_info',[])),(vmid,addresses)
        identity=guest(vmid,'cat','/etc/machine-id').strip();identities.append(identity)
        remote(vmid,['hostname'])
        variant.setdefault('machineIds',{})[str(vmid)]=identity
    assert len(set(identities))==3,'Cloned guests must have independent machine identities'

def certificates():
    pki=ROOT/'pki';pki.mkdir(mode=0o700,exist_ok=True)
    if not (pki/'server.crt').exists():
        host(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',pki/'ca.key','-out',pki/'ca.crt','-days','3','-subj','/CN=Mayak laboratory acceptance CA','-addext','basicConstraints=critical,CA:TRUE'])
        host(['openssl','req','-newkey','rsa:2048','-nodes','-keyout',pki/'server.key','-out',pki/'server.csr','-subj','/CN=inventory.mayak.test'])
        (pki/'server.ext').write_text('subjectAltName=DNS:inventory.mayak.test\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
        host(['openssl','x509','-req','-in',pki/'server.csr','-CA',pki/'ca.crt','-CAkey',pki/'ca.key','-CAcreateserial','-out',pki/'server.crt','-days','3','-extfile',pki/'server.ext'])
        for key in pki.glob('*.key'):key.chmod(0o600)
    return pki

def deploy(number):
    save('deploy-'+str(number))
    port=8443+number
    source=ROOT/'variants'/str(number)/'deploy';source.mkdir(parents=True,exist_ok=True)
    for path in (ROOT/'deploy').iterdir():
        if path.is_file():shutil.copy2(path,source/path.name)
    pki=certificates()
    for name in ['server.crt','server.key','ca.crt']:shutil.copy2(pki/name,source/name)
    (source/'app.env').write_text(f'PORT={port}\n')
    (source/'dnsmasq.conf').write_text('port=53\nlisten-address=172.30.253.20\nbind-interfaces\nno-hosts\nno-resolv\nlocal=/mayak.test/\naddress=/inventory.mayak.test/172.30.253.20\npid-file=/run/mayak-dns/dnsmasq.pid\nlog-facility=-\n')
    (source/'firewall.nft').write_text(f'''table inet mayak_infrastructure {{
 chain input {{
  type filter hook input priority 0; policy accept;
  iifname "lo" accept
  ip saddr 172.30.253.21 tcp dport {port} accept
  tcp dport {port} drop
 }}
}}
''')
    assets=[]
    for vmid in IPS:
        vm=owned(vmid)
        assets.append({'vmid':vmid,'role':{9200:'application and DNS',9201:'client and observation',9202:'separate data backup'}[vmid],
                       'address':IPS[vmid],'memoryMiB':int(vm['memory']),'cores':int(vm['cores']),
                       'kernel':remote(vmid,['uname','-r']).stdout.strip(),'virtualFirmware':vm.get('bios')})
    body=json.dumps({'schema':'mayak-inventory-v1','run':run_id,'variant':number,'assets':assets,'controlData':f'independent-data-variant-{number}'},indent=2).encode()+b'\n'
    (source/'inventory.json').write_bytes(body);digest=hashlib.sha256(body).hexdigest()
    (source/'probe.json').write_text(json.dumps({'url':f'https://inventory.mayak.test:{port}/inventory.json','sha256':digest}))
    variant.update(port=port,dataSha256=digest,assets=assets)
    for vmid in [9200,9201]:
        remote(vmid,['mkdir','-p',str(ROOT/'deploy')])
        for path in source.iterdir():
            if vmid==9201 and path.name not in ['apply-client.sh','probe.py','probe.json','ca.crt','mayak-probe.service','mayak-probe.timer']:continue
            put(vmid,path,str(ROOT/'deploy'/path.name))
    remote(9200,['bash','--noprofile','--norc',str(ROOT/'deploy/apply-server.sh')])
    remote(9200,['install','-m','0640','-o','root','-g','mayak-service',str(ROOT/'deploy/inventory.json'),DATA+'/inventory.json'])
    remote(9201,['bash','--noprofile','--norc',str(ROOT/'deploy/apply-client.sh')])
    result=wait_healthy();variant['initialProbe']=result
    before=remote(9200,['systemctl','show','mayak-inventory','-p','MainPID','--value']).stdout.strip()
    again=remote(9200,['bash','--noprofile','--norc',str(ROOT/'deploy/apply-server.sh')])
    assert 'configuration_changes=0' in again.stdout,again.stdout
    after=remote(9200,['systemctl','show','mayak-inventory','-p','MainPID','--value']).stdout.strip()
    assert before==after and int(after)>0
    variant['idempotentApply']=True
    probe()
    remote(9200,['systemctl','show','mayak-inventory','-p','User','-p','NoNewPrivileges','-p','ProtectSystem'])
    # Correct trust and name succeed; untrusted CA and wrong peer name must fail.
    variant['untrustedCaRefused']=not probe(False,['--cafile','/etc/ssl/certs/ca-certificates.crt'])['passed']
    variant['wrongTlsNameRefused']=not probe(False,['--url',f'https://172.30.253.20:{port}/inventory.json'])['passed']
    denied=remote(9202,['python3','-c',f"import socket; s=socket.socket();s.settimeout(2);s.connect(('172.30.253.20',{port}))"],None)
    assert denied.returncode not in (0,255),denied.stdout+denied.stderr
    variant['unauthorizedClientRefused']=True
    # Preserve configuration history without committing private keys.
    repo='/home/course/infrastructure'
    if number:
        put(9200,ROOT/'source-v0.bundle','/tmp/mayak-source-v0.bundle')
        remote(9200,['runuser','-u','course','--','git','clone','-b','main','/tmp/mayak-source-v0.bundle',repo])
    else:
        remote(9200,['install','-d','-o','course','-g','course',repo])
        remote(9200,['runuser','-u','course','--','git','init','-b','main',repo])
    public=[p.name for p in source.iterdir() if not p.name.endswith('.key')]
    for name in public:remote(9200,['install','-m','0644','-o','course','-g','course',str(ROOT/'deploy'/name),repo+'/'+name]) if name!='inventory.json' else remote(9200,['install','-m','0644','-o','course','-g','course',DATA+'/inventory.json',repo+'/'+name])
    remote(9200,['runuser','-u','course','--','git','-C',repo,'add','.'])
    remote(9200,['runuser','-u','course','--','git','-C',repo,'-c','user.name=Mayak learner','-c','user.email=mayak@example.invalid','commit','-m',f'Infrastructure variant {number}: port and inventory control data'])
    assert not remote(9200,['runuser','-u','course','--','git','-C',repo,'ls-files','*.key']).stdout.strip()
    variant['configurationCommit']=remote(9200,['runuser','-u','course','--','git','-C',repo,'rev-parse','HEAD']).stdout.strip()
    if not number:
        remote(9200,['runuser','-u','course','--','git','-C',repo,'bundle','create','/home/course/source-v0.bundle','--all'])
        host(['scp','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={KNOWN}','-i',KEY,'root@172.30.253.20:/home/course/source-v0.bundle',ROOT/'source-v0.bundle'])
    else:
        variant['configurationParent']=remote(9200,['runuser','-u','course','--','git','-C',repo,'rev-parse','HEAD^']).stdout.strip()
        assert variant['configurationParent']==record['variants'][0]['configurationCommit']
    return port

def backup_data(number):
    save('backup-'+str(number))
    backup=f'/srv/mayak-backups/{run_id}/data-{number}.tar'
    remote(9202,['install','-d','-m','0700',str(Path(backup).parent)])
    created=str(ROOT/f'data-{number}.tar')
    remote(9200,['tar','--numeric-owner','-cpf',created,'-C',DATA,'inventory.json'])
    export=ROOT/'exports'/run_id;export.mkdir(parents=True,exist_ok=True)
    local=export/f'data-{number}.tar'
    host(['scp','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={KNOWN}','-i',KEY,f'root@172.30.253.20:{created}',local])
    put(9202,local,backup)
    digest=hashlib.sha256(local.read_bytes()).hexdigest()
    assert remote(9202,['sha256sum',backup]).stdout.split()[0]==digest
    remote(9200,['rm','--',created])
    variant['dataBackup']={'storageVM':9202,'path':backup,'archiveSha256':digest,'exportPath':str(local)}
    save('await-external-'+str(number))
    ack=ROOT/f'external-{run_id}-{number}.json'
    deadline=time.monotonic()+600
    while not ack.exists():
        if time.monotonic()>deadline:raise RuntimeError('External backup roundtrip was not acknowledged')
        time.sleep(2)
    external=json.loads(ack.read_text());assert external['sha256']==digest
    returned=Path(external['returnedPath'])
    assert returned.parent==ROOT/'returned'/run_id and hashlib.sha256(returned.read_bytes()).hexdigest()==digest
    roundtrip=backup.replace('.tar','-external-roundtrip.tar')
    put(9202,returned,roundtrip)
    assert remote(9202,['sha256sum',roundtrip]).stdout.split()[0]==digest
    variant['externalBackup']=external;variant['restoreSource']=roundtrip
    save('faults-'+str(number))

def restore_data():
    start=time.monotonic()
    archive=variant['restoreSource'];local=ROOT/'restore-data.tar'
    host(['scp','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={KNOWN}','-i',KEY,f'root@172.30.253.22:{archive}',local])
    assert hashlib.sha256(local.read_bytes()).hexdigest()==variant['dataBackup']['archiveSha256']
    assert host(['tar','tf',local]).stdout.splitlines()==['inventory.json']
    put(9200,local,str(ROOT/'restore-data.tar'))
    remote(9200,['tar','--numeric-owner','-xpf',str(ROOT/'restore-data.tar'),'-C',DATA])
    result=probe();assert result['sha256']==variant['dataSha256']
    return round(time.monotonic()-start,3)

def faults(port):
    variant['faults']=[]
    def row(name):
        entry={'name':name};variant['faults'].append(entry);save(name);return entry
    entry=row('stopped-process')
    remote(9200,['systemctl','stop','mayak-inventory'])
    entry['refusal']=probe(False)
    remote(9201,['systemctl','start','mayak-probe'],expected=1)
    assert remote(9201,['systemctl','show','mayak-probe','-p','ExecMainStatus','--value']).stdout.strip()=='1'
    entry['monitorUnitObservedFailure']=True
    assert remote(9200,['systemctl','is-active','mayak-inventory'],None).stdout.strip()=='inactive'
    remote(9200,['systemctl','start','mayak-inventory']);entry['recovered']=wait_healthy()['passed']
    entry=row('network-filter')
    rules=f'''table inet mayak_fault {{
 chain input {{
  type filter hook input priority -5; policy accept;
  ip saddr 172.30.253.21 tcp dport {port} drop
 }}
}}
'''
    remote(9200,['python3','-c',f"import subprocess;subprocess.run(['nft','-c','-f','-'],input={rules!r},text=True,check=True);subprocess.run(['nft','-f','-'],input={rules!r},text=True,check=True)"])
    entry['refusal']=probe(False)
    assert remote(9200,['systemctl','is-active','mayak-inventory']).stdout.strip()=='active'
    direct=remote(9200,['curl','--fail','--silent','--show-error','--cacert','/etc/mayak-infrastructure/ca.crt','--resolve',f'inventory.mayak.test:{port}:127.0.0.1',f'https://inventory.mayak.test:{port}/inventory.json'])
    assert hashlib.sha256(direct.stdout.encode()).hexdigest()==variant['dataSha256']
    remote(9200,['nft','delete','table','inet','mayak_fault']);entry['recovered']=wait_healthy()['passed']
    entry=row('wrong-dns-record')
    code="from pathlib import Path;p=Path('/etc/mayak-infrastructure/dnsmasq.conf');p.write_text(p.read_text().replace('/172.30.253.20','/172.30.253.254'))"
    remote(9200,['python3','-c',code]);remote(9200,['systemctl','restart','mayak-dns'])
    entry['refusal']=probe(False)
    assert remote(9201,['python3','-c',"import socket;print(socket.gethostbyname('inventory.mayak.test'))"]).stdout.strip()=='172.30.253.254'
    code=code.replace("'/172.30.253.20','/172.30.253.254'","'/172.30.253.254','/172.30.253.20'")
    remote(9200,['python3','-c',code]);remote(9200,['systemctl','restart','mayak-dns']);entry['recovered']=wait_healthy()['passed']
    entry=row('data-permission')
    remote(9200,['chmod','000',DATA+'/inventory.json']);entry['refusal']=probe(False)
    assert remote(9200,['runuser','-u','mayak-service','--','test','-r',DATA+'/inventory.json'],None).returncode==1
    assert remote(9200,['sha256sum',DATA+'/inventory.json']).stdout.split()[0]==variant['dataSha256']
    remote(9200,['chmod','0640',DATA+'/inventory.json']);entry['recovered']=probe()['passed']
    entry=row('lost-data')
    # Only the owned synthetic file is removed; backup roundtrip is already verified.
    remote(9200,['rm','--',DATA+'/inventory.json']);entry['refusal']=probe(False)
    entry['restoreSeconds']=restore_data();entry['recovered']=True
    entry=row('corrupt-content-with-http-200')
    remote(9200,['python3','-c',f"from pathlib import Path;Path({(DATA+'/inventory.json')!r}).write_text('wrong accepted content')"])
    entry['refusal']=probe(False);assert entry['refusal']['status']==200
    entry['restoreSeconds']=restore_data();entry['recovered']=True
    remote(9201,['systemctl','reset-failed','mayak-probe'])
    remote(9201,['systemctl','start','mayak-probe']);remote(9201,['journalctl','-u','mayak-probe','-n','25','--no-pager'])
    assert all(fault['recovered'] and not fault['refusal']['passed'] for fault in variant['faults'])

def reboot_and_restore_vm(number):
    save('os-reboot-'+str(number))
    old_boot=guest(9200,'cat','/proc/sys/kernel/random/boot_id').strip()
    stop(9200);host(['qm','start',9200]);ready(9200)
    new_boot=guest(9200,'cat','/proc/sys/kernel/random/boot_id').strip();assert new_boot!=old_boot
    variant['bootPersistence']={'before':old_boot,'after':new_boot,'probe':wait_healthy()}
    variant['peerBootPersistence']={}
    for vmid in [9201,9202]:
        before=guest(vmid,'cat','/proc/sys/kernel/random/boot_id').strip()
        stop(vmid);host(['qm','start',vmid]);ready(vmid)
        after=guest(vmid,'cat','/proc/sys/kernel/random/boot_id').strip();assert before!=after
        variant['peerBootPersistence'][str(vmid)]={'before':before,'after':after}
    wait_healthy()
    save('whole-vm-backup-'+str(number))
    directory=ROOT/'integrated-vm-backups'/str(number);directory.mkdir(parents=True,exist_ok=True)
    host(['vzdump',9200,'--mode','stop','--compress','zstd','--dumpdir',directory],timeout=1200)
    archives=list(directory.glob('*.vma.zst'));assert len(archives)==1
    archive=archives[0]
    digest=hashlib.sha256()
    with archive.open('rb') as stream:
        for part in iter(lambda:stream.read(4*1024*1024),b''):digest.update(part)
    assert config(9203) is None,'Unexpected resource at restored VMID'
    stop(9200)
    start=time.monotonic()
    host(['qmrestore',archive,9203,'--storage','local-lvm'],timeout=1200)
    token=OWNER+f':restored-{run_id}-{number}'
    host(['qm','set',9203,'--description',token]);host(['qm','start',9203]);ready(9203)
    result=wait_healthy();assert result['sha256']==variant['dataSha256']
    restored_boot=guest(9203,'cat','/proc/sys/kernel/random/boot_id').strip()
    variant['wholeVmRestore']={'archive':str(archive),'archiveSha256':digest.hexdigest(),'sourceVM':9200,'restoredVM':9203,
                               'restoredBootId':restored_boot,'seconds':round(time.monotonic()-start,3),'probe':result}
    assert config(9203)['description']==token
    host(['qm','shutdown',9203,'--timeout','90']);assert config(9203)['description']==token
    host(['qm','destroy',9203,'--purge','1']);assert config(9203) is None
    host(['qm','start',9200]);ready(9200);wait_healthy()
    variant['temporaryRestoredVmRemoved']=True

def main():
    global variant
    save('starting');prepare_baseline()
    for number in [0,1]:
        variant={'variant':number,'status':'running'};record['variants'].append(variant);save('clean-start-'+str(number))
        clean_start();port=deploy(number);backup_data(number);faults(port);reboot_and_restore_vm(number)
        variant['finalProbe']=probe();variant['status']='passed';save('variant-passed-'+str(number))
        print('INTEGRATION',number,'passed',flush=True)
    record['status']='passed';save('complete')

if __name__=='__main__':
    try:main()
    except Exception as error:
        if variant is not None:variant.update(status='failed',error=str(error))
        record.update(status='failed',error=str(error),traceback=traceback.format_exc());save('failed');raise
