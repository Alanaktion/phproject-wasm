/**
 * Service Worker for phproject-wasm
 *
 * Uses php-cgi-wasm to serve the phproject PHP application in the browser.
 * PHP extensions are loaded from jsDelivr CDN.
 */

import { PhpCgiWorker } from 'https://cdn.jsdelivr.net/npm/php-cgi-wasm@0.0.9-alpha-32/PhpCgiWorker.mjs';

const CDN = 'https://cdn.jsdelivr.net/npm';

// Shared PHP extension libraries (loaded from CDN)
const sharedLibs = [
    {
        getLibs: (php) => [
            { url: `${CDN}/php-wasm-sqlite@0.0.9-x/libsqlite3.so` },
            { url: `${CDN}/php-wasm-sqlite@0.0.9-x/php${php.phpVersion}-sqlite.so`, ini: true },
            { url: `${CDN}/php-wasm-sqlite@0.0.9-x/php${php.phpVersion}-pdo-sqlite.so`, ini: true },
        ],
    },
    {
        getLibs: (php) => [
            { url: `${CDN}/php-wasm-zlib@0.0.9-h/libz.so` },
            { url: `${CDN}/php-wasm-zlib@0.0.9-h/php${php.phpVersion}-zlib.so`, ini: true },
        ],
    },
    {
        getLibs: (php) => [
            { url: `${CDN}/php-wasm-libzip@0.0.9-g/libzip.so` },
            { url: `${CDN}/php-wasm-libzip@0.0.9-g/php${php.phpVersion}-zip.so`, ini: true },
        ],
    },
    {
        getLibs: (php) => [
            { url: `${CDN}/php-wasm-openssl@0.0.9-k/libcrypto.so` },
            { url: `${CDN}/php-wasm-openssl@0.0.9-k/libssl.so` },
        ],
    },
    {
        getLibs: (php) => [
            { url: `${CDN}/php-wasm-mbstring@0.0.0-c/libonig.so` },
            { url: `${CDN}/php-wasm-mbstring@0.0.0-c/php${php.phpVersion}-mbstring.so`, ini: true },
        ],
    },
];

// Preload setup script into WASM FS.
const files = [
    {
        parent: '/config/',
        name: 'setup.php',
        url: new URL('./scripts/setup.php', self.location).href,
    },
];

// Log requests for debugging
const onRequest = (request, response) => {
    const url = new URL(request.url);
    console.log(`[phproject-wasm] ${request.method} ${url.pathname} → ${response.status}`);
};

// Serve a friendly 404 page
const notFound = (request) => {
    const url = new URL(request.url);
    return new Response(
        `<!DOCTYPE html><html><body><h1>404 Not Found</h1><p>${url.pathname}</p></body></html>`,
        { status: 404, headers: { 'Content-Type': 'text/html' } }
    );
};

// Derive stable CGI host/scheme defaults from the Service Worker origin.
// Fat-Free derives HOST from SERVER_NAME (not HTTP_HOST), so include host:port.
const swOrigin = new URL(self.location.href);
const swScheme = swOrigin.protocol === 'https:' ? 'https' : 'http';
const swPort = swOrigin.port || (swScheme === 'https' ? '443' : '80');
const swServerName = swOrigin.hostname;

// Initialise the PHP CGI worker
const php = new PhpCgiWorker({
    version: '8.3',
    // php-cgi-wasm does not currently populate SERVER_PROTOCOL.
    // Some frameworks (Fat-Free) expect it for status headers.
    env: {
        SERVER_PROTOCOL: 'HTTP/1.1',
        // Keep SERVER_NAME as hostname only; some frameworks append SERVER_PORT.
        SERVER_NAME: swServerName,
        SERVER_PORT: swPort,
        HTTP_HOST: swOrigin.host,
        REQUEST_SCHEME: swScheme,
        HTTPS: swScheme === 'https' ? 'on' : 'off',
    },
    // Work around intermittent IDBFS transaction-closing races during startup.
    autoTransaction: false,
    sharedLibs,
    files,
    onRequest,
    notFound,
    // Expose a setup action so installer can run setup.php without relying on
    // first-load fetch interception timing.
    actions: {
        async runSetupScript(server, zipBytes, installConfigJson, setupScriptText) {
            // First request may hydrate FS from IDB; stage critical setup inputs
            // after hydration so they are guaranteed present for setup.php.
            await server._beforeRequest();

            try {
                await server.mkdir('/persist/phproject');
            } catch (_) {
                // Directory may already exist.
            }

            if (zipBytes) {
                await server.writeFile('/persist/phproject.zip', zipBytes);
            }

            if (typeof installConfigJson === 'string' && installConfigJson.length) {
                await server.writeFile('/config/install.json', installConfigJson, { encoding: 'utf8' });
            }

            if (typeof setupScriptText === 'string' && setupScriptText.length) {
                await server.writeFile('/config/setup.php', setupScriptText, { encoding: 'utf8' });
                await server.writeFile('/persist/phproject/setup.php', setupScriptText, { encoding: 'utf8' });
            }

            const request = new Request(new URL('./app/setup.php', self.location).href, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });

            const response = await server.request(request);
            const body = await response.text();

            return {
                ok: response.ok,
                status: response.status,
                body,
            };
        },
    },
    // Intercept all requests under /app/
    prefix: '/app/',
    // Default docroot for phproject
    docroot: '/persist/phproject',
    // Static file content types
    types: {
        css:   'text/css',
        js:    'application/javascript',
        mjs:   'application/javascript',
        json:  'application/json',
        jpeg:  'image/jpeg',
        jpg:   'image/jpeg',
        gif:   'image/gif',
        png:   'image/png',
        svg:   'image/svg+xml',
        webp:  'image/webp',
        woff:  'font/woff',
        woff2: 'font/woff2',
        ttf:   'font/ttf',
        eot:   'application/vnd.ms-fontobject',
        ico:   'image/x-icon',
        xml:   'application/xml',
        pdf:   'application/pdf',
        zip:   'application/zip',
        txt:   'text/plain',
    },
    // Virtual host:
    //   /app/ → /persist/phproject/ (the phproject application)
    // Setup runs as /app/setup.php via runSetupScript action above.
    vHosts: [
        {
            pathPrefix: '/app/',
            directory: '/persist/phproject/',
            entrypoint: 'index.php',
        },
    ],
});

