"""Actual runner lifecycle in a temporary enrolled fixture, never enrolling the host."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pwd
import sys
import tempfile

spec=importlib.util.spec_from_file_location('runner',Path(__file__).with_name('runner.py'))
r=importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

def main():
    user=sys.argv[1]
    account=pwd.getpwnam(user)
    assert account.pw_uid != 0 and os.geteuid()==0
    with tempfile.TemporaryDirectory(prefix='mayak-cli-test-') as directory:
        root=Path(directory)
        root.chmod(0o755)
        r.BASE=root/'base'
        r.MARKER=root/'guest-marker'
        reports=root/'reports';reports.mkdir();os.chown(reports,account.pw_uid,account.pw_gid)
        count=0
        def call(*args):
            nonlocal count
            sys.argv=['runner.py',*args]
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):code=r.main()
            count+=1
            return code
        def refuse(*args):
            nonlocal count
            try:call(*args)
            except ValueError:count+=1;return
            raise AssertionError(('must refuse',args))
        refuse('enroll')
        call('enroll','--disposable-guest')
        for variant in [0,1]:
            call('prepare','python-result','--user',user,'--variant',str(variant))
            refuse('prepare','python-result','--user',user)
            failed=reports/f'failed{variant}.json'
            assert call('check','python-result','--user',user,'--output',str(failed))!=0
            assert not json.loads(json.loads(failed.read_text())['payload'])['passed']
            call('solve','python-result','--user',user)
            success=reports/f'success{variant}.json'
            assert call('check','python-result','--user',user,'--output',str(success))==0
            assert json.loads(json.loads(success.read_text())['payload'])['passed']
            (r.BASE/'python-result/work/solution.py').write_text('print("{}")')
            stale=reports/f'changed{variant}.json'
            assert call('check','python-result','--user',user,'--output',str(stale))!=0
            assert not json.loads(json.loads(stale.read_text())['payload'])['passed']
            call('restore','python-result','--user',user)
            call('restore','python-result','--user',user)
        call('prepare','permissions','--user',user)
        work=r.BASE/'permissions/work'
        (work/'evil').symlink_to(root/'outside')
        refuse('solve','permissions','--user',user)
        (work/'evil').unlink()
        call('restore','permissions','--user',user)
        state=dict(attempt='a'*32,user=user,variant=0)
        limited=r.execute("python3 -c 'print(\"x\"*2000000)'",r.BASE/'permissions',state)
        assert limited.returncode==125 and len(limited.stdout)<=1024*1024 and 'OUTPUT LIMIT' in limited.stderr
        count+=1
        import subprocess
        try:r.execute('sleep 30',r.BASE/'permissions',state,timeout=.1)
        except subprocess.TimeoutExpired:count+=1
        else:raise AssertionError('Timeout not enforced')
    print(f'Runner CLI: {count} lifecycle/refusal operations passed; changed solution invalidated on recheck.')

if __name__=='__main__':main()
