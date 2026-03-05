# phproject-wasm

Experimental deployment of [Phproject](https://github.com/alanaktion/phproject) running entirely in the browser via WebAssembly, using [php-wasm](https://github.com/seanmorris/php-wasm). No server required — PHP runs inside a Service Worker, with data stored locally in an SQLite database persisted to the browser's IndexedDB.

## How it works

1. **First visit** — The page downloads the latest Phproject release `.zip` directly from GitHub, extracts it into the browser's virtual filesystem (EMSCRIPTEN MEMFS + IDBFS), initialises an SQLite database, creates a default admin user, and writes a `config.php`. All of this happens in a PHP-CGI process running as a Service Worker.
2. **Subsequent visits** — The Service Worker intercepts all requests to `/app/*` and routes them through PHP-CGI, so Phproject behaves exactly as it would on a real server — URL routing, form submissions, sessions, and cookies all work as expected.
3. **Persistence** — The virtual filesystem is synced to [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) via EMSCRIPTEN's IDBFS, so your data survives page reloads.

## Requirements

- A modern browser with **Service Worker** and **WebAssembly** support (Chrome 91+, Firefox 116+, Safari 16.4+).
- The page must be served over **HTTPS** (or `localhost`) — Service Workers require a secure context.
- **Internet access** on first load to download the Phproject release and the PHP-WASM runtime from jsDelivr CDN.

## Default credentials

| Username | Password |
|----------|----------|
| `admin`  | `admin`  |

> **Note:** This is a single-user local deployment. Change your password after first login.

## Development / local preview

```bash
# Serve with CORS headers (required for Service Worker module imports)
npx serve . --cors
```

Then open `http://localhost:3000`.

## Deployment (GitHub Pages)

Push to the `main` branch. The included [GitHub Actions workflow](.github/workflows/deploy.yml) uploads the repository root as a GitHub Pages artifact.

Make sure GitHub Pages is configured to deploy via **GitHub Actions** in your repository settings (`Settings → Pages → Source → GitHub Actions`).

## Architecture

```
index.html          — Loader/installer page (served statically, outside SW scope)
sw.js               — Service Worker (php-cgi-wasm PhpCgiWorker)
scripts/setup.php   — PHP setup script (preloaded into WASM FS, runs on first visit)
```

The Service Worker intercepts requests under `/app/` and routes them to Phproject's `index.php`. Static assets (CSS, JS, images, fonts) are served directly from the virtual filesystem without invoking PHP.

The setup endpoint (`/app/setup/`) is always available and served from `/config/setup.php` inside the WASM filesystem. It is triggered once during the first-run installation.

## Limitations

- **Single-user** — sessions are stored in SQLite in the browser; multiple browser tabs work but different browsers/devices have separate data.
- **No email** — mail sending is not available in the WASM environment.
- **No file uploads** — file upload support is untested and may not persist correctly.
- **Performance** — PHP runs in a Web Worker and is slower than a native PHP server, particularly on first load while the WASM binary and extensions are fetched.
- **No HTTPS-only features** — some Phproject features that rely on real HTTP headers may not work in the WASM context.
