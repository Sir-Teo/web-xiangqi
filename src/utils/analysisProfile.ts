export type DeviceTier = 'low' | 'mid' | 'high';
export type AnalysisMode = 'stable' | 'optimized';
export type EngineRuntimeVariant = 'auto' | 'threaded' | 'single' | 'threaded-simd' | 'single-simd';

export interface DeviceProfileInput {
    viewportWidth?: number;
    viewportHeight?: number;
    hardwareConcurrency?: number;
    deviceMemoryGB?: number;
    coarsePointer?: boolean;
}

export interface DeviceProfile {
    tier: DeviceTier;
    mobileLike: boolean;
    hardwareConcurrency: number;
    deviceMemoryGB: number;
    viewportWidth: number;
    viewportHeight: number;
    coarsePointer: boolean;
    signature: string;
}

export interface EngineBootConfig {
    tier: DeviceTier;
    mobileLike: boolean;
    variant: EngineRuntimeVariant;
    threads: number;
    hashMB: number;
    allowSIMD: boolean;
    saferBoot: boolean;
    signature: string;
}

interface SearchBudget {
    depth: number;
    moveTimeMs: number;
    goCmd: string;
}

export interface LiveAnalysisPolicy {
    tier: DeviceTier;
    mode: AnalysisMode;
    detailEnabled: boolean;
    debounceMs: number;
    primary: SearchBudget;
    deepen: (SearchBudget & { delayMs: number }) | null;
    signature: string;
}

export interface ReviewPolicy {
    tier: DeviceTier;
    base: SearchBudget;
    revisit: SearchBudget | null;
    revisitThreshold: number;
    revisitLimit: number;
    batchSize: number;
    flushMs: number;
    signature: string;
}

function hasLowMemory(deviceMemoryGB: number, maxGB: number) {
    return deviceMemoryGB > 0 && deviceMemoryGB <= maxGB;
}

