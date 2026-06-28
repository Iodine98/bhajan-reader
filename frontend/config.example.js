// Copy to config.js for local dev against a remote backend.
// In CI, generated automatically from the TAILSCALE_BACKEND_URL GitHub secret.
// Without this file, all API calls use relative paths (works with docker compose or server.py directly).
Object.defineProperty(window, 'BACKEND_URL', {
  value: 'https://your-machine.ts.net',
  writable: false,
  configurable: false,
});
