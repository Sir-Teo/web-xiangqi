"use strict";

const CACHE_VERSION = "pikafish-demo-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ENGINE_CACHE = `${CACHE_VERSION}-engine`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./worker-parity.html",
  "./pikafish.js",
  "./sw.js",
];

const ENGINE_ASSETS = [
  "./pikafish.nnue",
  "./pikafish-core.js",
  "./pikafish-core.wasm",
  "./pikafish-core.worker.js",
  "./pikafish-core-simd.js",
  "./pikafish-core-simd.wasm",
  "./pikafish-core-simd.worker.js",
  "./pikafish-core-single.js",
  "./pikafish-core-single.wasm",
  "./pikafish-core-single.worker.js",
  "./pikafish-core-single-simd.js",
  "./pikafish-core-single-simd.wasm",
  "./pikafish-core-single-simd.worker.js",
];

// Warm JS/WASM runtime assets first; let NNUE cache on demand to avoid a large
// background fetch competing with initial page interactivity.
const ENGINE_WARM_ASSETS = ENGINE_ASSETS.filter((asset) => !/\.nnue$/i.test(asset));

function isSameOrigin(url) {
  try {
    return url.origin === self.location.origin;
  } catch (_) {
    return false;
  }
}

function isHTMLRequest(request) {
  return request.mode === "navigate" ||
    (request.destination === "document") ||
    ((request.headers.get("accept") || "").includes("text/html"));
}

function isEngineAssetPath(pathname) {
  return pathname.endsWith(".wasm") ||
    pathname.endsWith(".nnue") ||
    /\/pikafish(?:-core(?:-single)?(?:-simd)?)?(?:\.worker)?\.js$/.test(pathname);
}

function normalizeAssetUrl(asset) {
  return new URL(asset, self.registration.scope).toString();
}

async function putIfOk(cacheName, requestOrUrl, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(cacheName);
  try {
    await cache.put(requestOrUrl, response.clone());
  } catch (_) {}
  return response;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putIfOk(cacheName, request, response);
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    await putIfOk(cacheName, request, response);
    return response;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function warmEngineCache() {
  const cache = await caches.open(ENGINE_CACHE);
  for (const asset of ENGINE_WARM_ASSETS) {
    const url = normalizeAssetUrl(asset);
    try {
      if (await cache.match(url)) continue;
      const res = await fetch(url, { credentials: "same-origin" });
      if (res && res.ok) {
        await cache.put(url, res.clone());
      }
    } catch (_) {
      // Best-effort warm cache. Ignore failures to avoid breaking the app.
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    for (const asset of SHELL_ASSETS) {
      try {
        const res = await fetch(normalizeAssetUrl(asset), { credentials: "same-origin" });
        if (res && res.ok) await cache.put(normalizeAssetUrl(asset), res.clone());
      } catch (_) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key.startsWith("pikafish-demo-") && !key.startsWith(CACHE_VERSION)) {
        return caches.delete(key);
      }
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data && data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data && data.type === "WARM_ENGINE_CACHE") {
    event.waitUntil(warmEngineCache());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;
  const url = new URL(req.url);
  if (!isSameOrigin(url)) return;

  if (isEngineAssetPath(url.pathname)) {
    event.respondWith(cacheFirst(req, ENGINE_CACHE));
    return;
  }

  if (isHTMLRequest(req)) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
  }
});
