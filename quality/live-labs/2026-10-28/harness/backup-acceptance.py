import json,subprocess,time,hashlib
from pathlib import Path
root=Path('/root/mayak-acceptance-20261028');runner=root/'proxmox-backup.py'
plans=json.load(open(root/'attempts.json'))['vm-backup'];results=[]
def call(args,expected=True,timeout=900):
 start=time.time();r=subprocess.run([str(x) for x in args],capture_output=True,text=True,timeout=timeout);row={'command':[str(x) for x in args],'code':r.returncode,'seconds':round(time.time()-start,2),'stdout':r.stdout,'stderr':r.stderr};phases.append(row)
 (root/'backup-acceptance.json').write_text(json.dumps({'runnerSha256':hashlib.sha256(runner.read_bytes()).hexdigest(),'sourceVM':9101,'results':results},ensure_ascii=False,indent=2))
 if (r.returncode==0)!=expected:raise RuntimeError(str(row))
 return r
subprocess.run(['qm','shutdown','9101','--timeout','60'],check=True)
for variant,plan in enumerate(plans):
 phases=[];row={'lesson':'vm-backup','variant':variant,'attempt':plan['attempt'],'phases':phases};results.append(row)
 try:
  call(['python3',runner,'prepare','--source-vmid','9101','--storage','local-lvm','--attempt',plan['attempt'],'--variant',variant])
  s=json.load(open('/var/lib/mayak-backup-practice/state.json'));row['state']=s
  call(['python3',runner,'check'],expected=False)
  call(['vzdump',s['clone'],'--mode','stop','--compress','zstd','--dumpdir',s['backupDir']])
  archives=list(Path(s['backupDir']).glob('*.vma.zst'));assert len(archives)==1
  row['archiveSha256']=hashlib.sha256(archives[0].read_bytes()).hexdigest()
  call(['qmrestore',archives[0],s['restored'],'--storage',s['storage']])
  call(['qm','set',s['restored'],'--description',s['token']]);call(['qm','start',s['restored']])
  call(['python3',runner,'check','--output',root/f'vm-backup-{variant}.json'])
  call(['python3',runner,'restore']);call(['python3',runner,'restore']);row['status']='passed'
 except Exception as e:
  row['status']='failed';row['error']=str(e)
  try:call(['python3',runner,'restore'])
  except Exception as e:row['cleanupError']=str(e)
 (root/'backup-acceptance.json').write_text(json.dumps({'runnerSha256':hashlib.sha256(runner.read_bytes()).hexdigest(),'sourceVM':9101,'results':results},ensure_ascii=False,indent=2));print('BACKUP',variant,row['status'],row.get('error','')[:500],flush=True)
