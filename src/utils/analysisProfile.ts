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

/**
 * The hash sizes a tier may be asked for, smallest first.
 *
 * The transposition table is the one engine resource a strong player expects to
 * set, and it matters more now that a search runs for a second or two rather
 * than nine milliseconds: a table that fills mid-search starts discarding work
 * the search is about to want again. `hashfull` in the engine dashboard is what
 * tells you the current size is too small.
 *
 * The ceiling per tier is a memory judgement, not a taste one. The core is
 * built with `MAXIMUM_MEMORY=2147483648`, and the NNUE alone is 53MB on top of
 * the engine itself, so the top of this ladder has to leave the module room to
 * grow into. A low-tier device is a phone and gets no ladder worth offering.
 */
const HASH_CHOICES_BY_TIER: Record<DeviceTier, readonly number[]> = {
    low: [16, 24, 48],
    mid: [32, 64, 128, 256],
    high: [64, 128, 256, 512],
};

export function hashChoicesForTier(tier: DeviceTier): readonly number[] {
    return HASH_CHOICES_BY_TIER[tier];
}

/**
 * An asked-for hash size, held inside what the tier allows.
 *
 * Anything outside the ladder falls back to the tier's default rather than to
 * the nearest rung, because a stored preference from another machine is a
 * statement about *that* machine and this one has its own default.
 */
export function resolveHashMB(tier: DeviceTier, requested: unknown, fallback: number): number {
    const wanted = Math.trunc(finiteNumber(requested, Number.NaN));
    return HASH_CHOICES_BY_TIER[tier].includes(wanted) ? wanted : fallback;
}

/**
 * The thread counts a machine may be asked for, smallest first.
 *
 * The tier already picks a sensible number -- cores less two, capped at
 * `MAX_ENGINE_THREADS` -- and the useful direction to override it is *down*:
 * an unplugged laptop, or a machine doing something else that matters more
 * than the search. Upward has nothing to offer, because the cap is the shipped
 * core's thread pool rather than a policy.
 *
 * Built from the tier's own choice so the ladder never offers a machine more
 * than it was going to take anyway, and always includes 1, which is the answer
 * to "stop the fans".
 */
export function threadChoicesForProfile(profile: DeviceProfile, allowThreads = true): readonly number[] {
    const ceiling = resolveEngineBootConfig(profile, { allowThreads }).threads;
    const rungs = [1, 2, 3, 4, 6, 8].filter((count) => count <= ceiling);
    if (!rungs.includes(ceiling)) rungs.push(ceiling);
    return rungs;
}

/** Whether a resolved variant is one that can hold more than one thread. */
export function isThreadedVariant(variant: EngineRuntimeVariant): boolean {
    return variant === 'threaded' || variant === 'threaded-simd';
}

