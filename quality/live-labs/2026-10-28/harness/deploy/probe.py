#!/usr/bin/python3
import argparse
import hashlib
import json
from pathlib import Path
import socket
import ssl
import sys
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--url')
parser.add_argument('--cafile')
args = parser.parse_args()
config = json.loads(Path('/etc/mayak-probe.json').read_text())
url = args.url or config['url']
start = time.monotonic()
result = {'url': url, 'client': socket.gethostname(), 'expectedSha256': config['sha256']}
try:
    context = ssl.create_default_context(cafile=args.cafile or '/etc/mayak-infrastructure-ca.crt')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))
    with opener.open(url, timeout=3) as response:
        data = response.read()
        result.update(status=response.status, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
        result['passed'] = response.status == 200 and result['sha256'] == config['sha256']
        if not result['passed']:
            result['error'] = 'Response content differs from the accepted data'
except Exception as error:
    result.update(passed=False, error=str(error))
result['seconds'] = round(time.monotonic() - start, 4)
print(json.dumps(result, sort_keys=True), flush=True)
sys.exit(0 if result['passed'] else 1)
