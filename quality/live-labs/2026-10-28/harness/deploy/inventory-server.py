#!/usr/bin/python3
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import ssl

handler = functools.partial(SimpleHTTPRequestHandler, directory='/srv/mayak-infrastructure/data')
server = ThreadingHTTPServer(('0.0.0.0', int(os.environ['PORT'])), handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('/etc/mayak-infrastructure/tls/server.crt', '/etc/mayak-infrastructure/tls/server.key')
server.socket = context.wrap_socket(server.socket, server_side=True)
print(f'Inventory service ready on TLS port {server.server_port}', flush=True)
server.serve_forever()
