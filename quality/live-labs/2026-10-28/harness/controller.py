import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time

ROOT = Path('/root/mayak-acceptance-20261028')
OWNER = 'mayak-infrastructure-20261028'
KEY = '/root/mayak-acceptance-key'
KNOWN = ROOT / 'guest-known-hosts'
events = []

def run(args, *, timeout=900, tolerate=False, input=None):
    args = [str(value) for value in args]
    start = time.monotonic()
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=timeout)
    events.append(dict(command=args, code=result.returncode, seconds=round(time.monotonic()-start, 3), stdout=result.stdout, stderr=result.stderr))
    ROOT.mkdir(exist_ok=True)
    (ROOT/('controller-'+(sys.argv[1] if len(sys.argv)>1 else 'integration')+'-events.json')).write_text(json.dumps(events, ensure_ascii=False, indent=2))
    if result.returncode and not tolerate:
        raise RuntimeError(str(events[-1]))
    return result

def config(vmid):
    result = run(['qm','config',vmid], tolerate=True)
    if result.returncode:
        return None
    values = dict(line.split(': ',1) for line in result.stdout.splitlines() if ': ' in line)
    if 'description' in values:
        from urllib.parse import unquote
        values['description'] = unquote(values['description'])
    return values

def guest(vmid, *args):
    result = run(['qm','guest','exec',vmid,'--',*args], timeout=90)
    reply = json.loads(result.stdout)
    if reply.get('exitcode') != 0 or reply.get('out-truncated'):
        raise RuntimeError(str(reply))
    return reply.get('out-data','')

def ssh(ip, *args, timeout=900):
    return run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={KNOWN}',
                '-i',KEY,f'root@{ip}',shlex.join([str(a) for a in args])], timeout=timeout)

def put_guest(ip, source, target):
    return run(['scp','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={KNOWN}',
                '-i',KEY,source,f'root@{ip}:{target}'])

def ready(vmid):
    deadline = time.monotonic()+240
    while time.monotonic()<deadline:
        try:
            result = run(['qm','agent',vmid,'ping'],timeout=8,tolerate=True)
        except subprocess.TimeoutExpired:
            continue
        if not result.returncode:
            return
        time.sleep(3)
    raise RuntimeError(f'Guest agent not ready: {vmid}')

def network(vmid, ip):
    vm = config(vmid)
    assert OWNER in vm.get('description','')
    mac = vm['net0'].split(',')[0].split('=')[1].lower()
    public_key = Path(KEY+'.pub').read_text().strip()
    program = f'''import json,subprocess,socket
from pathlib import Path
import uuid
identity=Path('/var/lib/mayak-infrastructure-identity')
if not identity.exists():
 machine=uuid.uuid4().hex+'\\n'
 Path('/etc/machine-id').write_text(machine)
 dbus=Path('/var/lib/dbus/machine-id')
 if dbus.exists() and not dbus.is_symlink():dbus.write_text(machine)
 for key in Path('/etc/ssh').glob('ssh_host_*_key*'):key.unlink()
 subprocess.run(['ssh-keygen','-A'],check=True,capture_output=True)
 Path('/etc/cloud/cloud-init.disabled').touch()
 marker=Path('/etc/mayak-practice-guest')
 if marker.exists():marker.unlink()
 identity.write_text('{OWNER}:{vmid}\\n')
ssh=Path('/root/.ssh');ssh.mkdir(mode=0o700,exist_ok=True)
authorized=ssh/'authorized_keys';keys=authorized.read_text() if authorized.exists() else ''
if {public_key!r} not in keys:authorized.write_text(keys+'\\n'+{public_key!r}+'\\n')
authorized.chmod(0o600)
subprocess.run(['systemctl','restart','ssh'],check=True)
links=json.loads(subprocess.check_output(['ip','-j','link']))
iface=next(link['ifname'] for link in links if link.get('address','').lower()=={mac!r})
Path('/etc/systemd/network/00-mayak-infrastructure.network').write_text('[Match]\\nMACAddress={mac}\\n[Network]\\nAddress={ip}/24\\nGateway=172.30.253.1\\nDNS=10.30.11.199\\n')
subprocess.run(['networkctl','reload'],check=True)
subprocess.run(['ip','address','flush','dev',iface,'scope','global'],check=True)
subprocess.run(['ip','address','add','{ip}/24','dev',iface],check=True)
subprocess.run(['ip','route','replace','default','via','172.30.253.1','dev',iface],check=True)
Path('/etc/hostname').write_text('mayak-{vmid}\\n')
hosts=Path('/etc/hosts')
text='\\n'.join(row for row in hosts.read_text().splitlines() if not row.startswith('127.0.1.1'))
hosts.write_text(text+'\\n127.0.1.1 mayak-{vmid}\\n')
subprocess.run(['hostname','mayak-{vmid}'],check=True)
print(json.dumps({{'interface':iface,'ip':{ip!r},'hostname':socket.gethostname()}}))
'''
    print(guest(vmid,'python3','-c',program),flush=True)
    key = guest(vmid,'cat','/etc/ssh/ssh_host_ed25519_key.pub').strip().split()[:2]
    line = ip+' '+' '.join(key)+'\n'
    existing = KNOWN.read_text() if KNOWN.exists() else ''
    KNOWN.write_text(''.join(row+'\n' for row in existing.splitlines() if not row.startswith(ip+' '))+line)
    return ssh(ip,'hostname').stdout.strip()

