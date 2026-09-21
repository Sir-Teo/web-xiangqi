import { describe, expect, it } from 'vitest';
import {
    APP_SERVICE_WORKER_FILENAME,
    cleanupLegacyRuntimeStorage,
    isLegacyRuntimeCacheKey,
    isLegacyWebXiangqiServiceWorker,
} from './serviceWorkerCleanup';

const BASE = '/web-xiangqi/';
const HREF = 'https://example.github.io/web-xiangqi/';

const registration = (scriptURL: string, scope = HREF) => ({
    scope,
    active: { scriptURL },
});

describe('deciding which service worker is the stale demo', () => {
    it('recognises the old demo worker it was written to remove', () => {
        expect(isLegacyWebXiangqiServiceWorker(registration(`${HREF}sw.js`), BASE, HREF)).toBe(true);
    });

    it('spares a worker registered outside this app’s base path', () => {
        // Another app on the same origin. Its worker is not ours to
        // unregister, and this is the guard that says so -- found by mutation,
        // which could invert the scope test and have the cleanup reach out of
        // its own directory on every load.
        const elsewhere = 'https://example.github.io/other-app/';
        expect(isLegacyWebXiangqiServiceWorker(
            registration(`${elsewhere}sw.js`, elsewhere), BASE, HREF,
        )).toBe(false);
        // And the case the scope test alone decides: a script that does live
        // in our directory, claimed by a scope that does not. The worker-path
        // check passes here, so this is the only assertion that can tell the
        // scope test is still being applied.
        expect(isLegacyWebXiangqiServiceWorker(
            registration(`${HREF}sw.js`, elsewhere), BASE, HREF,
        )).toBe(false);
    });

    it('still reaches a worker registered below the base path', () => {
        // The scope test is `startsWith`, not equality: the old demo could be
        // registered on a sub-path and still be ours to clear. Asserting only
        // the exact-scope case let that widen to equality unnoticed.
        const below = `${HREF}play/`;
        expect(isLegacyWebXiangqiServiceWorker(
            registration(`${below}sw.js`, below), BASE, HREF,
        )).toBe(true);
    });

    it('spares the app’s own worker', () => {
        // The whole point of narrowing it. Unregistering this one would undo
        // cross-origin isolation on every load, and the only symptom would be a
        // site that is quietly single-threaded.
        expect(
            isLegacyWebXiangqiServiceWorker(registration(`${HREF}${APP_SERVICE_WORKER_FILENAME}`), BASE, HREF)
        ).toBe(false);
    });

    it('spares the app’s own worker even while it is still installing', () => {
        expect(isLegacyWebXiangqiServiceWorker(
            { scope: HREF, active: null, installing: { scriptURL: `${HREF}${APP_SERVICE_WORKER_FILENAME}` } },
            BASE,
            HREF
        )).toBe(false);
    });

    it('leaves other projects on the same origin alone', () => {
        // github.io is one origin for all of a user's Pages sites, so a worker
        // from a neighbouring project is reachable here and is not ours to remove.
        expect(isLegacyWebXiangqiServiceWorker(
            registration('https://example.github.io/other-project/sw.js', 'https://example.github.io/other-project/'),
            BASE,
            HREF
        )).toBe(false);
    });

    it('does not remove a worker that merely lives under the base path', () => {
        expect(isLegacyWebXiangqiServiceWorker(registration(`${HREF}some-other-worker.js`), BASE, HREF)).toBe(false);
    });
});

describe('cleaning up legacy runtime storage', () => {
    it('unregisters the demo worker and keeps the app’s', async () => {
        const unregistered: string[] = [];
        const make = (file: string) => ({
            scope: HREF,
            active: { scriptURL: `${HREF}${file}` },
            unregister: async () => { unregistered.push(file); return true; },
        });
        const result = await cleanupLegacyRuntimeStorage({
            serviceWorker: { getRegistrations: async () => [make('sw.js'), make(APP_SERVICE_WORKER_FILENAME)] },
            cacheStorage: { keys: async () => [], delete: async () => true },
            appBasePath: BASE,
            locationHref: HREF,
        });
        expect(unregistered).toEqual(['sw.js']);
        expect(result.registrationsChecked).toBe(2);
        expect(result.registrationsUnregistered).toBe(1);
    });

    it('deletes only the demo caches', async () => {
        const deleted: string[] = [];
        const result = await cleanupLegacyRuntimeStorage({
            serviceWorker: { getRegistrations: async () => [] },
            cacheStorage: {
                keys: async () => ['pikafish-demo-v3', 'xiangqi-app-v1', 'pikafish-demo-engine'],
                delete: async (key: string) => { deleted.push(key); return true; },
            },
            appBasePath: BASE,
            locationHref: HREF,
        });
        expect(deleted.sort()).toEqual(['pikafish-demo-engine', 'pikafish-demo-v3']);
        expect(result.cacheKeysDeleted).toBe(2);
    });

    it('never throws when the platform has no service worker support at all', async () => {
        const result = await cleanupLegacyRuntimeStorage({
            serviceWorker: {}, cacheStorage: {}, appBasePath: BASE, locationHref: HREF,
        });
        expect(result.registrationsUnregistered).toBe(0);
    });

    it('knows a demo cache key from any other', () => {
        expect(isLegacyRuntimeCacheKey('pikafish-demo-v1')).toBe(true);
        expect(isLegacyRuntimeCacheKey('workbox-precache')).toBe(false);
    });
});