function finiteNumber(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function buildGoCmd(depth: number, moveTimeMs: number) {
    return `go depth ${depth} movetime ${moveTimeMs}`;
}

function resolveSingleVariant(allowSIMD: boolean): EngineRuntimeVariant {
    return allowSIMD ? 'single-simd' : 'single';
}

function resolveThreadedVariant(allowSIMD: boolean): EngineRuntimeVariant {
    return allowSIMD ? 'threaded-simd' : 'threaded';
}

/** Cores kept back for the page, the compositor and everything else running. */
const CORES_RESERVED_FOR_THE_REST_OF_THE_MACHINE = 2;

/**
 * The hard ceiling on engine threads, and it comes from the *build*.
 *
 * `WASM_PTHREAD_POOL_SIZE` in `scripts/build-pikafish.sh` prewarms this many
 * pthread workers into the shipped core, and it is not merely a warm-up: the
 * engine runs inside a worker, so when Pikafish asks for more search threads
 * than the pool holds, the thread that asked blocks in `pthread_create` and
 * never returns to the event loop that would start the new worker. The engine
 * does not error -- it simply never answers `readyok`.
 *
 * So the number here is *not* a judgement about how much of the machine to
 * take. It mirrors the build, and `ENGINE_THREAD_HEADROOM` below is what keeps
 * an ask away from the edge of it.
 *
 * The pool was 4, which cost most of the machine's search. Measured under Node
 * on the rebuilt SIMD core, 18 cores, depth 20, 256MB hash:
 *
 *     threads   1     4      8      12
 *     nodes/s   448k  1.80M  3.51M  3.28M
 *
 * Eight threads is roughly twice four, and twelve is slower than eight on this
 * machine, so the ask stops at eight and the pool is built four above it.
 *
 * Raising this needs the build raised with it and the artifacts rebuilt --
 * `WASM_PTHREAD_POOL_SIZE=<n> npm run build`, which needs emsdk -- and the two
 * must move together. Anything asking for more threads than the shipped core
 * was built for hangs it.
 */
export const ENGINE_PTHREAD_POOL_SIZE = 12;

/**
 * How much of the pool is never asked for.
 *
 * The pool is what the core can hand out; asking for all of it leaves nothing
 * for a thread Pikafish wants for its own bookkeeping, and the failure mode is
 * the silent hang above rather than an error. The old code let a tier reach
 * the pool size exactly, which is why the ceiling and the pool were the same
 * number and there was nowhere to be wrong by one.
 */
export const ENGINE_THREAD_HEADROOM = 4;

/** The most threads any device may ask the shipped core for. */
export const MAX_ENGINE_THREADS = ENGINE_PTHREAD_POOL_SIZE - ENGINE_THREAD_HEADROOM;

export const MID_TIER_MAX_THREADS = 6;
export const HIGH_TIER_MAX_THREADS = 8;

/**
 * How many threads a machine with this many cores gets.
 *
 * Both tiers used to be a constant, so every desktop above the tier boundary
 * got 3 threads whether it had 9 cores or 64. The clamp to
 * The clamp to `MAX_ENGINE_THREADS` is here rather than at the call sites so
 * that no caller can raise a tier into the hang described above without also
 * raising the build.
 */
export function threadsForCores(hardwareConcurrency: number, min: number, max: number): number {
    const cores = Math.max(1, Math.trunc(finiteNumber(hardwareConcurrency, 1)));
    const usable = cores - CORES_RESERVED_FOR_THE_REST_OF_THE_MACHINE;
    const wanted = Math.max(min, Math.min(max, usable));
    return Math.max(1, Math.min(MAX_ENGINE_THREADS, wanted));
}

export function detectDeviceTier(input: DeviceProfileInput = {}): DeviceProfile {
    const viewportWidth = Math.max(0, Math.trunc(finiteNumber(input.viewportWidth, 1280)));
    const viewportHeight = Math.max(0, Math.trunc(finiteNumber(input.viewportHeight, 800)));
    const minViewport = Math.min(viewportWidth || 1280, viewportHeight || 800);
    const hardwareConcurrency = Math.max(1, Math.trunc(finiteNumber(input.hardwareConcurrency, 4)));
    const deviceMemoryGB = Math.max(0, finiteNumber(input.deviceMemoryGB, 0));
    const coarsePointer = Boolean(input.coarsePointer);
    const mobileLike = coarsePointer || minViewport < 700 || hasLowMemory(deviceMemoryGB, 4);

    let tier: DeviceTier;
    if (mobileLike || hardwareConcurrency <= 4 || hasLowMemory(deviceMemoryGB, 4)) {
        tier = 'low';
    } else if (hardwareConcurrency <= 8) {
        // No memory clause here. It used to be `|| hasLowMemory(memory, 8)`,
        // and browsers disagree about the top of navigator.deviceMemory's
        // range — the spec describes clamping it to limit fingerprinting, and
        // Chromium 148 was observed reporting 32 — so that clause put the same
        // machine in the mid tier under one browser and the high tier under
        // another. Anything genuinely short of memory has already gone to the
        // low tier above, on the 4GB test, where every browser agrees.
        tier = 'mid';
    } else {
        tier = 'high';
    }

    return {
        tier,
        mobileLike,
        hardwareConcurrency,
        deviceMemoryGB,
        viewportWidth,
        viewportHeight,
        coarsePointer,
        signature: `${tier}:${mobileLike ? 'mobile' : 'desktop'}:${hardwareConcurrency}:${deviceMemoryGB || 'na'}`,
    };
}

export function resolveEngineBootConfig(
    profile: DeviceProfile,
    options: { allowSIMD?: boolean; saferBoot?: boolean } = {}
): EngineBootConfig {
    const allowSIMD = options.allowSIMD !== false;

    let variant: EngineRuntimeVariant;
    let threads: number;
    let hashMB: number;

    if (profile.tier === 'low') {
        variant = resolveSingleVariant(allowSIMD);
        threads = 1;
        hashMB = hasLowMemory(profile.deviceMemoryGB, 4) ? 16 : 24;
    } else if (profile.tier === 'mid') {
        // Only the low tier is ever mobile-like, so the mid and high tiers are
        // always a pointer-and-keyboard machine with room for threads.
        variant = resolveThreadedVariant(allowSIMD);
        threads = threadsForCores(profile.hardwareConcurrency, 2, MID_TIER_MAX_THREADS);
        hashMB = 64;
    } else {
        variant = resolveThreadedVariant(allowSIMD);
        threads = threadsForCores(profile.hardwareConcurrency, 4, HIGH_TIER_MAX_THREADS);
        hashMB = 128;
    }

    if (options.saferBoot) {
        variant = resolveSingleVariant(allowSIMD);
        threads = 1;
        hashMB = Math.max(16, Math.floor(hashMB / 2));
    }

    return {
        tier: profile.tier,
        mobileLike: profile.mobileLike,
        variant,
        threads,
        hashMB,
        allowSIMD,
        saferBoot: Boolean(options.saferBoot),
        signature: `${profile.signature}:${variant}:${threads}:${hashMB}:${options.saferBoot ? 'safe' : 'normal'}`,
    };
}

export function resolveLiveAnalysisPolicy(input: {
    tier: DeviceTier;
    mode: AnalysisMode;
    searchDepth: number;
    detailEnabled: boolean;
}): LiveAnalysisPolicy {
    const normalizedDepth = Math.max(1, Math.trunc(input.searchDepth));
    const debounceMs = input.tier === 'low' ? 300 : 150;

    const primaryByTier = {
        stable: {
            low: { depth: Math.min(7, normalizedDepth), moveTimeMs: 700 },
            mid: { depth: Math.min(9, normalizedDepth), moveTimeMs: 1000 },
            high: { depth: Math.min(10, normalizedDepth), moveTimeMs: 1200 },
        },
        optimized: {
            low: { depth: Math.min(8, normalizedDepth), moveTimeMs: 900 },
            mid: { depth: Math.min(10, normalizedDepth), moveTimeMs: 1400 },
            high: { depth: Math.min(12, normalizedDepth), moveTimeMs: 1800 },
        },
    } as const;

    const primaryBudget = primaryByTier[input.mode][input.tier];
    const primary: SearchBudget = {
        ...primaryBudget,
        goCmd: buildGoCmd(primaryBudget.depth, primaryBudget.moveTimeMs),
    };

    let deepen: LiveAnalysisPolicy['deepen'] = null;
    if (input.mode === 'optimized' && input.detailEnabled) {
        if (input.tier === 'mid') {
            deepen = {
                delayMs: 1200,
                depth: Math.min(11, normalizedDepth),
                moveTimeMs: 2200,
                goCmd: buildGoCmd(Math.min(11, normalizedDepth), 2200),
            };
        } else if (input.tier === 'high') {
            deepen = {
                delayMs: 1000,
                depth: Math.min(14, normalizedDepth),
                moveTimeMs: 3200,
                goCmd: buildGoCmd(Math.min(14, normalizedDepth), 3200),
            };
        }
    }

    return {
        tier: input.tier,
        mode: input.mode,
        detailEnabled: input.detailEnabled,
        debounceMs,
        primary,
        deepen,
        signature: `${input.mode}:${input.tier}:${input.detailEnabled ? 'detail' : 'compact'}:${primary.depth}:${primary.moveTimeMs}:${deepen ? `${deepen.depth}:${deepen.moveTimeMs}` : 'nodeepen'}`,
    };
}

export function resolveReviewPolicy(profile: DeviceProfile): ReviewPolicy {
    const baseByTier = {
        low: { depth: 8, moveTimeMs: 900 },
        mid: { depth: 9, moveTimeMs: 1200 },
        high: { depth: 10, moveTimeMs: 1500 },
    } as const;

    const baseBudget = baseByTier[profile.tier];
    const base: SearchBudget = {
        ...baseBudget,
        goCmd: buildGoCmd(baseBudget.depth, baseBudget.moveTimeMs),
    };

    let revisit: SearchBudget | null = null;
    if (profile.tier === 'mid') {
        revisit = {
            depth: base.depth + 2,
            moveTimeMs: base.moveTimeMs + 1200,
            goCmd: buildGoCmd(base.depth + 2, base.moveTimeMs + 1200),
        };
    } else if (profile.tier === 'high') {
        revisit = {
            depth: base.depth + 2,
            moveTimeMs: base.moveTimeMs + 1500,
            goCmd: buildGoCmd(base.depth + 2, base.moveTimeMs + 1500),
        };
    }

    return {
        tier: profile.tier,
        base,
        revisit,
        revisitThreshold: 220,
        revisitLimit: 4,
        batchSize: 4,
        flushMs: 250,
        signature: `${profile.signature}:review:${base.depth}:${base.moveTimeMs}:${revisit ? `${revisit.depth}:${revisit.moveTimeMs}` : 'norevisit'}`,
    };
}

/**
 * Reading the machine, rather than the window, for every caller that needs it.
 *
 * These three lived in App.tsx while `useEngine` kept a second, contradictory
 * copy of the same judgement: it sized the engine from `window.innerWidth <=
 * 900`, which App.tsx's own comment explains is wrong -- min(width, height)
 * crosses the mobile threshold whenever a desktop window is made short, or
 * devtools is opened, and the engine reboots single-threaded on hardware that
 * has not changed. An off-screen tab reports 0 and looks like the weakest
 * device there is. The two policies disagreed by 3x on threads on the machine
 * this was written on.
 *
 * `screen` describes the device, and min() of its two sides is the same in
 * either orientation.
 */
export function detectCoarsePointer(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: coarse)').matches;
}

