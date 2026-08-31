/**
 * Cross-origin isolation for a host that will not send the headers itself.
 *
 * A browser only hands out `SharedArrayBuffer` -- and therefore WebAssembly
 * threads, and therefore the threaded Pikafish core -- to a page that is
 * cross-origin isolated, which means one served with `Cross-Origin-Opener-Policy`
 * and `Cross-Origin-Embedder-Policy`. `vite.config.ts` sends both, so every dev
 * server and every browser check in this repo is isolated. **GitHub Pages sends
 * neither and cannot be configured to**, so the deployed app -- the only build
 * a player actually loads -- ran the single-threaded core.
 *
 * A service worker sees every same-origin response before the page does, so it
 * can add the headers the host omitted. Measured on the built app, same machine,
 * same position, MultiPV 3:
 *
 *   without   single-simd, 1 thread,  479k nps, seldepth 31, hash 4%
 *   with      threaded-simd, 8 threads, 3.9M nps, seldepth 41, hash 26%
 *
 * ## This worker does not cache anything, on purpose
 *
 * The cleanup in `utils/serviceWorkerCleanup.ts` exists because an older demo
 * shipped a *caching* worker at `<base>/sw.js`, and a stale one went on serving
 * old engine artifacts after the demo was gone. That failure is the reason this
 * one only rewrites headers on responses it fetches from the network: there is
 * no cache to go stale, and no version of the app that can outlive a deploy.
 * Offline support is a separate feature with separate risks, and is not here.
 *
 * If this worker fails, is blocked, or is never installed, every request still
 * goes to the network unchanged and the app runs single-threaded -- which is
 * exactly what it did before this file existed.
 */

self.addEventListener('install', () => {
    // Take over as soon as possible; the page reloads once to become isolated
    // and there is nothing cached that an older worker needs to finish serving.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

/**
 * The engine's weights, kept out of the way of Chrome's cache size limit.
 *
 * `pikafish.nnue` is 53MB, and a browser HTTP cache will not store a single
 * entry that large -- measured: the 710KB core is served from cache on a second
 * fetch and never reaches the server again, while the weights are requested
 * unconditionally every time, at full size, on every visit. GitHub Pages sends
 * an ETag and `max-age=600` and neither helps, because the response is never
 * stored to revalidate against. A player on a phone pays 53MB each time they
 * open the board.
 *
 * Cache Storage has no per-entry limit, so the weights live there instead.
 *
 * **It always revalidates**, which is the whole reason this is safe. The
 * failure this repo's `serviceWorkerCleanup` exists for is a cached engine
 * artifact outliving a deploy, so a copy is never served on its own authority:
 * every load sends a conditional request carrying the stored validator, and the
 * cached body is used only when the server answers 304. A redeployed net
 * answers 200 and replaces it. What is saved is the 53MB body, not the
 * round-trip.
 *
 * A response with no validator is not cached at all -- there would be no way to
 * ask whether it had changed.
 */
const WEIGHTS_CACHE = 'pikafish-weights-v1';
const WEIGHTS_PATTERN = /\/pikafish\.nnue$/;

function isolated(response) {
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

async function serveWeights(request) {
    let cache = null;
    let cached = null;
    try {
        cache = await caches.open(WEIGHTS_CACHE);
        cached = await cache.match(request.url);
    } catch (_) {
        // No Cache Storage (private mode, no quota): fall through to the network.
    }

    const validators = new Headers();
    const etag = cached && cached.headers.get('ETag');
    const lastModified = cached && cached.headers.get('Last-Modified');
    if (etag) validators.set('If-None-Match', etag);
    else if (lastModified) validators.set('If-Modified-Since', lastModified);

    let response;
    try {
        // `no-cache` on the *browser* cache: it will not have stored this
        // anyway, and the conditional headers above are the ones that matter.
        response = await fetch(request.url, {
            headers: validators,
            cache: 'no-cache',
            credentials: 'same-origin',
        });
    } catch (error) {
        if (cached) return isolated(cached);
        throw error;
    }

    if (response.status === 304 && cached) return isolated(cached);

    if (response.ok && cache && (response.headers.get('ETag') || response.headers.get('Last-Modified'))) {
        try { await cache.put(request.url, response.clone()); } catch (_) { /* over quota */ }
    }
    if (!response.ok && cached) return isolated(cached);
    return isolated(response);
}

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Handle as little as possible. Everything this app loads is a same-origin
    // GET, and those are the only responses that need the headers -- so anything
    // else is passed straight to the network untouched rather than rebuilt.
    // Returning without calling respondWith() is not a fallback path, it is the
    // browser's own path, which is the one worth preferring for requests this
    // worker has no reason to be in the middle of.
    if (request.method !== 'GET') return;
    if (new URL(request.url).origin !== self.location.origin) return;

    // `only-if-cached` outside same-origin mode throws if passed to fetch().
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

    if (WEIGHTS_PATTERN.test(new URL(request.url).pathname)) {
        event.respondWith(serveWeights(request));
        return;
    }

    event.respondWith(
        fetch(request)
            .then((response) => {
                // An opaque response (status 0) has headers that cannot be read
                // or replaced, and constructing a Response from one throws.
                if (response.status === 0) return response;
                return isolated(response);
            })
            // Let the failure surface as the network failure it is, rather than
            // as a worker that swallowed the request.
            .catch((error) => { throw error; })
    );
});
