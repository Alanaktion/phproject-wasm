# Project Guidelines

## Code Style
- Keep changes minimal and targeted; this repo is intentionally experimental and optimized for agent maintainability.
- Prefer editing wrapper files (`index.html`, `sw.js`, `scripts/setup.php`, `README.md`, `scripts/download-release.sh`) over modifying bundled upstream release contents under `releases/home/runner/work/phproject/phproject/phproject/` unless explicitly required.
- Preserve existing comment style in critical bootstrapping code (`sw.js`, `scripts/setup.php`, `index.html`) where comments document WASM/runtime edge cases.

## Architecture
- `index.html` is the installer/loader UI and orchestrates first-run setup via Service Worker messaging.
- `sw.js` hosts `PhpCgiWorker` and is the runtime boundary for PHP-in-WASM: request handling, vHost/docroot mapping, MIME mapping, extension loading, and setup action execution.
- `scripts/setup.php` performs first-run provisioning inside WASM FS: zip extraction, SQLite schema init, admin/default config insertion, and `config.php` creation.
- Runtime app docroot is `/persist/phproject` in WASM FS; `/app/*` is the public route prefix handled by the Service Worker.

## Build and Test
- Use Node 18+.
- Installation of npm dependencies is not required.
- Local dev server: `npx serve . --cors` (serves with CORS headers required for SW module imports).
- Refresh bundled release metadata/archive: `bash scripts/download-release.sh`.
- Validate setup script syntax: `npm run lint:php`.
- If you modify deploy behavior, verify `.github/workflows/deploy.yml` still lints `scripts/setup.php` and produces `releases/phproject.json` + `releases/phproject.zip`.

## Conventions
- First-run setup should be executed through SW action messaging (`runSetupScript`) rather than relying on initial fetch interception timing.
- Prefer explicit setup script URL semantics (`/app/setup.php`) and avoid directory-style setup paths (`/app/setup/`) that can misroute under php-cgi-wasm vHost behavior.
- Keep `autoTransaction: false` in `PhpCgiWorker` unless you can prove startup IDBFS race conditions are handled.
- Preserve preflight checks and retries around SW message calls in `index.html`; they mitigate transient IndexedDB/transaction startup errors.
- Keep `site.url` omitted in generated `config.php` so origin is computed dynamically at runtime.

## Pitfalls
- `404` on `/app/index.php` before installation completes is expected.
- Service Worker requires secure context (`https` or `localhost`); do not assume `file://` execution.
- First load depends on network access to CDN/runtime and release artifacts; treat related failures as environment issues before refactoring core flow.
- This project is single-user/local-state oriented (IDBFS/IndexedDB persistence). Avoid server-only assumptions when implementing features.
