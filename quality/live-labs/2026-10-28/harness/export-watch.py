import hashlib
import json
from pathlib import Path
import time
from remote import connect

root=Path(__file__).resolve().parent
done=set()
deadline=time.monotonic()+7200
while time.monotonic()<deadline:
    client=connect()
    try:
        with client.open_sftp() as sftp:
            try:
                with sftp.open('/root/mayak-acceptance-20261028/integration-current.json') as f:state=json.load(f)
            except FileNotFoundError:
                time.sleep(2);continue
            if state.get('status')=='failed':raise RuntimeError(state.get('error'))
            if state.get('stage','').startswith('await-external-'):
                variant=state['variants'][-1];number=variant['variant'];key=(state['run'],number)
                if key not in done:
                    folder=root/'external-backups'/state['run'];folder.mkdir(parents=True,exist_ok=True)
                    local=folder/f'data-{number}.tar'
                    sftp.get(variant['dataBackup']['exportPath'],str(local))
                    digest=hashlib.sha256(local.read_bytes()).hexdigest()
                    assert digest==variant['dataBackup']['archiveSha256']
                    remote=f'/root/mayak-acceptance-20261028/returned/{state["run"]}'
                    _,out,err=client.exec_command('mkdir -p '+remote)
                    assert out.channel.recv_exit_status()==0
                    returned=remote+f'/data-{number}.tar';sftp.put(str(local),returned)
                    ack={'run':state['run'],'variant':number,'sha256':digest,'bytes':local.stat().st_size,'externalHost':'Windows operator computer',
                         'localFile':str(local),'returnedPath':returned,'method':'SFTP download, local SHA-256 check, SFTP upload; no archive synthesis'}
                    with sftp.open(f'/root/mayak-acceptance-20261028/external-{state["run"]}-{number}.json','w') as f:f.write(json.dumps(ack))
                    (folder/f'data-{number}-roundtrip.json').write_text(json.dumps(ack,indent=2))
                    done.add(key);print('External backup roundtrip',number,digest,flush=True)
            if state.get('status')=='passed':print('Integrated run complete; external backups verified:',len(done),flush=True);break
    finally:client.close()
    time.sleep(2)
else:raise TimeoutError('Integrated run did not finish')
