<?php

declare(strict_types=1);

/**
 * Server-side relay to backend-gateway (see backend-gateway issue #11 and
 * Iodine98/backend-gateway#27's blanket X-Api-Key enforcement).
 *
 * The browser never sees the gateway's `.ts.net` URL or its shared-secret
 * `X-Api-Key` — both live only in `.env` (gitignored, deploy-time-generated
 * from GitHub Actions secrets by `.github/workflows/deploy-frontend.yml`,
 * never shipped as a static file). `deploy-frontend.yml` no longer bakes
 * `BACKEND_URL` into `config.js`, so the frontend's `window.BACKEND_URL`
 * stays unset and every API call already falls back to a same-origin
 * relative path (`BASE = window.BACKEND_URL || ''`, see
 * frontend/modules/{translator,speech}.js and frontend/app.js) — those
 * relative requests land on this app's own Hetzner origin, where
 * `.htaccess` rewrites `/api/*` and `/translations/*` to this script.
 *
 * Only the routes the frontend actually calls are forwarded (see
 * backend/server.py's do_GET/do_POST) — everything else is 404, not
 * proxied blindly.
 *
 * Header-name collision: the frontend sends the *user's own* Anthropic API
 * key (entered client-side, never stored server-side — see CLAUDE.md) as
 * `x-api-key` on /api/anthropic. HTTP headers are case-insensitive, so that
 * is the SAME header name backend-gateway's shared secret needs. This relay
 * resends the user's key as `X-Anthropic-Api-Key` to avoid clobbering the
 * gateway's own `X-Api-Key`; backend/server.py's `_handle_anthropic_proxy`
 * prefers that header when present (falls back to `x-api-key` for
 * local/direct dev, where there's no gateway hop and no collision).
 */

const ALLOWED_PATH_PREFIXES = ['/api/anthropic', '/api/transcribe-check', '/api/transcribe', '/translations/'];
const ALLOWED_METHODS = ['GET', 'POST'];

function fail(int $status, string $message = ''): never
{
    http_response_code($status);
    if ($message !== '') {
        echo $message;
    }
    exit;
}

$envPath = __DIR__ . '/.env';
if (!is_readable($envPath)) {
    fail(500, 'Relay misconfigured: .env missing');
}
$env = parse_ini_file($envPath);
$gatewayUrl = rtrim((string) ($env['GATEWAY_URL'] ?? ''), '/');
$gatewayOrigin = (string) ($env['GATEWAY_ORIGIN'] ?? '');
$apiKey = (string) ($env['GATEWAY_API_KEY'] ?? '');
if ($gatewayUrl === '' || $gatewayOrigin === '' || $apiKey === '') {
    fail(500, 'Relay misconfigured: missing GATEWAY_* value(s) in .env');
}

// __path is the routing param .htaccess's RewriteRule injects (the full
// original request path, "/api/..." or "/translations/..."); QSA appends
// the browser's real query string alongside it.
$path = '/' . ltrim((string) ($_GET['__path'] ?? ''), '/');
if (str_contains($path, '..')) {
    fail(400, 'Invalid path');
}
$isAllowed = false;
foreach (ALLOWED_PATH_PREFIXES as $prefix) {
    if ($path === $prefix || str_starts_with($path, $prefix)) {
        $isAllowed = true;
        break;
    }
}
if (!$isAllowed) {
    fail(404);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ALLOWED_METHODS, true)) {
    fail(405);
}

// Rebuild the forwarded query string, dropping the routing-only __path param.
$query = $_GET;
unset($query['__path']);
$queryString = http_build_query($query);
$url = $gatewayUrl . $path . ($queryString !== '' ? '?' . $queryString : '');

$requestHeaders = [
    'X-Api-Key: ' . $apiKey,
    // The gateway routes by Origin (see backend-gateway/nginx.conf's
    // origins.map) — this must be the whitelisted origin, not the browser's
    // real (Hetzner) origin, which the gateway wouldn't recognize.
    'Origin: ' . $gatewayOrigin,
];
$contentType = $_SERVER['CONTENT_TYPE'] ?? null;
if ($contentType) {
    $requestHeaders[] = 'Content-Type: ' . $contentType;
}
// /api/anthropic only: resend the user's own Anthropic key under a
// different header name so it can't collide with X-Api-Key above (see the
// doc comment). getallheaders() is available under Apache/mod_php, which is
// what this relay targets.
$incomingHeaders = function_exists('getallheaders') ? getallheaders() : [];
foreach ($incomingHeaders as $name => $value) {
    if (strcasecmp($name, 'x-api-key') === 0 && $value !== '') {
        $requestHeaders[] = 'X-Anthropic-Api-Key: ' . $value;
    } elseif (strcasecmp($name, 'anthropic-version') === 0) {
        $requestHeaders[] = 'Anthropic-Version: ' . $value;
    } elseif (strcasecmp($name, 'x-lang') === 0) {
        $requestHeaders[] = 'X-Lang: ' . $value;
    }
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $requestHeaders,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 5,
    // /api/transcribe chunks are small, but Anthropic completions can take a
    // while — give the upstream more room than a plain content fetch needs.
    CURLOPT_TIMEOUT => 60,
]);
if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}

$response = curl_exec($ch);
if ($response === false) {
    $error = curl_error($ch);
    curl_close($ch);
    fail(502, 'Gateway unreachable: ' . $error);
}

$headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$rawHeaders = substr($response, 0, $headerSize);
$responseBody = substr($response, $headerSize);

http_response_code($status);
foreach (preg_split('/\r\n/', $rawHeaders) as $headerLine) {
    if (stripos($headerLine, 'Content-Type:') === 0) {
        header($headerLine);
    }
}
echo $responseBody;
