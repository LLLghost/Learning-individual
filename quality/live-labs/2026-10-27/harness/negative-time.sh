python3 - <<'PY'
import subprocess,json
from pathlib import Path
for v in [0,1]:
 p=Path('/home/course/legacy-acceptance/L31A')/str(v)
 drift=float(Path('/var/lib/chrony/chrony.drift').read_text().split()[0])
 (p/'answer.json').write_text(json.dumps({'drift_ppm':drift+123}))
 subprocess.run(['python3','/usr/local/lib/mayak-course-lab.py','collect','L31A',str(p)],check=True)
 (p/'negative.json').write_bytes((p/'lab-report.json').read_bytes())
PY
