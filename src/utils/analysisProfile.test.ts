import { describe, expect, it } from 'vitest';
import {
    ENGINE_PTHREAD_POOL_SIZE,
    ENGINE_THREAD_HEADROOM,
    HIGH_TIER_MAX_THREADS,
    hashChoicesForTier,
    resolveDeepDiveBudget,
    threadChoicesForProfile,
    isThreadedVariant,
    MAX_ENGINE_THREADS,
    detectDeviceTier,
    resolveEngineBootConfig,
    resolveLiveAnalysisPolicy,
    threadsForCores,
} from './analysisProfile';

// 8 is the low end of what a roomy machine reports. Browsers disagree about
// the top of this range — the spec describes clamping to 8, and Chromium 148
// was seen reporting 32 — so the fixtures use 8, the value that used to be
// sorted as constrained, and a test below pins that 8 and 32 agree.
const DESKTOP = { viewportWidth: 1680, viewportHeight: 1050, hardwareConcurrency: 16, deviceMemoryGB: 8 };
const LAPTOP = { viewportWidth: 1440, viewportHeight: 900, hardwareConcurrency: 8, deviceMemoryGB: 8 };
const PHONE = { viewportWidth: 390, viewportHeight: 844, hardwareConcurrency: 6, deviceMemoryGB: 4, coarsePointer: true };

describe('device tiering', () => {
    it('separates a workstation, a laptop, and a phone', () => {
        expect(detectDeviceTier(DESKTOP).tier).toBe('high');
        expect(detectDeviceTier(LAPTOP).tier).toBe('mid');
        expect(detectDeviceTier(PHONE).tier).toBe('low');
    });

    it('treats a coarse pointer or a narrow viewport as mobile', () => {
        expect(detectDeviceTier(PHONE).mobileLike).toBe(true);
        expect(detectDeviceTier({ ...DESKTOP, coarsePointer: true }).mobileLike).toBe(true);
        expect(detectDeviceTier({ ...DESKTOP, viewportWidth: 600 }).mobileLike).toBe(true);
        expect(detectDeviceTier(DESKTOP).mobileLike).toBe(false);
    });

    it('drops to the low tier on little memory however many cores there are', () => {
        expect(detectDeviceTier({ ...DESKTOP, deviceMemoryGB: 4 }).tier).toBe('low');
        expect(detectDeviceTier({ ...DESKTOP, deviceMemoryGB: 2 }).tier).toBe('low');
        expect(detectDeviceTier({ ...DESKTOP, hardwareConcurrency: 4 }).tier).toBe('low');
    });

    it('sorts the same machine the same way whatever the browser reports', () => {
        // Browsers disagree about the top of navigator.deviceMemory's range,
        // so 8 and 32 can be the same hardware seen twice. Both must land on
        // the same tier, or the engine is sized by browser rather than by
        // machine. Nothing reported at all has to agree with them too.
        expect(detectDeviceTier({ ...DESKTOP, deviceMemoryGB: 8 }).tier).toBe('high');
        expect(detectDeviceTier({ ...DESKTOP, deviceMemoryGB: 32 }).tier).toBe('high');
        expect(detectDeviceTier({ ...DESKTOP, deviceMemoryGB: 0 }).tier).toBe('high');
        expect(detectDeviceTier({ ...DESKTOP, hardwareConcurrency: 32, deviceMemoryGB: 8 }).tier).toBe('high');
    });

    it('falls back to a mid-range desktop when the browser tells us nothing', () => {
        const unknown = detectDeviceTier();
        expect(unknown.hardwareConcurrency).toBe(4);
        expect(unknown.viewportWidth).toBe(1280);
        expect(unknown.deviceMemoryGB).toBe(0);
        expect(unknown.mobileLike).toBe(false);
    });

    it('ignores nonsense readings instead of propagating NaN', () => {
        const profile = detectDeviceTier({
            viewportWidth: Number.NaN,
            hardwareConcurrency: Number.POSITIVE_INFINITY,
            deviceMemoryGB: Number.NaN,
        });
        expect(Number.isFinite(profile.hardwareConcurrency)).toBe(true);
        expect(Number.isFinite(profile.viewportWidth)).toBe(true);
        expect(profile.signature).not.toContain('NaN');
    });

    it('gives matching devices the same signature and differing ones different', () => {
        expect(detectDeviceTier(LAPTOP).signature).toBe(detectDeviceTier(LAPTOP).signature);
        expect(detectDeviceTier(LAPTOP).signature).not.toBe(detectDeviceTier(DESKTOP).signature);
    });
});

