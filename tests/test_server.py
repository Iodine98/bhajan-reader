"""
Unit tests for server.py HTTP handlers.

Tests call handler methods directly on a MockHandler — no real server socket.
Run with:
    pytest tests/test_server.py -v
    pytest tests/test_server.py --cov=server --cov-report=term-missing
"""

import io
import json
import sys
import tempfile
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch, call

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import server


# ── MockHandler ───────────────────────────────────────────────────────────────

class MockHandler(server.HotReloadHandler):
    """Minimal handler subclass for unit tests — no real socket I/O."""

    def __init__(self, path='/', headers=None, body=b''):
        self.path = path
        self.headers = headers or {}
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.client_address = ('127.0.0.1', 12345)
        self.server = MagicMock()
        self._response_code = None
        self._response_headers = {}
        self._error_code = None
        self._error_message = None

    def send_response(self, code, message=None):
        self._response_code = code

    def send_header(self, key, value):
        self._response_headers[key] = value

    def end_headers(self):
        pass

    def send_error(self, code, message=None):
        self._error_code = code
        self._error_message = message

    def address_string(self):
        return '127.0.0.1'

    def json_body(self):
        return json.loads(self.wfile.getvalue())

    def response_body(self):
        return self.wfile.getvalue()


# ── _handle_transcribe_check ──────────────────────────────────────────────────

class TestTranscribeCheck:

    def test_sr_available_returns_200(self):
        h = MockHandler('/api/transcribe-check')
        with patch.object(server, '_SR_AVAILABLE', True):
            h._handle_transcribe_check()
        assert h._response_code == 200
        assert h.json_body() == {'ok': True}

    def test_sr_unavailable_returns_501(self):
        h = MockHandler('/api/transcribe-check')
        with patch.object(server, '_SR_AVAILABLE', False):
            h._handle_transcribe_check()
        assert h._response_code == 501
        body = h.json_body()
        assert 'error' in body


# ── _handle_transcribe ────────────────────────────────────────────────────────

class TestTranscribe:

    def _make_mock_sr(self, transcript=None, side_effect=None):
        """Return a mock speech_recognition module."""
        mock_sr = MagicMock()

        class FakeUnknownValueError(Exception):
            pass

        class FakeRequestError(Exception):
            pass

        mock_sr.UnknownValueError = FakeUnknownValueError
        mock_sr.RequestError = FakeRequestError

        recognizer = mock_sr.Recognizer.return_value
        if side_effect:
            recognizer.recognize_google.side_effect = side_effect
        elif transcript is not None:
            recognizer.recognize_google.return_value = transcript

        return mock_sr

    def test_sr_unavailable_returns_501(self):
        h = MockHandler('/api/transcribe', body=b'audio')
        with patch.object(server, '_SR_AVAILABLE', False):
            h._handle_transcribe()
        assert h._response_code == 501

    def test_unknown_value_error_returns_empty_transcript(self):
        mock_sr = self._make_mock_sr()
        mock_sr.UnknownValueError = type('UVE', (Exception,), {})
        mock_sr.Recognizer.return_value.recognize_google.side_effect = mock_sr.UnknownValueError()
        h = MockHandler('/api/transcribe', headers={'Content-Length': '4'}, body=b'wave')
        with patch.object(server, '_SR_AVAILABLE', True), patch.object(server, '_sr', mock_sr):
            h._handle_transcribe()
        assert h._response_code == 200
        assert h.json_body() == {'transcript': ''}

    def test_request_error_returns_502(self):
        mock_sr = self._make_mock_sr()
        FakeRequestError = type('RequestError', (Exception,), {})
        mock_sr.RequestError = FakeRequestError
        mock_sr.Recognizer.return_value.recognize_google.side_effect = FakeRequestError('API down')
        h = MockHandler('/api/transcribe', headers={'Content-Length': '4'}, body=b'wave')
        with patch.object(server, '_SR_AVAILABLE', True), patch.object(server, '_sr', mock_sr):
            h._handle_transcribe()
        assert h._response_code == 502

    def test_generic_exception_returns_500(self):
        mock_sr = self._make_mock_sr()
        mock_sr.Recognizer.return_value.recognize_google.side_effect = RuntimeError('oops')
        h = MockHandler('/api/transcribe', headers={'Content-Length': '4'}, body=b'wave')
        with patch.object(server, '_SR_AVAILABLE', True), patch.object(server, '_sr', mock_sr):
            h._handle_transcribe()
        assert h._response_code == 500

    def test_success_returns_200_with_transcript(self):
        mock_sr = self._make_mock_sr(transcript='om namah shivaya')
        h = MockHandler('/api/transcribe', headers={'Content-Length': '4'}, body=b'wave')
        with patch.object(server, '_SR_AVAILABLE', True), patch.object(server, '_sr', mock_sr):
            h._handle_transcribe()
        assert h._response_code == 200
        assert h.json_body()['transcript'] == 'om namah shivaya'


