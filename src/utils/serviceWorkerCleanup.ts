export type LegacyRuntimeCleanupResult = {
    registrationsChecked: number;
    registrationsUnregistered: number;
    cacheKeysChecked: number;
    cacheKeysDeleted: number;
};

type ServiceWorkerLike = {
    scriptURL?: string;
};

type ServiceWorkerRegistrationLike = {
    scope?: string;
    active?: ServiceWorkerLike | null;
    installing?: ServiceWorkerLike | null;
    waiting?: ServiceWorkerLike | null;
    unregister?: () => Promise<boolean> | boolean;
};

type ServiceWorkerContainerLike = {
    getRegistrations?: () => Promise<ServiceWorkerRegistrationLike[]>;
};

type CacheStorageLike = {
    keys?: () => Promise<string[]>;
    delete?: (key: string) => Promise<boolean> | boolean;
};

type CleanupEnvironment = {
    serviceWorker?: ServiceWorkerContainerLike;
    cacheStorage?: CacheStorageLike;
    appBasePath?: string;
    locationHref?: string;
};

const LEGACY_CACHE_PREFIX = 'pikafish-demo-';

/**
 * The app's own worker, which this cleanup must never touch.
 *
 * This file exists because an old demo shipped a caching service worker at
 * `<base>/sw.js`, and a stale one went on serving old engine artifacts long
 * after the demo was gone. The cleanup was written to unregister it -- and
 * `docs/parity.md` records the consequence: with every worker unregistered the
 * app can have no worker of its own, so it gets no cross-origin isolation on
 * GitHub Pages, so threaded Pikafish is unreachable there. The note names
 * narrowing this cleanup as the prerequisite for fixing that.
 *
 * The name is deliberately not `sw.js`: the legacy test below matches that
 * filename exactly, and a worker sharing the old name would be unregistered by
 * the very code meant to spare it -- on every load, silently, leaving only the
 * puzzle of a site that never becomes isolated. The explicit check here is the
 * belt to that suspenders, so a future rename cannot reintroduce it.
 */
export const APP_SERVICE_WORKER_FILENAME = 'coi-sw.js';

function normalizeBasePath(basePath: string) {
    const normalized = basePath.startsWith('/') ? basePath : `/${basePath}`;
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function getPathname(value: string | undefined, locationHref: string) {
    if (!value) return '';
    try {
        return new URL(value, locationHref).pathname;
    } catch (_) {
        return '';
    }
}

function getDefaultAppBasePath() {
    return import.meta.env.BASE_URL || '/';
}

export function isLegacyRuntimeCacheKey(cacheKey: string) {
    return cacheKey.startsWith(LEGACY_CACHE_PREFIX);
}

export function isLegacyWebXiangqiServiceWorker(
    registration: ServiceWorkerRegistrationLike,
    appBasePath = getDefaultAppBasePath(),
    locationHref = globalThis.location?.href ?? 'https://example.test/'
) {
    const basePath = normalizeBasePath(appBasePath);
    const scopePath = getPathname(registration.scope, locationHref);
    const workerPaths = [
        registration.active?.scriptURL,
        registration.installing?.scriptURL,
        registration.waiting?.scriptURL,
    ].map((scriptUrl) => getPathname(scriptUrl, locationHref));

    // Never the app's own worker, whatever else matches.
    if (workerPaths.some((path) => path.endsWith(`/${APP_SERVICE_WORKER_FILENAME}`))) return false;

    return (
        (scopePath === basePath || scopePath.startsWith(basePath)) &&
        workerPaths.some((path) => path.startsWith(basePath) && path.endsWith('/sw.js'))
    );
}

export async function cleanupLegacyRuntimeStorage(
    environment: CleanupEnvironment = {}
): Promise<LegacyRuntimeCleanupResult> {
    const serviceWorker = environment.serviceWorker ?? globalThis.navigator?.serviceWorker;
    const cacheStorage = environment.cacheStorage ?? globalThis.caches;
    const appBasePath = environment.appBasePath ?? getDefaultAppBasePath();
    const locationHref = environment.locationHref ?? globalThis.location?.href ?? 'https://example.test/';
    const result: LegacyRuntimeCleanupResult = {
        registrationsChecked: 0,
        registrationsUnregistered: 0,
        cacheKeysChecked: 0,
        cacheKeysDeleted: 0,
    };

    try {
        const registrations = await serviceWorker?.getRegistrations?.();
        if (registrations) {
            result.registrationsChecked = registrations.length;
            await Promise.all(registrations.map(async (registration) => {
                if (!isLegacyWebXiangqiServiceWorker(registration, appBasePath, locationHref)) return;
                if (!registration.unregister) return;
                const unregistered = await registration.unregister();
                if (unregistered) result.registrationsUnregistered += 1;
            }));
        }
    } catch (_) {
        // Cleanup is best-effort; app startup must never depend on SW APIs.
    }

    try {
        const cacheKeys = await cacheStorage?.keys?.();
        if (cacheKeys) {
            result.cacheKeysChecked = cacheKeys.length;
            await Promise.all(cacheKeys.map(async (cacheKey) => {
                if (!isLegacyRuntimeCacheKey(cacheKey)) return;
                const deleted = await cacheStorage?.delete?.(cacheKey);
                if (deleted) result.cacheKeysDeleted += 1;
            }));
        }
    } catch (_) {
        // Ignore cache API failures for the same reason.
    }

    return result;
}