describe('engine boot configuration', () => {
    it('only asks for threads on a roomy desktop', () => {
        expect(resolveEngineBootConfig(detectDeviceTier(DESKTOP)).threads).toBe(8);
        expect(resolveEngineBootConfig(detectDeviceTier(LAPTOP)).threads).toBe(6);
        expect(resolveEngineBootConfig(detectDeviceTier(PHONE)).threads).toBe(1);
    });

    it('scales with the cores instead of handing every desktop the same number', () => {
        // Both tiers used to be a constant, so a 9-core machine and a 64-core
        // machine were sized identically.
        const nine = resolveEngineBootConfig(detectDeviceTier({ ...DESKTOP, hardwareConcurrency: 9 }));
        const sixtyFour = resolveEngineBootConfig(detectDeviceTier({ ...DESKTOP, hardwareConcurrency: 64 }));
        expect(nine.threads).toBeGreaterThan(1);
        expect(sixtyFour.threads).toBeGreaterThanOrEqual(nine.threads);
    });

    it('never asks for more threads than the shipped core was built to hold', () => {
        // Past the pool the engine blocks in pthread_create and never answers
        // readyok -- it does not error, it just never becomes ready. No device
        // may reach that, and none may reach the edge of it either: the ask
        // stops ENGINE_THREAD_HEADROOM below the pool.
        const enormous = [16, 32, 64, 128, 1024];
        for (const hardwareConcurrency of enormous) {
            const config = resolveEngineBootConfig(detectDeviceTier({ ...DESKTOP, hardwareConcurrency }));
            expect(config.threads).toBeLessThanOrEqual(MAX_ENGINE_THREADS);
        }
        expect(threadsForCores(1024, 8, 64)).toBeLessThanOrEqual(MAX_ENGINE_THREADS);
    });

    it('keeps the ask clear of the pool the core was built with', () => {
        // The two numbers used to be the same, so a tier could ask for the
        // whole pool and there was nowhere to be wrong by one.
        expect(MAX_ENGINE_THREADS).toBe(ENGINE_PTHREAD_POOL_SIZE - ENGINE_THREAD_HEADROOM);
        expect(ENGINE_THREAD_HEADROOM).toBeGreaterThan(0);
        expect(MAX_ENGINE_THREADS).toBeGreaterThanOrEqual(HIGH_TIER_MAX_THREADS);
    });

    it('leaves cores for the rest of the machine', () => {
        // A 6-core machine gives the engine 4, not 6.
        expect(threadsForCores(6, 1, 16)).toBe(4);
        expect(threadsForCores(2, 1, 16)).toBe(1);
        expect(threadsForCores(1, 1, 16)).toBe(1);
    });

    it('keeps a phone single-threaded however many cores it reports', () => {
        // A mobile-like device is always the low tier, so a fast phone still
        // boots the single-threaded core. resolveEngineBootConfig relies on
        // that invariant, so pin it here rather than in passing.
        const strongPhone = detectDeviceTier({ ...DESKTOP, coarsePointer: true });
        expect(strongPhone.mobileLike).toBe(true);
        expect(strongPhone.tier).toBe('low');

        const config = resolveEngineBootConfig(strongPhone);
        expect(config.threads).toBe(1);
        expect(config.variant).toBe('single-simd');
    });

    it('never reports a mobile-like device above the low tier', () => {
        const mobileInputs = [
            PHONE,
            { ...DESKTOP, coarsePointer: true },
            { ...DESKTOP, viewportWidth: 600 },
            { ...LAPTOP, deviceMemoryGB: 3 },
        ];
        for (const input of mobileInputs) {
            const profile = detectDeviceTier(input);
            expect(profile.mobileLike).toBe(true);
            expect(profile.tier).toBe('low');
        }
    });

    it('picks the plain core when SIMD is unavailable', () => {
        expect(resolveEngineBootConfig(detectDeviceTier(DESKTOP), { allowSIMD: false }).variant).toBe('threaded');
        expect(resolveEngineBootConfig(detectDeviceTier(PHONE), { allowSIMD: false }).variant).toBe('single');
    });

    it('defaults the desktop tiers to a table a deep search does not fill', () => {
        // Measured on the high tier at 128MB: hashfull 94% fifteen seconds into
        // the thirty-second deep search, 100% at the end. The defaults are the
        // next rung up on each ladder, and still not the top of it.
        const high = resolveEngineBootConfig(detectDeviceTier(DESKTOP));
        expect(high.tier).toBe('high');
        expect(high.hashMB).toBe(256);
        expect(hashChoicesForTier('high').indexOf(256)).toBeLessThan(hashChoicesForTier('high').length - 1);
        const mid = resolveEngineBootConfig(detectDeviceTier({ ...DESKTOP, hardwareConcurrency: 8 }));
        expect(mid.tier).toBe('mid');
        expect(mid.hashMB).toBe(128);
    });

    it('retreats to one thread and half the hash after a bad boot', () => {
        const normal = resolveEngineBootConfig(detectDeviceTier(DESKTOP));
        const safer = resolveEngineBootConfig(detectDeviceTier(DESKTOP), { saferBoot: true });
        expect(safer.threads).toBe(1);
        expect(safer.variant).toBe('single-simd');
        expect(safer.hashMB).toBeLessThan(normal.hashMB);
        expect(safer.hashMB).toBeGreaterThanOrEqual(16);
        expect(safer.signature).not.toBe(normal.signature);
    });

    it('never hands the engine less than 16MB of hash', () => {
        for (const input of [DESKTOP, LAPTOP, PHONE, { ...DESKTOP, deviceMemoryGB: 2 }]) {
            for (const saferBoot of [false, true]) {
                const config = resolveEngineBootConfig(detectDeviceTier(input), { saferBoot });
                expect(config.hashMB).toBeGreaterThanOrEqual(16);
                expect(config.threads).toBeGreaterThanOrEqual(1);
            }
        }
    });
});

