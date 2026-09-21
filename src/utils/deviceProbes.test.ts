import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCoarsePointer, detectDeviceScreen, detectSimdSupport, detectThreadSupport } from './analysisProfile';

/**
 * The two probes that decide which device this is.
 *
 * No unit test called either -- they read browser globals and the suite runs
 * in node -- so a mutation sweep of `analysisProfile.ts` reported every
 * operator in `detectCoarsePointer` as surviving. They are reachable by
 * stubbing, and worth reaching: a coarse pointer is one of the three things
 * that send a device to the low tier, so a probe that always answered `false`
 * would hand a phone a desktop's thread count and hash size and say nothing.
 */
afterEach(() => { vi.unstubAllGlobals(); });

const withWindow = (window: unknown) => vi.stubGlobal('window', window);

describe('detecting a coarse pointer', () => {
    it('asks for the pointer media feature by name', () => {
        const queries: string[] = [];
        withWindow({ matchMedia: (query: string) => { queries.push(query); return { matches: true }; } });
        expect(detectCoarsePointer()).toBe(true);
        expect(queries).toEqual(['(pointer: coarse)']);
    });

    it('reports a fine pointer as not coarse', () => {
        withWindow({ matchMedia: () => ({ matches: false }) });
        expect(detectCoarsePointer()).toBe(false);
    });

    it('answers no rather than throwing where matchMedia is missing', () => {
        withWindow({});
        expect(detectCoarsePointer()).toBe(false);
        withWindow(undefined);
        expect(detectCoarsePointer()).toBe(false);
    });
});

describe('measuring the device screen', () => {
    it('reads the screen rather than the viewport', () => {
        // A half-width window on a large monitor is still a large device; an
        // off-screen tab reports a zero viewport and would look like the
        // weakest device there is.
        withWindow({ screen: { width: 2560, height: 1440 }, innerWidth: 640, innerHeight: 400 });
        expect(detectDeviceScreen()).toEqual({ width: 2560, height: 1440 });
    });

    it('falls back to the viewport when the screen reports nothing usable', () => {
        withWindow({ screen: { width: 0, height: 0 }, innerWidth: 390, innerHeight: 844 });
        expect(detectDeviceScreen()).toEqual({ width: 390, height: 844 });
    });

    it('assumes a desktop where there is no window at all', () => {
        withWindow(undefined);
        expect(detectDeviceScreen()).toEqual({ width: 1280, height: 800 });
    });
});

/**
 * The two probes that decide what engine this device gets.
 *
 * `allowSIMD` and `allowThreads` pick the WASM variant and the thread count,
 * so between them they are the largest single influence on how hard this app
 * works a machine. Neither had a test.
 *
 * `detectThreadSupport` deliberately does not ask `crossOriginIsolated`: the
 * guarantee it needs is the one the engine wrapper will act on, which is a
 * shared `WebAssembly.Memory` that actually constructs. A page that is not
 * isolated can still expose `SharedArrayBuffer` and then hand back a
 * *non-shared* buffer, and that is the case worth pinning -- it is what a
 * GitHub Pages deploy without the COI worker looks like.
 */
describe('detecting engine capabilities', () => {
    const sharedMemory = { buffer: new SharedArrayBuffer(8) };

    it('reports threads when a shared memory really constructs', () => {
        vi.stubGlobal('WebAssembly', { Memory: function () { return sharedMemory; } });
        expect(detectThreadSupport()).toBe(true);
    });

    it('refuses threads when the buffer comes back unshared', () => {
        // Not cross-origin isolated: the constructor succeeds and quietly
        // gives an ordinary ArrayBuffer. Checking `typeof SharedArrayBuffer`
        // alone would call this device threaded and hang the engine.
        vi.stubGlobal('WebAssembly', { Memory: function () { return { buffer: new ArrayBuffer(8) }; } });
        expect(detectThreadSupport()).toBe(false);
    });

    it('refuses threads when the constructor throws', () => {
        vi.stubGlobal('WebAssembly', { Memory: function () { throw new Error('shared memory not allowed'); } });
        expect(detectThreadSupport()).toBe(false);
    });

    it.each(['SharedArrayBuffer', 'Atomics'])('refuses threads without %s', (missing) => {
        vi.stubGlobal('WebAssembly', { Memory: function () { return sharedMemory; } });
        vi.stubGlobal(missing, undefined);
        expect(detectThreadSupport()).toBe(false);
    });

    it('reports SIMD where the runtime validates the probe module', () => {
        expect(detectSimdSupport()).toBe(true);
    });

    it('refuses SIMD where it does not, and where validate throws', () => {
        vi.stubGlobal('WebAssembly', { validate: () => false });
        expect(detectSimdSupport()).toBe(false);
        vi.stubGlobal('WebAssembly', { validate: () => { throw new Error('no'); } });
        expect(detectSimdSupport()).toBe(false);
    });
});