export function detectDeviceScreen(): { width: number; height: number } {
    if (typeof window === 'undefined' || typeof window.screen === 'undefined') {
        return { width: 1280, height: 800 };
    }
    return {
        width: Number(window.screen.width) || window.innerWidth,
        height: Number(window.screen.height) || window.innerHeight,
    };
}

export function detectSimdSupport(): boolean {
    try {
        return WebAssembly.validate(new Uint8Array([
            0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
            10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
        ]));
    } catch {
        return false;
    }
}

/** The device profile this machine gets, read from the device itself. */
export function detectDeviceProfile(): DeviceProfile {
    const screenSize = detectDeviceScreen();
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    return detectDeviceTier({
        viewportWidth: screenSize.width,
        viewportHeight: screenSize.height,
        hardwareConcurrency: nav ? Number(nav.hardwareConcurrency) : undefined,
        deviceMemoryGB: nav ? Number((nav as Navigator & { deviceMemory?: number }).deviceMemory ?? 0) : undefined,
        coarsePointer: detectCoarsePointer(),
    });
}

/**
 * The boot config for this machine. The single place any caller should reach
 * for when it has not been handed one.
 */
export function detectEngineBootConfig(options: { saferBoot?: boolean } = {}): EngineBootConfig {
    return resolveEngineBootConfig(detectDeviceProfile(), {
        allowSIMD: detectSimdSupport(),
        saferBoot: options.saferBoot,
    });
}
