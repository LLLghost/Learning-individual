import json,subprocess,time,secrets,hashlib,os
from pathlib import Path
ROOT=Path('/root/mayak-acceptance');ROOT.mkdir(exist_ok=True)
runner=ROOT/'course-practice.py'
catalog=json.load(open(ROOT/'catalog.json'))
results=[]
plans=json.load(open(ROOT/'attempts.json'))
def save():
 (ROOT/'acceptance.json').write_text(json.dumps({'environment':'dedicated Proxmox VM 9100, Debian 12, OVMF, two virtual NUMA nodes','at':time.time(),'runnerSha256':hashlib.sha256(runner.read_bytes()).hexdigest(),'results':results},ensure_ascii=False,indent=2))
def call(action,name,extra=[]):
 start=time.time();p=subprocess.run(['python3',str(runner),action,name,'--user','course',*extra],capture_output=True,text=True,timeout=420)
 return dict(action=action,code=p.returncode,seconds=round(time.time()-start,2),stdout=p.stdout,stderr=p.stderr)
subprocess.run(['python3',str(runner),'enroll','--disposable-guest'],check=True)
for name,lab in catalog['labs'].items():
 print('START',name,flush=True)
 row={'lesson':name,'status':'running','variants':[]};results.append(row);save()
 try:
  for variant in [0,1]:
   attempt=plans[name][variant]['attempt']; phases=[];v={'variant':variant,'attempt':attempt,'phases':phases};row['variants'].append(v)
   for action,extra,expected in [('prepare',['--attempt',attempt,'--variant',str(variant)],True),('check',['--output',f'/home/course/{name}-{variant}-negative.json'],False),('solve',[],True),('check',['--output',f'/home/course/{name}-{variant}.json'],True),('restore',[],True),('restore',[],True)]:
    if action=='restore' and len(phases)==4 and name in ['process','systemd','container-network']:
     st=json.load(open('/var/lib/mayak-practice/'+name+'/state.json'));ns='mk'+st['attempt'][:10]
     if name=='process': mutation=['runuser','-u','course','--','kill',Path('/var/lib/mayak-practice/process/work/pid.txt').read_text().strip()]
     elif name=='systemd': mutation=['systemctl','stop',ns+'.service']
     else: mutation=['docker','stop',ns]
     m=subprocess.run(mutation,capture_output=True,text=True,timeout=30);assert m.returncode==0,m.stderr
     v['mutation']=dict(command=mutation,code=m.returncode)
     failed=call('check',name,['--output',f'/home/course/{name}-{variant}-after-change.json']);v['checkAfterChange']=failed
     assert failed['code']!=0,'Changed system incorrectly accepted'
    r=call(action,name,extra);phases.append(r);save()
    if (r['code']==0)!=expected:raise RuntimeError(f'{action} expected success={expected}: {r}')
   state=json.load(open('/var/lib/mayak-practice/'+name+'/state.json'));assert not state['active']
   assert not list(Path('/var/lib/mayak-practice',name,'work').iterdir())
   v['passed']=True
  row['status']='passed'
 except Exception as e:
  row['status']='failed';row['error']=str(e)
  try:row['cleanup']=call('restore',name)
  except Exception as cleanup:row['cleanupError']=str(cleanup)
 save();print(name,row['status'],row.get('error','')[:400],flush=True)
print('TOTAL',sum(x['status']=='passed' for x in results),'/',len(results),flush=True)
