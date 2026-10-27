#!/usr/bin/env python3
"""Isolated Proxmox backup exercise. Never modifies the source guest."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time

BASE = Path('/var/lib/mayak-backup-practice')


def run(*args, timeout=120, tolerate=False):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=timeout)
    if result.returncode and not tolerate:
        raise RuntimeError(f'{args[0]} failed: {result.stderr.strip()}')
    return result


def save(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    os.replace(temporary, path)


def config(vmid):
    result = run('qm', 'config', vmid, tolerate=True)
    if result.returncode:
        return None
    return dict(line.split(': ', 1) for line in result.stdout.splitlines() if ': ' in line)


def owned(vmid, token):
    c = config(vmid)
    if c and c.get('description') != token:
        raise ValueError(f'VM {vmid} is not owned by this exercise; refusing operation')
    return c


def guest(vmid, *command):
    result = run('qm', 'guest', 'exec', vmid, '--', *command)
    reply = json.loads(result.stdout)
    if reply.get('exitcode') != 0:
        raise RuntimeError('Guest command did not complete successfully: '+str(reply))
    return reply.get('out-data', '')


def ready(vmid):
    # An intentionally disconnected Debian clone can spend 120 seconds in
    # networkd-wait-online before basic boot services become available.
    deadline=time.monotonic()+180
    while time.monotonic()<deadline:
        try:
            if run('qm', 'agent', vmid, 'ping', timeout=min(5,max(.1,deadline-time.monotonic())), tolerate=True).returncode == 0:
                return
        except subprocess.TimeoutExpired:
            pass
        time.sleep(min(1,max(0,deadline-time.monotonic())))
    raise RuntimeError('Guest agent unavailable; inspect the isolated guest console')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare','status','check','restore'])
    parser.add_argument('--source-vmid', type=int)
    parser.add_argument('--storage')
    parser.add_argument('--attempt')
    parser.add_argument('--variant', type=int, choices=[0,1], default=0)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if getattr(os,'geteuid',lambda:-1)() != 0 or not Path('/etc/pve').is_dir():
        raise ValueError('Run as root on the authorized Proxmox lab host, not inside a guest')
    if BASE.is_symlink():
        raise ValueError('Symlink practice directory')
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    import fcntl
    lock = (BASE/'operation.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    state_path = BASE/'state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else None
    if args.action == 'status':
        print(json.dumps(state, ensure_ascii=False, indent=2))
        return 0
    if args.action == 'prepare':
        if state and state.get('active'):
            raise ValueError('Restore the previous exercise first')
        if not args.source_vmid or not args.storage or not config(args.source_vmid):
            raise ValueError('Choose --source-vmid of an expendable Linux guest with working QEMU agent, and --storage')
        attempt = args.attempt or secrets.token_hex(16)
        if len(attempt)!=32 or any(c not in '0123456789abcdef' for c in attempt):
            raise ValueError('Invalid attempt ID')
        token = 'mayak-backup-' + attempt
        vmid = int(run('pvesh','get','/cluster/nextid').stdout.strip().strip('"'))
        state = dict(attempt=attempt, variant=args.variant, started=time.time(), active=True,
                     source=args.source_vmid, clone=vmid, restored=None, token=token,
                     storage=args.storage, note='note-'+attempt)
        save(state_path,state)
        # Clone source only. Stop/remove are never called with source VMID.
        run('qm','clone',args.source_vmid,vmid,'--full','1','--storage',args.storage,timeout=600)
        run('qm','set',vmid,'--description',token)
        c = owned(vmid,token)
        # Detached NICs prevent duplicate addresses and writes to outside services.
        nics = [k for k in c if k.startswith('net') and k[3:].isdigit()]
        for nic in nics:
            run('qm','set',vmid,'--delete',nic)
        run('qm','set',vmid,'--agent','enabled=1')
        run('qm','start',vmid)
        ready(vmid)
        unit='[Unit]\nDescription=Mayak backup verification\n[Service]\nUser=nobody\nExecStart=/usr/bin/python3 -m http.server 18081 --bind 127.0.0.1 --directory /var/lib/mayak-backup-note\n[Install]\nWantedBy=multi-user.target\n'
        guest(vmid,'python3','-c',f'from pathlib import Path; p=Path("/var/lib/mayak-backup-note"); p.mkdir(exist_ok=True); p.chmod(0o755); (p/"index.html").write_text({state["note"]!r}); (p/"index.html").chmod(0o644); Path("/etc/systemd/system/mayak-backup.service").write_text({unit!r})')
        guest(vmid,'systemctl','daemon-reload')
        guest(vmid,'systemctl','enable','--now','mayak-backup.service')
        run('qm','shutdown',vmid,'--timeout','60',timeout=75)
        backup_dir = BASE/attempt
        backup_dir.mkdir(mode=0o700)
        state['backupDir']=str(backup_dir)
        state['restored']=int(run('pvesh','get','/cluster/nextid').stdout.strip().strip('"'))
        if state['restored'] in (state['source'],state['clone']):
            raise ValueError('VMID collision')
        save(state_path,state)
        print(json.dumps(state,ensure_ascii=False,indent=2))
        print('Learner steps on this host:')
        print(f'vzdump {vmid} --mode stop --compress zstd --dumpdir {backup_dir}')
        print(f'qmrestore <exact archive in {backup_dir}> {state["restored"]} --storage {state["storage"]}')
        print(f'qm set {state["restored"]} --description {token}')
        print(f'qm start {state["restored"]}')
        return 0
    if not state:
        raise ValueError('No exercise state')
    if not state['active']:
        if args.action=='restore': return 0
        raise ValueError('Exercise restored; prepare a new one')
    if args.action=='check':
        if not state['restored']:
            raise ValueError('Preparation incomplete')
        c = owned(state['restored'],state['token'])
        if not c or any(k.startswith('net') and k[3:].isdigit() for k in c):
            raise ValueError('Restored guest must exist and have no network adapters')
        if state['restored'] in (state['source'],state['clone']):
            raise ValueError('Not an independent restored VMID')
        ready(state['restored'])
        probe='''import urllib.request,time,sys
for attempt in range(30):
 try:
  print(urllib.request.urlopen("http://127.0.0.1:18081/",timeout=1).read().decode(),end="")
  sys.exit(0)
 except OSError:
  time.sleep(.2)
sys.exit(1)
'''
        note=guest(state['restored'],'python3','-c',probe)
        passed=note==state['note']
        report=dict(schema='mayak-practice-report-v1',lesson='vm-backup',attempt=state['attempt'],
                    variant=state['variant'],started=state['started'],checked=time.time(),
                    runnerSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    catalogSha256='native-proxmox-backup-v1',
                    guest=hashlib.sha256(str(state['restored']).encode()).hexdigest(),
                    environment=dict(kernel=os.uname().release,host=os.uname().nodename),
                    passed=passed,observations=f'Restored VMID {state["restored"]}; guest note matches: {passed}',error='')
        payload=json.dumps(report,ensure_ascii=False,sort_keys=True,separators=(',',':'))
        envelope=dict(schema='mayak-practice-envelope-v1',payload=payload,sha256=hashlib.sha256(payload.encode()).hexdigest())
        target=args.output or BASE/f'report-{state["attempt"]}-{time.time_ns()}.json'
        with target.open('x') as f: json.dump(envelope,f,ensure_ascii=False,indent=2)
        print('PASS' if passed else 'FAIL',target)
        return 0 if passed else 1
    if args.action=='restore':
        for vmid in [state['restored'],state['clone']]:
            if not vmid: continue
            if vmid==state['source']: raise ValueError('Source destruction forbidden')
            if owned(vmid,state['token']):
                run('qm','stop',vmid,timeout=90)
                run('qm','destroy',vmid,'--purge','1',timeout=180)
        state['active']=False
        state['restoredAt']=time.time()
        save(state_path,state)
        print('Owned guests removed; source and backup archives retained.')
        return 0


if __name__=='__main__':
    try: sys.exit(main())
    except (ValueError,OSError,RuntimeError,subprocess.TimeoutExpired) as error:
        print(f'backup-practice: {error}',file=sys.stderr)
        sys.exit(2)
