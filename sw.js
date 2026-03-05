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

// Preload the setup script into the WASM filesystem at /config/setup.php
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

// Initialise the PHP CGI worker
const php = new PhpCgiWorker({
    version: '8.3',
    sharedLibs,
    files,
    onRequest,
    notFound,
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
    // Virtual hosts:
    //   /app/setup/ → /config/setup.php  (installation endpoint)
    //   /app/       → /persist/phproject/ (the phproject application)
    vHosts: [
        {
            pathPrefix: '/app/setup/',
            directory: '/config/',
            entrypoint: 'setup.php',
        },
        {
            pathPrefix: '/app/',
            directory: '/persist/phproject/',
            entrypoint: 'index.php',
        },
    ],
});

self.addEventListener('install',  event => php.handleInstallEvent(event));
self.addEventListener('activate', event => php.handleActivateEvent(event));
self.addEventListener('fetch',    event => php.handleFetchEvent(event));
self.addEventListener('message',  event => php.handleMessageEvent(event));