// Some browsers can fail navigation on synthetic SW 302 responses.
// Follow same-origin in-app redirects here and return the final response.
const originalPhpRequest = php.request.bind(php);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 8;
const DEBUG_REDIRECTS = true;

const toAbsoluteLocation = (location, requestUrl) => {
    try {
        return new URL(location, requestUrl).href;
    } catch (_) {
        return null;
    }
};

const withAbsoluteLocation = (response, absoluteLocation) => {
    const headers = new Headers(response.headers);
    headers.set('Location', absoluteLocation);
    headers.delete('Content-Length');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
};

const withNavigationUrl = async (response, targetUrl) => {
    const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
    if (!contentType.includes('text/html')) {
        return response;
    }

    const target = new URL(targetUrl);
    const sameOriginPath = `${target.pathname}${target.search}${target.hash}`;
    const marker = '__phproject_redirect_url_sync__';

    let html;
    try {
        html = await response.text();
    } catch (_) {
        return response;
    }

    if (html.includes(marker)) {
        return response;
    }

    const script = `<script id="${marker}">history.replaceState(null,'',${JSON.stringify(sameOriginPath)});</script>`;
    const patchedHtml = html.includes('</head>')
        ? html.replace('</head>', `${script}</head>`)
        : `${script}${html}`;

    const headers = new Headers(response.headers);
    headers.delete('Content-Length');

    return new Response(patchedHtml, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
};

const makeRedirectHopRequest = (url, method, sourceRequest) => {
    // Keep this as a minimal request-like object consumed by breakoutRequest.
    // Avoid Request() constructor edge cases for navigation requests in SW.
    return {
        url,
        method,
        headers: sourceRequest.headers || new Headers(),
        body: null,
    };
};

php.request = async (request) => {
    try {
        const method = (request.method || 'GET').toUpperCase();
        const isNavigate = request.mode === 'navigate';
        let currentRequest = request;
        let followedRedirect = false;
        let response = await originalPhpRequest(currentRequest);

        // Only auto-follow safe navigation redirects.
        if (method !== 'GET' && method !== 'HEAD') {
            return response;
        }

        for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
            if (!REDIRECT_STATUSES.has(response.status)) {
                if (followedRedirect && isNavigate) {
                    return withNavigationUrl(response, currentRequest.url);
                }

                return response;
            }

            const location = response.headers.get('Location');
            if (!location) {
                return response;
            }

            const absoluteLocation = toAbsoluteLocation(location, currentRequest.url);
            if (!absoluteLocation) {
                if (DEBUG_REDIRECTS) {
                    console.warn('[phproject-wasm][redirect] Invalid Location header', {
                        from: currentRequest.url,
                        status: response.status,
                        location,
                    });
                }
                return response;
            }

            const nextUrl = new URL(absoluteLocation);
            const inAppRedirect = nextUrl.origin === swOrigin.origin
                && nextUrl.pathname.startsWith('/app/');

            if (DEBUG_REDIRECTS) {
                console.log('[phproject-wasm][redirect]', {
                    hop,
                    from: currentRequest.url,
                    status: response.status,
                    location,
                    absoluteLocation,
                    inAppRedirect,
                });
            }

            if (!inAppRedirect) {
                // For redirects we don't follow, at least ensure absolute Location.
                if (absoluteLocation !== location) {
                    return withAbsoluteLocation(response, absoluteLocation);
                }

                return response;
            }

            followedRedirect = true;
            currentRequest = makeRedirectHopRequest(absoluteLocation, method, currentRequest);
            response = await originalPhpRequest(currentRequest);
        }

        if (followedRedirect && isNavigate) {
            return withNavigationUrl(response, currentRequest.url);
        }

        return new Response('Redirect loop detected.', { status: 508, headers: { 'Content-Type': 'text/plain' } });
    } catch (error) {
        console.error('[phproject-wasm][redirect] Redirect handling failed; returning original response path.', error);
        return originalPhpRequest(request);
    }
};

self.addEventListener('install',  event => php.handleInstallEvent(event));
self.addEventListener('activate', event => php.handleActivateEvent(event));
self.addEventListener('fetch',    event => php.handleFetchEvent(event));
self.addEventListener('message',  event => php.handleMessageEvent(event));
