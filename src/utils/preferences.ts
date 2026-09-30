/**
 * Everything the app remembers about how a reader likes it: the shape of the
 * record, the guards that decide which stored values are still meaningful, and
 * the four calls that move it in and out of `localStorage`.
 *
 * Split out of `App.tsx` because none of it is React. It is a parser for
 * untrusted text -- the record can be hand-edited, written by an older build,
 * or carried between machines -- and a parser is worth being able to test on
 * its own rather than only through a rendered board.
 *
 * The contract every reader of this module depends on: a malformed record is
 * never an error, it is an empty one. A preference that cannot be understood
 * is dropped and the app falls back to its default, so one bad key can never
 * cost a reader the rest of their settings.
 */
import type { BoardOrientation } from '../components/Board/Board';
import type { AiSpeed } from '../components/Controls/WatchControls';
import { isAiStrength, type AiStrength } from './aiOpponent';
import { isNotationStyle, type XiangqiNotationStyle } from './xiangqiNotation';
import { isPieceStyle, type PieceStyle } from './pieceStyle';
import { PREFERENCES_STORAGE_KEY, readVersionedStorage } from './storageKeys';

export type AssistMode = 'coach' | 'pro';
export type AnalysisEngineMode = 'stable' | 'optimized';
export type PvLineCount = 1 | 3 | 5;
/** How long a deep search runs: the tier's bounded budget, or until stopped. */
export type DeepSearchMode = 'bounded' | 'infinite';

export const MAX_PREFERENCES_JSON_LENGTH = 4096;

export type StoredPreferences = {
  uiDensity?: 'comfortable' | 'compact';
  assistMode?: AssistMode;
  orientation?: BoardOrientation;
  showArrows?: boolean;
  soundEnabled?: boolean;
  searchDepth?: number;
  engineHashMB?: number;
  engineThreads?: number;
  analysisEngineMode?: AnalysisEngineMode;
  enginePvLineCount?: PvLineCount;
  aiStrength?: AiStrength;
  aiSpeed?: AiSpeed;
  notationStyle?: XiangqiNotationStyle;
  pieceStyle?: PieceStyle;
  deepSearchMode?: DeepSearchMode;
  cloudBookEnabled?: boolean;
};

export function isAssistMode(value: unknown): value is AssistMode {
  return value === 'coach' || value === 'pro';
}

export function isBoardOrientation(value: unknown): value is BoardOrientation {
  return value === 'red' || value === 'black';
}

export function isAnalysisEngineMode(value: unknown): value is AnalysisEngineMode {
  return value === 'stable' || value === 'optimized';
}

export function isAiSpeed(value: unknown): value is AiSpeed {
  return value === 'slow' || value === 'normal' || value === 'fast' || value === 'step';
}

export function isDeepSearchMode(value: unknown): value is DeepSearchMode {
  return value === 'bounded' || value === 'infinite';
}

export function isPvLineCount(value: unknown): value is PvLineCount {
  return value === 1 || value === 3 || value === 5;
}

/**
 * A number the record can actually have meant. `Number()` alone is too
 * generous here: `Number(null)` is 0 and `Number(true)` is 1, both finite, so
 * a record carrying `"searchDepth": null` came back as depth 1 -- the slowest
 * search the engine offers -- rather than falling back to the default. Only a
 * number, or the string spelling of one that a hand-edited record might hold,
 * counts.
 */
function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'string') {
    if (value.trim() === '') return undefined;
  } else if (typeof value !== 'number') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeStoredPreferencesValue(raw: string | null): StoredPreferences {
  if (!raw) return {};
  try {
    if (raw.length > MAX_PREFERENCES_JSON_LENGTH) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const searchDepth = asFiniteNumber(record.searchDepth);
    const engineHashMB = asFiniteNumber(record.engineHashMB);
    const engineThreads = asFiniteNumber(record.engineThreads);
    return {
      uiDensity: record.uiDensity === 'comfortable' || record.uiDensity === 'compact' ? record.uiDensity : undefined,
      assistMode: isAssistMode(record.assistMode) ? record.assistMode : undefined,
      orientation: isBoardOrientation(record.orientation) ? record.orientation : undefined,
      showArrows: typeof record.showArrows === 'boolean' ? record.showArrows : undefined,
      soundEnabled: typeof record.soundEnabled === 'boolean' ? record.soundEnabled : undefined,
      searchDepth: searchDepth === undefined ? undefined : Math.max(1, Math.min(24, Math.trunc(searchDepth))),
      // Not clamped here: which sizes are allowed is the tier's business, and
      // resolveEngineBootConfig drops anything off this machine's ladder back
      // to its own default. A value saved on another machine is a statement
      // about that machine.
      engineHashMB: engineHashMB === undefined ? undefined : Math.trunc(engineHashMB),
      engineThreads: engineThreads === undefined ? undefined : Math.trunc(engineThreads),
      analysisEngineMode: isAnalysisEngineMode(record.analysisEngineMode) ? record.analysisEngineMode : undefined,
      enginePvLineCount: isPvLineCount(record.enginePvLineCount) ? record.enginePvLineCount : undefined,
      aiStrength: isAiStrength(record.aiStrength) ? record.aiStrength : undefined,
      aiSpeed: isAiSpeed(record.aiSpeed) ? record.aiSpeed : undefined,
      notationStyle: isNotationStyle(record.notationStyle) ? record.notationStyle : undefined,
      pieceStyle: isPieceStyle(record.pieceStyle) ? record.pieceStyle : undefined,
      deepSearchMode: isDeepSearchMode(record.deepSearchMode) ? record.deepSearchMode : undefined,
      cloudBookEnabled: typeof record.cloudBookEnabled === 'boolean' ? record.cloudBookEnabled : undefined,
    };
  } catch {
    return {};
  }
}

export function readStoredPreferences(): StoredPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = readVersionedStorage(PREFERENCES_STORAGE_KEY);
    return normalizeStoredPreferencesValue(raw);
  } catch {
    return {};
  }
}

export function writeStoredPreferences(preferences: StoredPreferences) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are a convenience; storage failures should never interrupt play.
  }
}

export function clearStoredPreferences() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  } catch {
    // Ignore storage failures for the same reason.
  }
}