describe('live analysis policy', () => {
    const base = { mode: 'stable' as const, searchDepth: 12, detailEnabled: true };

    it('waits longer before searching on a slow device', () => {
        expect(resolveLiveAnalysisPolicy({ ...base, tier: 'low' }).debounceMs)
            .toBeGreaterThan(resolveLiveAnalysisPolicy({ ...base, tier: 'high' }).debounceMs);
    });

    it('never asks for more depth than the user requested', () => {
        for (const tier of ['low', 'mid', 'high'] as const) {
            const policy = resolveLiveAnalysisPolicy({ ...base, tier, searchDepth: 3 });
            expect(policy.primary.depth).toBeLessThanOrEqual(3);
            expect(policy.primary.depth).toBeGreaterThanOrEqual(1);
        }
    });

    it('builds a go command that matches the budget it reports', () => {
        const policy = resolveLiveAnalysisPolicy({ ...base, tier: 'high' });
        expect(policy.primary.goCmd).toBe(`go depth ${policy.primary.depth} movetime ${policy.primary.moveTimeMs}`);
    });

    it('refuses a depth below one however odd the request', () => {
        const policy = resolveLiveAnalysisPolicy({ ...base, tier: 'mid', searchDepth: 0 });
        expect(policy.primary.depth).toBeGreaterThanOrEqual(1);
    });
});

