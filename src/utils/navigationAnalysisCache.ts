import { parseAnalysisTag } from './engineTags';
import type { EvalReading } from './engineEvalReading';
import type { PvLine, WdlStats } from '../hooks/useEngine';

export type CachedNavigationAnalysis = {
    bestMove: string;
    reading: EvalReading;
    lines: PvLine[];
    wdl: WdlStats | null;
};

/** Only completed automatic searches are reusable. History and budget are part of identity. */
export function navigationAnalysisKey(position: string, go: string, tag?: string): string | null {
    const analysis = parseAnalysisTag(tag ?? null);
    if (!analysis || analysis.phase === 'deep' || /\binfinite\b/.test(go)) return null;
    return JSON.stringify([position, go, tag]);
}

/** Session-local LRU; option changes and worker replacement clear it. */
export function createNavigationAnalysisCache(limit = 128) {
    const entries = new Map<string, CachedNavigationAnalysis>();
    return {
        clear: () => entries.clear(),
        get(key: string | null) {
            if (key === null) return undefined;
            const value = entries.get(key);
            if (value) { entries.delete(key); entries.set(key, value); }
            return value;
        },
        set(key: string, value: CachedNavigationAnalysis) {
            entries.delete(key);
            entries.set(key, value);
            while (entries.size > limit) entries.delete(entries.keys().next().value!);
        },
    };
}