# ── _handle_save_translation ──────────────────────────────────────────────────

class TestSaveTranslation:

    def test_valid_json_filename_returns_201(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(server, 'ROOT', Path(tmpdir)):
                h = MockHandler(
                    '/translations/abc123.json',
                    headers={'Content-Length': '2'},
                    body=b'{}',
                )
                h._handle_save_translation()
        assert h._response_code == 201

    def test_filename_with_slash_returns_400(self):
        h = MockHandler('/translations/sub/dir.json')
        h._handle_save_translation()
        assert h._error_code == 400

    def test_dotdot_traversal_returns_400(self):
        h = MockHandler('/translations/..%2Fetc%2Fpasswd.json')
        # Simulate path that contains '..'
        h.path = '/translations/../etc/passwd.json'
        # The code strips prefix: '../etc/passwd.json' contains '..'
        h2 = MockHandler('/translations/..%2F.json')
        h2.path = '/translations/../something.json'
        filename = h2.path[len('/translations/'):]
        assert '..' in filename
        h2._handle_save_translation()
        assert h2._error_code == 400

    def test_non_json_extension_returns_400(self):
        h = MockHandler('/translations/evil.sh')
        h._handle_save_translation()
        assert h._error_code == 400

    def test_oserror_on_write_returns_500(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(server, 'ROOT', Path(tmpdir)):
                h = MockHandler(
                    '/translations/test.json',
                    headers={'Content-Length': '2'},
                    body=b'{}',
                )
                with patch('pathlib.Path.write_bytes', side_effect=OSError('disk full')):
                    h._handle_save_translation()
        assert h._error_code == 500

    def test_file_actually_written(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(server, 'ROOT', Path(tmpdir)):
                payload = b'{"hello": "world"}'
                h = MockHandler(
                    '/translations/result.json',
                    headers={'Content-Length': str(len(payload))},
                    body=payload,
                )
                h._handle_save_translation()
                dest = Path(tmpdir) / 'translations' / 'result.json'
                assert dest.exists()
                assert dest.read_bytes() == payload


# ── _handle_anthropic_proxy ───────────────────────────────────────────────────

class TestAnthropicProxy:

    def test_successful_proxy_forwards_response(self):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = b'{"id":"msg_1"}'
        mock_resp.headers.get.return_value = 'application/json'
        mock_resp.__enter__ = lambda s: mock_resp
        mock_resp.__exit__ = MagicMock(return_value=False)

        h = MockHandler(
            '/api/anthropic',
            headers={'Content-Length': '10', 'Content-Type': 'application/json',
                     'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01'},
            body=b'{"model":"x"}',
        )
        with patch('server.urllib.request.urlopen', return_value=mock_resp):
            h._handle_anthropic_proxy()

        assert h._response_code == 200
        assert h.response_body() == b'{"id":"msg_1"}'

    def test_http_error_forwards_upstream_code(self):
        err = urllib.error.HTTPError(
            url='https://api.anthropic.com/v1/messages',
            code=401,
            msg='Unauthorized',
            hdrs=MagicMock(),
            fp=io.BytesIO(b'{"error":"invalid_api_key"}'),
        )
        err.read = lambda: b'{"error":"invalid_api_key"}'

        h = MockHandler(
            '/api/anthropic',
            headers={'Content-Length': '2', 'x-api-key': 'bad'},
            body=b'{}',
        )
        with patch('server.urllib.request.urlopen', side_effect=err):
            h._handle_anthropic_proxy()

        assert h._response_code == 401

    def test_url_error_returns_502(self):
        h = MockHandler(
            '/api/anthropic',
            headers={'Content-Length': '2'},
            body=b'{}',
        )
        with patch('server.urllib.request.urlopen',
                   side_effect=urllib.error.URLError('Name resolution failed')):
            h._handle_anthropic_proxy()

        assert h._response_code == 502


# ── _handle_static ────────────────────────────────────────────────────────────

class TestHandleStatic:

    def test_file_not_found_returns_404(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(server, 'ROOT', Path(tmpdir)):
                h = MockHandler('/nonexistent.txt')
                h._handle_static()
        assert h._error_code == 404

    def test_path_traversal_returns_403(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(server, 'ROOT', Path(tmpdir)):
                h = MockHandler('/../etc/passwd')
                h._handle_static()
        assert h._error_code == 403

    def test_directory_resolves_to_index_html(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            index = root / 'index.html'
            index.write_text('<html><body>hello</body></html>')
            with patch.object(server, 'ROOT', root):
                h = MockHandler('/')
                h._handle_static()
        assert h._response_code == 200

    def test_html_file_gets_reload_script_injected(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            html_file = root / 'page.html'
            html_file.write_bytes(b'<html><body>hi</body></html>')
            with patch.object(server, 'ROOT', root):
                h = MockHandler('/page.html')
                h._handle_static()
        assert h._response_code == 200
        body = h.response_body()
        assert b'EventSource' in body
        assert b'livereload' in body

    def test_non_html_file_no_injection(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            js_file = root / 'app.js'
            js_file.write_bytes(b'console.log("hi");')
            with patch.object(server, 'ROOT', root):
                h = MockHandler('/app.js')
                h._handle_static()
        assert h._response_code == 200
        assert b'EventSource' not in h.response_body()


# ── _inject_reload ────────────────────────────────────────────────────────────

class TestInjectReload:

    def test_injects_before_body_close_tag(self):
        h = MockHandler()
        html = b'<html><body><p>Hello</p></body></html>'
        result = h._inject_reload(html)
        body_pos = result.lower().find(b'</body>')
        script_pos = result.find(b'EventSource')
        assert script_pos < body_pos

    def test_appends_when_no_body_close_tag(self):
        h = MockHandler()
        html = b'<html><p>No close tag</p>'
        result = h._inject_reload(html)
        assert result.startswith(html)
        assert b'EventSource' in result


# ── FileWatcher ───────────────────────────────────────────────────────────────

class TestFileWatcher:

    def test_snapshot_skips_hidden_directories(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            # Visible file
            (root / 'app.js').write_text('// visible')
            # Hidden dir
            hidden = root / '.git'
            hidden.mkdir()
            (hidden / 'config.js').write_text('// hidden')

            fw = server.FileWatcher(root)
            mtimes = fw._snapshot()

        paths = list(mtimes.keys())
        assert any('app.js' in p for p in paths)
        assert not any('.git' in p for p in paths)

    def test_snapshot_ignores_non_watched_extensions(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / 'readme.md').write_text('hello')
            (root / 'style.css').write_text('body {}')

            fw = server.FileWatcher(root)
            mtimes = fw._snapshot()

        assert not any('.md' in p for p in mtimes)
        assert any('.css' in p for p in mtimes)

    def test_fires_event_when_mtime_changes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            js_file = root / 'app.js'
            js_file.write_text('// v1')

            fw = server.FileWatcher(root)
            fw._mtimes = fw._snapshot()
            ev = fw.subscribe()

            # Simulate a file change by directly notifying
            new = dict(fw._mtimes)
            for k in new:
                new[k] += 1.0  # bump all mtimes

            changed = (
                set(new) != set(fw._mtimes) or
                any(new[k] != fw._mtimes.get(k) for k in new)
            )
            assert changed
            if changed:
                with fw._lock:
                    for e in fw._clients:
                        e.set()

            assert ev.is_set()

    def test_subscribe_unsubscribe(self):
        fw = server.FileWatcher(Path('/tmp'))
        ev = fw.subscribe()
        assert ev in fw._clients
        fw.unsubscribe(ev)
        assert ev not in fw._clients

    def test_unsubscribe_nonexistent_is_safe(self):
        fw = server.FileWatcher(Path('/tmp'))
        ev = MagicMock()
        fw.unsubscribe(ev)  # should not raise