describe('one sizing policy, read from the machine', () => {
    /**
     * `useEngine` used to keep its own copy of this judgement, deciding threads
     * and hash from `window.innerWidth <= 900`. These pin the two properties
     * that copy got wrong, so a future one cannot come back quietly.
     */
    it('does not shrink the engine because the window is short', () => {
        const desktop = { hardwareConcurrency: 18, deviceMemoryGB: 32, coarsePointer: false };
        const wide = detectDeviceTier({ ...desktop, viewportWidth: 1600, viewportHeight: 1000 });
        const short = detectDeviceTier({ ...desktop, viewportWidth: 1600, viewportHeight: 720 });

        expect(wide.tier).toBe('high');
        expect(short.tier, 'a short desktop window is the same machine').toBe('high');
        expect(resolveEngineBootConfig(short).threads).toBe(resolveEngineBootConfig(wide).threads);
    });

    it('does not read an unmeasured viewport as the weakest device there is', () => {
        // An off-screen or not-yet-laid-out tab reports 0x0. The window-based
        // policy read that as the smallest possible screen and booted one
        // thread; this one falls back to a desktop-shaped default.
        const unmeasured = detectDeviceTier({
            viewportWidth: 0,
            viewportHeight: 0,
            hardwareConcurrency: 18,
            deviceMemoryGB: 32,
            coarsePointer: false,
        });

        expect(unmeasured.mobileLike).toBe(false);
        expect(unmeasured.tier).toBe('high');
        expect(resolveEngineBootConfig(unmeasured).threads).toBeGreaterThan(1);
    });
});

describe('the engine hash a device may be asked for', () => {
    it('offers a ladder that grows with the tier', () => {
        expect(hashChoicesForTier('low')).toEqual([16, 24, 48]);
        expect(hashChoicesForTier('mid')).toEqual([32, 64, 128, 256]);
        expect(hashChoicesForTier('high')).toEqual([64, 128, 256, 512]);
    });

    it('honours a size the tier offers', () => {
        const config = resolveEngineBootConfig(detectDeviceTier(DESKTOP), { hashMB: 512 });
        expect(config.hashMB).toBe(512);
    });

    it('falls back to the tier default rather than to the nearest rung', () => {
        // A preference saved on another machine is a statement about *that*
        // machine, so a size this tier does not offer is not clamped into it.
        const desktop = detectDeviceTier(DESKTOP);
        const untouched = resolveEngineBootConfig(desktop).hashMB;
        expect(resolveEngineBootConfig(desktop, { hashMB: 4096 }).hashMB).toBe(untouched);
        expect(resolveEngineBootConfig(desktop, { hashMB: 100 }).hashMB).toBe(untouched);
        expect(resolveEngineBootConfig(desktop, { hashMB: Number.NaN }).hashMB).toBe(untouched);
        expect(resolveEngineBootConfig(desktop, { hashMB: undefined }).hashMB).toBe(untouched);
    });

    it('still backs off from whatever was in use when a boot has to be retried', () => {
        const safer = resolveEngineBootConfig(detectDeviceTier(DESKTOP), { hashMB: 512, saferBoot: true });
        expect(safer.hashMB).toBe(256);
        expect(safer.threads).toBe(1);
    });

    it('never offers a phone a size a phone should not take', () => {
        for (const size of hashChoicesForTier('low')) expect(size).toBeLessThanOrEqual(48);
    });
});

describe('a deep dive on one position', () => {
    it('gives every tier far more time than live analysis has', () => {
        for (const tier of ['low', 'mid', 'high'] as const) {
            const deep = resolveDeepDiveBudget(tier);
            const live = resolveLiveAnalysisPolicy({ tier, mode: 'optimized', searchDepth: 99, detailEnabled: true });
            expect(deep.moveTimeMs).toBeGreaterThan(live.primary.moveTimeMs * 5);
            expect(deep.depth).toBeGreaterThan(live.primary.depth);
        }
    });

    it('is bounded, so it settles without anyone having to stop it', () => {
        // `go infinite` returns no bestmove until stopped, and paths here wait
        // on bestmove.
        for (const tier of ['low', 'mid', 'high'] as const) {
            const deep = resolveDeepDiveBudget(tier);
            expect(deep.goCmd).toMatch(/^go depth \d+ movetime \d+$/);
            expect(deep.goCmd).not.toContain('infinite');
            expect(deep.moveTimeMs).toBeLessThanOrEqual(30_000);
        }
    });

    it('scales with the tier', () => {
        expect(resolveDeepDiveBudget('high').moveTimeMs).toBeGreaterThan(resolveDeepDiveBudget('mid').moveTimeMs);
        expect(resolveDeepDiveBudget('mid').moveTimeMs).toBeGreaterThan(resolveDeepDiveBudget('low').moveTimeMs);
    });
});

