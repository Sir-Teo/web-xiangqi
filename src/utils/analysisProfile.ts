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
        threads = 2;
        hashMB = 32;
    } else {
        variant = resolveThreadedVariant(allowSIMD);
        threads = 3;
        hashMB = 64;
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