def clone(source, vmid, snapshot, ip, memory=None):
    vm = config(vmid)
    if vm is None:
        run(['qm','clone',source,vmid,'--snapname',snapshot,'--full','1','--storage','local-lvm','--name',f'mayak-infra-{vmid}'])
        run(['qm','set',vmid,'--description',OWNER,'--ipconfig0',f'ip={ip}/24,gw=172.30.253.1'])
        if memory:
            run(['qm','set',vmid,'--memory',memory,'--cores','1'])
    else:
        assert OWNER in vm.get('description',''), f'VM {vmid} is owned by another task'
    if 'stopped' in run(['qm','status',vmid]).stdout:
        run(['qm','start',vmid])
    ready(vmid)
    network(vmid,ip)
    (ROOT/f'vm-{vmid}.txt').write_text(run(['qm','config',vmid]).stdout)

def main():
    action = sys.argv[1]
    if action == 'server':
        source = config(9100)
        assert source and 'mayak acceptance disposable guest' in source.get('description','')
        if 'running' in run(['qm','status',9100]).stdout:
            inspection = guest(9100,'bash','-lc','hostname; uname -r; ip -br a; ip netns list; findmnt -rn -o TARGET | grep mayak || true')
            (ROOT/'source-before.txt').write_text(inspection)
            run(['qm','shutdown',9100,'--timeout','90'])
        assert 'stopped' in run(['qm','status',9100]).stdout
        snapshots = run(['qm','listsnapshot',9100]).stdout
        if 'mayak-before-20261028' not in snapshots:
            run(['qm','snapshot',9100,'mayak-before-20261028','--description','Preserve original state before fresh infrastructure acceptance'])
        clone(9100,9200,'mayak-clean-dependencies','172.30.253.20')
        ip = '172.30.253.20'
        ssh(ip,'mkdir','-p',str(ROOT),'/home/course/mayak-20261028')
        ssh(ip,'chown','course:course','/home/course/mayak-20261028')
        for name in ['course-practice.py','catalog.json','course_lab.py','attempts.json','acceptance.py','legacy-acceptance.py','run-meta.json']:
            put_guest(ip,ROOT/name,str(ROOT/name))
        print('SERVER_READY 9200 172.30.253.20',flush=True)
    elif action == 'peers':
        assert 'stopped' in run(['qm','status',9101]).stdout
        clone(9101,9201,'mayak-backup-clean','172.30.253.21',1024)
        clone(9101,9202,'mayak-backup-clean','172.30.253.22',1024)
        print('PEERS_READY 9201 9202',flush=True)
    elif action == 'exec':
        result=ssh(sys.argv[2],*sys.argv[3:]);print(result.stdout,end='');print(result.stderr,end='',file=sys.stderr)
    else:
        raise ValueError(action)

if __name__=='__main__':
    main()
