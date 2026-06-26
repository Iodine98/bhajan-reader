#!/usr/bin/env python3
"""
Hot-reload dev server for bhajan-reader.

Uses Server-Sent Events (SSE) — pure Python stdlib, no dependencies.

- Serves static files from the project root
- Watches all files for changes (polls every 500 ms)
- Injects a <script> into HTML responses that reloads the browser on change
- GET /livereload  — SSE endpoint (kept alive per connected browser tab)
"""

import http.server
import io
import os
import threading
import time
import mimetypes
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path

try:
    # speech_recognition is an optional dependency — the server functions without
    # it; Firefox users simply cannot use server-side transcription.  Install with:
    #   uv add SpeechRecognition
    import speech_recognition as _sr
    _SR_AVAILABLE = True
except ImportError:
    _sr = None
    _SR_AVAILABLE = False

PORT = 8080
ROOT = Path(__file__).parent.parent / 'frontend'

RELOAD_SCRIPT = b"""
<script>
(function() {
  var es = new EventSource('/livereload');
  es.onmessage = function() { location.reload(); };
  es.onerror   = function() { setTimeout(function(){ location.reload(); }, 1000); };
})();
</script>
"""

# ── File watcher ──────────────────────────────────────────────────────────────

class FileWatcher:
    """Polls file mtimes and notifies listeners when anything changes."""

    EXTENSIONS = {'.html', '.css', '.js', '.bhajan'}

    def __init__(self, root: Path, interval: float = 0.5):
        self.root = root
        self.interval = interval
        self._mtimes: dict[str, float] = {}
        self._lock = threading.Lock()
        self._clients: list = []   # list of threading.Event objects
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._snapshot()   # baseline — don't fire on startup
        self._thread.start()

    def subscribe(self) -> threading.Event:
        """Return an Event that gets set whenever a file changes."""
        ev = threading.Event()
        with self._lock:
            self._clients.append(ev)
        return ev

    def unsubscribe(self, ev: threading.Event):
        with self._lock:
            try:
                self._clients.remove(ev)
            except ValueError:
                pass

    def _snapshot(self) -> dict[str, float]:
        mtimes = {}
        for dirpath, _, filenames in os.walk(self.root):
            # Skip hidden dirs like .git
            if any(part.startswith('.') for part in Path(dirpath).parts):
                continue
            for fname in filenames:
                if Path(fname).suffix in self.EXTENSIONS:
                    path = os.path.join(dirpath, fname)
                    try:
                        mtimes[path] = os.stat(path).st_mtime
                    except OSError:
                        pass
        return mtimes

    def _run(self):
        while True:
            time.sleep(self.interval)
            new = self._snapshot()
            changed = (
                set(new) != set(self._mtimes) or
                any(new[k] != self._mtimes.get(k) for k in new)
            )
            self._mtimes = new
            if changed:
                with self._lock:
                    for ev in self._clients:
                        ev.set()


# ── HTTP request handler ──────────────────────────────────────────────────────

watcher = FileWatcher(ROOT)

class HotReloadHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # Suppress /livereload polling noise, show everything else
        if '/livereload' not in (args[0] if args else ''):
            print(f"  {self.address_string()} — {fmt % args}")

    def do_GET(self):
        if self.path == '/livereload' or self.path.startswith('/livereload?'):
            self._handle_sse()
        elif self.path == '/api/transcribe-check':
            self._handle_transcribe_check()
        else:
            self._handle_static()

    def do_POST(self):
        if self.path == '/api/anthropic':
            self._handle_anthropic_proxy()
        elif self.path == '/api/transcribe':
            self._handle_transcribe()
        elif self.path.startswith('/translations/'):
            self._handle_save_translation()
        else:
            self.send_error(404)

    def _json_response(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_transcribe_check(self):
        """Return 200 if the speech_recognition library is available, 501 otherwise.

        Called by the frontend before enabling server-side transcription so it
        can fall back to native Web Speech API or show a helpful error message.
        """
        if _SR_AVAILABLE:
            self._json_response(200, {'ok': True})
        else:
            self._json_response(501, {
                'error': 'speech_recognition not installed. Run: pip install SpeechRecognition'
            })

    def _handle_transcribe(self):
        """Accept a WAV audio blob, transcribe it via Google Speech, return the text.

        Request body: raw WAV bytes (Content-Type: audio/wav).
        Request header: X-Lang — BCP 47 language tag (default 'hi-IN').
        Response: JSON { transcript: string } on success, or an error object.
        """
        if not _SR_AVAILABLE:
            self._json_response(501, {
                'error': 'speech_recognition not installed. Run: pip install SpeechRecognition'
            })
            return

        length = int(self.headers.get('Content-Length', 0))
        audio_bytes = self.rfile.read(length)
        lang = self.headers.get('X-Lang', 'hi-IN')

        recognizer = _sr.Recognizer()
        try:
            with _sr.AudioFile(io.BytesIO(audio_bytes)) as source:
                audio = recognizer.record(source)
            text = recognizer.recognize_google(audio, language=lang)
            self._json_response(200, {'transcript': text})
        except _sr.UnknownValueError:
            self._json_response(200, {'transcript': ''})
        except _sr.RequestError as e:
            self._json_response(502, {'error': f'Google Speech API error: {e}'})
        except Exception as e:
            self._json_response(500, {'error': str(e)})

    def _handle_save_translation(self):
        """Save a translated document JSON to the translations/ folder."""
        filename = self.path[len('/translations/'):]

        # Basic safety checks
        if not filename.endswith('.json') or '/' in filename or '..' in filename:
            self.send_error(400, 'Invalid filename')
            return

        translations_dir = ROOT / 'translations'
        translations_dir.mkdir(exist_ok=True)
        dest = translations_dir / filename

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        try:
            dest.write_bytes(body)
        except OSError as e:
            self.send_error(500, str(e))
            return

        self.send_response(201)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _handle_anthropic_proxy(self):
        """Proxy POST /api/anthropic → https://api.anthropic.com/v1/messages.
        Runs server-side so the browser never touches the Anthropic origin directly,
        avoiding all CORS preflight issues.
        """
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        # Forward only the headers the Anthropic API needs
        forward_headers = {
            'Content-Type':      self.headers.get('Content-Type', 'application/json'),
            'x-api-key':         self.headers.get('x-api-key', ''),
            'anthropic-version': self.headers.get('anthropic-version', '2023-06-01'),
        }

        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=body,
            headers=forward_headers,
            method='POST',
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            resp_body = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        except urllib.error.URLError as e:
            self._json_response(502, {'error': f'Could not reach Anthropic API: {e.reason}'})

    def _handle_sse(self):
        """Long-lived SSE connection. Blocks until client disconnects."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        ev = watcher.subscribe()
        try:
            # Send an initial ping so the browser knows the connection is alive
            self.wfile.write(b': connected\n\n')
            self.wfile.flush()

            while True:
                # 15-second timeout prevents idle proxies and load balancers
                # from silently closing the connection between file-change events.
                fired = ev.wait(timeout=15)
                if fired:
                    ev.clear()
                    self.wfile.write(b'data: reload\n\n')
                else:
                    # SSE comment lines (": ...") are ignored by browsers but
                    # keep the TCP connection alive through intermediate proxies.
                    self.wfile.write(b': heartbeat\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass   # client disconnected — normal
        finally:
            watcher.unsubscribe(ev)

    def _handle_static(self):
        # Resolve path safely
        path = self.path.split('?')[0].split('#')[0]
        if path == '/':
            path = '/index.html'

        file_path = ROOT / path.lstrip('/')
        # Prevent directory traversal
        try:
            file_path = file_path.resolve()
            file_path.relative_to(ROOT)
        except (ValueError, OSError):
            self.send_error(403)
            return

        if not file_path.exists():
            self.send_error(404, f'File not found: {path}')
            return

        if file_path.is_dir():
            file_path = file_path / 'index.html'
            if not file_path.exists():
                self.send_error(404)
                return

        content_type, _ = mimetypes.guess_type(str(file_path))
        if content_type is None:
            content_type = 'application/octet-stream'

        try:
            data = file_path.read_bytes()
        except OSError:
            self.send_error(500)
            return

        # Inject reload script into HTML files
        if content_type == 'text/html':
            data = self._inject_reload(data)

        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(data)

    def _inject_reload(self, html: bytes) -> bytes:
        """Append the SSE reload script just before </body>, or at the end."""
        tag = b'</body>'
        idx = html.lower().rfind(tag)
        if idx != -1:
            return html[:idx] + RELOAD_SCRIPT + html[idx:]
        return html + RELOAD_SCRIPT


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    mimetypes.add_type('text/javascript', '.js')
    mimetypes.add_type('application/javascript', '.mjs')

    watcher.start()

    server = http.server.ThreadingHTTPServer(('', PORT), HotReloadHandler)
    print(f'  Bhajan Reader — http://localhost:{PORT}')
    print(f'  Watching: {ROOT}')
    print(f'  Hot reload: enabled  (Ctrl+C to stop)\n')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Server stopped.')
        sys.exit(0)
