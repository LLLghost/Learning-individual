"""Actual Linux recipe checks in temporary directories; not Proxmox acceptance."""
import argparse
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import tempfile
import time

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('runner.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

SAFE_LOCAL = ['permissions', 'process', 'memory', 'packages', 'shell-data',
              'shell-failure', 'python-result', 'git-change', 'boot',
              'disk-identity', 'disk-health', 'vm-resources', 'device-id',
              'latency', 'tls', 'time', 'baseline']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--user', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--all', action='store_true', help='Exercise available isolated namespaces, mounts and temporary units too')
    args = parser.parse_args()
    catalog = runner.load_catalog()
    fingerprint={p.name:hashlib.sha256(p.read_text().replace('\r\n','\n').encode()).hexdigest()
                 for p in [Path(__file__).with_name('runner.py'),Path(__file__).with_name('catalog.json')]}
    syntax = []
    for name, lab in catalog['labs'].items():
        for action in ['prepare', 'solve', 'check', 'restore']:
            result = subprocess.run(['bash', '-n'], input=lab[action], text=True, capture_output=True)
            assert result.returncode == 0, (name, action, result.stderr)
            syntax.append(f'{name}/{action}')
    assert os.geteuid() == 0, 'The fixture harness needs root to exercise runuser; it never enrolls WSL.'
    account = pwd.getpwnam(args.user)
    results = []
    with tempfile.TemporaryDirectory(prefix='mayak-practice-test-') as temporary:
        os.chmod(temporary, 0o755)
        for name in (list(catalog['labs']) if args.all else SAFE_LOCAL):
            lab = catalog['labs'][name]
            missing = [c for c in lab['requires'] if not shutil.which(c)]
            if missing:
                results.append(dict(lesson=name, status='unavailable', reason=missing))
                continue
            if name=='cpu-numa' and len(list(Path('/sys/devices/system/node').glob('node[0-9]*')))<2:
                results.append(dict(lesson=name,status='unavailable',reason='fewer than two NUMA nodes'))
                continue
            if name=='uefi' and not Path('/sys/firmware/efi').is_dir():
                results.append(dict(lesson=name,status='unavailable',reason='not booted with UEFI'))
                continue
            if name=='multipath' and 'multipath' not in subprocess.run(['dmsetup','targets'],capture_output=True,text=True).stdout:
                results.append(dict(lesson=name,status='unavailable',reason='kernel has no DM multipath target'))
                continue
            if name.startswith('container') and subprocess.run(['docker','info'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
                results.append(dict(lesson=name,status='unavailable',reason='Docker daemon unavailable; not started by tests'))
                continue
            path = Path(temporary) / name
            path.mkdir()
            state = dict(attempt=os.urandom(16).hex(), variant=0, user=args.user)
            def call(action):
                r = runner.execute(lab[action], path, state, lab.get('timeout', 120))
                return dict(action=action, code=r.returncode, stdout=r.stdout, stderr=r.stderr)
            phases = []
            try:
                for variant in [0, 1]:
                    state['variant'] = variant
                    state['port'] = 28100+2*list(catalog['labs']).index(name)+variant
                    state['attempt'] = os.urandom(16).hex()
                    (path / 'work').mkdir(exist_ok=True)
                    os.chown(path / 'work', account.pw_uid, account.pw_gid)
                    result = call('prepare'); phases.append(result)
                    assert result['code'] == 0, result
                    result = call('check'); phases.append(result)
                    assert result['code'] != 0, ('empty solution accepted', name)
                    result = call('solve'); phases.append(result)
                    assert result['code'] == 0, result
                    result = call('check'); phases.append(result)
                    assert result['code'] == 0, result
                    result = call('restore'); phases.append(result)
                    assert result['code'] == 0, result
                    assert not list((path / 'work').iterdir())
                    result = call('restore'); phases.append(result)
                    assert result['code'] == 0, ('restore not idempotent', result)
                results.append(dict(lesson=name, status='passed', phases=phases))
            except Exception as error:
                results.append(dict(lesson=name, status='failed', error=str(error), phases=phases))
            finally:
                call('restore')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    assert all(fingerprint[p.name]==hashlib.sha256(p.read_text().replace('\r\n','\n').encode()).hexdigest()
               for p in [Path(__file__).with_name('runner.py'),Path(__file__).with_name('catalog.json')]),'Source changed during fixture run'
    args.output.write_text(json.dumps(dict(environment='WSL Linux fixtures, not a clean Proxmox VM',
                                           at=time.time(), sourceHashNormalization='LF',sourceHashes=fingerprint,syntax=len(syntax), results=results),
                                     ensure_ascii=False, indent=2))
    for result in results:
        print(result['lesson'], result['status'], result.get('error', result.get('reason', '')))
    print(f'Shell syntax: {len(syntax)} scripts; actual two-variant recipes: {sum(r["status"]=="passed" for r in results)}')
    return int(any(r['status'] == 'failed' for r in results))


if __name__ == '__main__':
    raise SystemExit(main())
