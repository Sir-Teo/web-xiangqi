import { describe, expect, it } from 'vitest';
import {
    detectDeviceTier,
    resolveEngineBootConfig,
    resolveLiveAnalysisPolicy,
} from './analysisProfile';

// deviceMemoryGB values are what a browser can actually report: the Device
// Memory API clamps to at most 8, so a fixture above that describes hardware
// no browser describes.
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

    it('does not read the reporting ceiling as a constraint', () => {
        // Every roomy machine reports exactly 8, so treating that as low
        // memory put the high tier out of reach in Chrome while Firefox,
        // which does not implement the API at all, reached it on the same
        // hardware.
        expect(detectDeviceTier({ ...DESKTOP, deviceMemoryGB: 8 }).tier).toBe('high');
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
        expect(resolveEngineBootConfig(detectDeviceTier(DESKTOP)).threads).toBe(3);
        expect(resolveEngineBootConfig(detectDeviceTier(LAPTOP)).threads).toBe(2);
        expect(resolveEngineBootConfig(detectDeviceTier(PHONE)).threads).toBe(1);
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
