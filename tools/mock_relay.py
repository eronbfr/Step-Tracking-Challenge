"""Tiny ntfy-compatible relay for local development (in-memory, any topic).

Supports what the app and backend/fold.mjs use: POST /<topic>, GET /<topic>/publish?message=…,
GET /<topic>/json?poll=1&since=…, GET /<topic>/sse?since=… — with CORS like ntfy.sh.

    python tools/mock_relay.py 8766
    app:    http://localhost:8765/?relay=http://localhost:8766
    Action: node backend/fold.mjs --relay http://localhost:8766
"""
import http.server
import json
import secrets
import sys
import threading
import time
from urllib.parse import parse_qs, urlparse

MESSAGES = []
CHANGED = threading.Condition()


def publish(topic, text):
    msg = {'id': secrets.token_urlsafe(9)[:12], 'time': int(time.time()), 'expires': int(time.time()) + 43200,
           'event': 'message', 'topic': topic, 'message': text}
    with CHANGED:
        MESSAGES.append(msg)
        CHANGED.notify_all()
    return msg


def since_filter(topic, since):
    msgs = [m for m in MESSAGES if m['topic'] == topic]
    if not since or since == 'all':
        return msgs
    if since.isdigit():
        return [m for m in msgs if m['time'] >= int(since)]
    ids = [m['id'] for m in msgs]
    return msgs[ids.index(since) + 1:] if since in ids else msgs


class Relay(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        sys.stderr.write('relay: ' + fmt % args + '\n')

    def reply(self, code, body, ctype='application/json'):
        data = body.encode()
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        topic = urlparse(self.path).path.strip('/')
        text = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode('utf-8')
        self.reply(200, json.dumps(publish(topic, text)))

    do_PUT = do_POST

    def do_GET(self):
        url = urlparse(self.path)
        parts = url.path.strip('/').split('/')
        q = {k: v[-1] for k, v in parse_qs(url.query).items()}
        if len(parts) != 2:
            return self.reply(404, '{"error":"not found"}')
        topic, kind = parts
        if kind in ('publish', 'send', 'trigger'):
            return self.reply(200, json.dumps(publish(topic, q.get('message') or q.get('m') or 'triggered')))
        if kind == 'json':
            body = ''.join(json.dumps(m) + '\n' for m in since_filter(topic, q.get('since')))
            return self.reply(200, body, 'application/x-ndjson')
        if kind == 'sse':
            return self.stream(topic, q.get('since'))
        return self.reply(404, '{"error":"not found"}')

    def stream(self, topic, since):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        sent = 0
        try:
            self.wfile.write(f'event: open\ndata: {json.dumps({"event": "open", "topic": topic})}\n\n'.encode())
            backlog = since_filter(topic, since) if since else []
            for m in backlog:
                self.wfile.write(f'data: {json.dumps(m)}\n\n'.encode())
            sent = len(MESSAGES)
            self.wfile.flush()
            while True:
                with CHANGED:
                    CHANGED.wait(timeout=25)
                    new = MESSAGES[sent:]
                    sent = len(MESSAGES)
                for m in new:
                    if m['topic'] == topic:
                        self.wfile.write(f'data: {json.dumps(m)}\n\n'.encode())
                if not new:
                    self.wfile.write(f'event: keepalive\ndata: {json.dumps({"event": "keepalive"})}\n\n'.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print(f'Mock relay on http://localhost:{port}')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Relay).serve_forever()