describe('the engine threads a machine may be asked for', () => {
    it('offers a ladder that stops at what the tier already chose', () => {
        // Upward has nothing to offer: the ceiling is the shipped core's thread
        // pool, not a policy, so overriding can only go down.
        const desktop = detectDeviceTier(DESKTOP);
        const ceiling = resolveEngineBootConfig(desktop).threads;
        const choices = threadChoicesForProfile(desktop);
        expect(choices[choices.length - 1]).toBe(ceiling);
        expect(Math.max(...choices)).toBeLessThanOrEqual(MAX_ENGINE_THREADS);
    });

    it('always offers one, which is the answer to "stop the fans"', () => {
        for (const device of [DESKTOP, LAPTOP, PHONE]) {
            expect(threadChoicesForProfile(detectDeviceTier(device))).toContain(1);
        }
    });

    it('honours a count the machine offers', () => {
        const config = resolveEngineBootConfig(detectDeviceTier(DESKTOP), { threads: 2 });
        expect(config.threads).toBe(2);
    });

    it('ignores a count above what the machine was going to take', () => {
        const desktop = detectDeviceTier(DESKTOP);
        const untouched = resolveEngineBootConfig(desktop).threads;
        expect(resolveEngineBootConfig(desktop, { threads: 64 }).threads).toBe(untouched);
        expect(resolveEngineBootConfig(desktop, { threads: 0 }).threads).toBe(untouched);
        expect(resolveEngineBootConfig(desktop, { threads: Number.NaN }).threads).toBe(untouched);
    });

    it('offers a phone nothing to choose between', () => {
        // The low tier is single-threaded, so there is no ladder to show.
        expect(threadChoicesForProfile(detectDeviceTier(PHONE))).toEqual([1]);
    });

    it('still drops to one thread on a safer boot', () => {
        expect(resolveEngineBootConfig(detectDeviceTier(DESKTOP), { threads: 4, saferBoot: true }).threads).toBe(1);
    });
});

/**
 * The deployed app is the one nothing had run.
 *
 * `vite.config.ts` sends COOP and COEP, so every dev server and every browser
 * test in this repo is cross-origin isolated and takes the threaded branch.
 * GitHub Pages sends neither and cannot be configured to, so the build a player
 * actually loads takes the other one -- and the app had no notion of it. The
 * engine was fine (the wrapper drops to a single core and asks for one thread);
 * what was wrong was everything the app drew from a config that still said
 * eight. The dashboard read `single-simd` and `8T` together.
 */
describe('a page that is not cross-origin isolated', () => {
    it('runs the single-threaded core whatever the machine is', () => {
        for (const device of [DESKTOP, LAPTOP, PHONE]) {
            const config = resolveEngineBootConfig(detectDeviceTier(device), { allowThreads: false });
            expect(isThreadedVariant(config.variant), JSON.stringify(device)).toBe(false);
            expect(config.threads, JSON.stringify(device)).toBe(1);
        }
    });

    it('keeps SIMD, which does not need isolation', () => {
        const config = resolveEngineBootConfig(detectDeviceTier(DESKTOP), { allowThreads: false });
        expect(config.variant).toBe('single-simd');
    });

    it('still honours an explicit request for a smaller hash', () => {
        // Hash is a memory choice and has nothing to do with threads.
        const config = resolveEngineBootConfig(detectDeviceTier(DESKTOP), { allowThreads: false, hashMB: 64 });
        expect(config.hashMB).toBe(64);
    });

    it('offers no thread ladder, because every rung would be one', () => {
        expect(threadChoicesForProfile(detectDeviceTier(DESKTOP), false)).toEqual([1]);
        expect(threadChoicesForProfile(detectDeviceTier(LAPTOP), false)).toEqual([1]);
    });

    it('leaves the isolated case exactly as it was', () => {
        const isolated = resolveEngineBootConfig(detectDeviceTier(DESKTOP), { allowThreads: true });
        expect(isolated).toEqual(resolveEngineBootConfig(detectDeviceTier(DESKTOP)));
        expect(isThreadedVariant(isolated.variant)).toBe(true);
        expect(isolated.threads).toBeGreaterThan(1);
    });
});
