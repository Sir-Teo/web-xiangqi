import { describe, expect, it } from 'vitest';
import {
    ENGINE_PTHREAD_POOL_SIZE,
    ENGINE_THREAD_HEADROOM,
    HIGH_TIER_MAX_THREADS,
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
