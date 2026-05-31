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