export function resolveEngineBootConfig(
    profile: DeviceProfile,
    options: { allowSIMD?: boolean; allowThreads?: boolean; saferBoot?: boolean; hashMB?: number; threads?: number } = {}
): EngineBootConfig {
    const allowSIMD = options.allowSIMD !== false;
    const allowThreads = options.allowThreads !== false;

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

    // An explicit ask, held inside the tier's ladder. Applied before the safer
    // boot halves it, so a retry after a crash still backs off from whatever
    // was actually in use.
    hashMB = resolveHashMB(profile.tier, options.hashMB, hashMB);
    // Threads are checked against the tier's own number rather than a ladder,
    // because the ladder is derived *from* that number -- asking
    // threadChoicesForProfile here would recurse.
    const wantedThreads = Math.trunc(finiteNumber(options.threads, Number.NaN));
    if (Number.isFinite(wantedThreads) && wantedThreads >= 1 && wantedThreads <= threads) {
        threads = wantedThreads;
    }

    // Not a preference and not a fallback: on a page without cross-origin
    // isolation the threaded core cannot load, so this is the same answer the
    // wrapper is going to reach anyway. Resolving it here is what keeps the
    // dashboard and the thread picker honest -- they read this config.
    if (!allowThreads) {
        variant = resolveSingleVariant(allowSIMD);
        threads = 1;
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

    // Depth is a ceiling; `moveTimeMs` is the budget. A search stops at
    // whichever comes first, and these are set so that on the tier they belong
    // to it is the *time* -- which is the one that adapts to the position and
    // the machine, where a depth number does neither.
    //
    // They used to bind the other way round, and by a wide margin. Measured in
    // the browser on the threaded SIMD core at 8 threads, from the start
    // position, which is about the slowest position there is to search:
    //
    //     depth   8     12     14     16     18      20      22
    //     time    9ms   128ms  250ms  524ms  1054ms  1445ms  4944ms
    //
    // The high tier was capped at depth 12 with 1800ms to spend, so it finished
    // in 128ms and sat idle for the rest -- and the *default* Search Depth of 8
    // pulled it lower still, to a 9ms search, because the preference clamps
    // this. A whole second of the budget went unused on every position.
    const primaryByTier = {
        stable: {
            low: { depth: Math.min(12, normalizedDepth), moveTimeMs: 700 },
            mid: { depth: Math.min(16, normalizedDepth), moveTimeMs: 1000 },
            high: { depth: Math.min(18, normalizedDepth), moveTimeMs: 1200 },
        },
        optimized: {
            low: { depth: Math.min(14, normalizedDepth), moveTimeMs: 900 },
            mid: { depth: Math.min(18, normalizedDepth), moveTimeMs: 1400 },
            high: { depth: Math.min(22, normalizedDepth), moveTimeMs: 1800 },
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
            const depth = Math.min(22, normalizedDepth);
            deepen = { delayMs: 1200, depth, moveTimeMs: 2200, goCmd: buildGoCmd(depth, 2200) };
        } else if (input.tier === 'high') {
            const depth = Math.min(26, normalizedDepth);
            deepen = { delayMs: 1000, depth, moveTimeMs: 3200, goCmd: buildGoCmd(depth, 3200) };
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

/**
 * One position, thought about properly, because the user asked.
 *
 * Live analysis is budgeted to keep up with someone stepping through a game:
 * it has a second or two per position and has to be ready for the next one. The
 * thing it cannot do is the thing a strong player most often wants -- stop on
 * *this* position and go as deep as the machine can in a reasonable wait.
 *
 * A one-shot search rather than an infinite mode. `go infinite` returns no
 * `bestmove` until it is stopped, and several paths here wait on `bestmove`; a
 * bounded search settles on its own, so nothing has to remember to end it, and
 * the user can still stop it early.
 *
 * The time is the budget and the depth is a ceiling well past what the time
 * will reach, for the same reason as everywhere else in this module. Thirty
 * seconds is chosen to be long enough to be worth pressing and short enough
 * that nobody wonders whether it is stuck -- the search reports rising depth
 * throughout.
 */
export function resolveDeepDiveBudget(tier: DeviceTier): SearchBudget {
    const byTier = {
        low: { depth: 24, moveTimeMs: 10_000 },
        mid: { depth: 30, moveTimeMs: 20_000 },
        high: { depth: 36, moveTimeMs: 30_000 },
    } as const;
    const budget = byTier[tier];
    return { ...budget, goCmd: buildGoCmd(budget.depth, budget.moveTimeMs) };
}

export function resolveReviewPolicy(profile: DeviceProfile): ReviewPolicy {
    // Ceilings, as above -- but held lower than live analysis on purpose. A
    // review searches every unevaluated move in the game, so its depth is
    // multiplied by the length of the game in a way live analysis is not, and
    // the whole point of the pass is that it finishes while the player is still
    // looking at it. The revisit pass below is where the depth goes, on the few
    // moves that turned out to matter.
    const baseByTier = {
        low: { depth: 12, moveTimeMs: 900 },
        mid: { depth: 14, moveTimeMs: 1200 },
        high: { depth: 16, moveTimeMs: 1500 },
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

/**
 * Whether this page may run the threaded core at all.
 *
 * Threads need `SharedArrayBuffer`, and a browser only hands that out to a
 * cross-origin isolated page -- one served with COOP and COEP. `vite.config.ts`
 * sets both, so every dev server and every browser test in this repo is
 * isolated. **GitHub Pages sets neither, and cannot be made to**: it serves
 * static files with fixed headers. So the deployed app -- the only build a
 * player actually uses -- always lands here, and every check in this repo ran
 * on the other side of the branch.
 *
 * `templates/pikafish.js` already handles it correctly: `resolveVariant` drops
 * `threaded-simd` to `single-simd`, and `recommendedThreads` returns 1 for a
 * non-threaded core, so the engine really is asked for one thread. What was
 * missing is that *the app never knew*, and it is the app that draws the
 * dashboard and the thread picker. The deployed engine dashboard read
 * `single-simd` and `8T · 128MB` at the same time, and offered a thread ladder
 * on which every rung was 1.
 *
 * Mirrors the wrapper's `wasmThreadsSupported` rather than testing
 * `crossOriginIsolated` alone, because the guarantee wanted here is the one the
 * wrapper will act on: a shared `WebAssembly.Memory` that actually constructs.
 */
export function detectThreadSupport(): boolean {
    try {
        if (typeof SharedArrayBuffer !== 'function') return false;
        if (typeof Atomics !== 'object') return false;
        const memory = new WebAssembly.Memory({ shared: true, initial: 8, maximum: 16 } as WebAssembly.MemoryDescriptor);
        return memory.buffer instanceof SharedArrayBuffer;
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
