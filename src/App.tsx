import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Board } from './components/Board/Board';
import { EvalBar } from './components/Board/EvalBar';
import type { BoardOrientation } from './components/Board/Board';
import { EvalGraph } from './components/Panels/EvalGraph';
import { ReviewPanel } from './components/Panels/ReviewPanel';
import { WatchControls } from './components/Controls/WatchControls';
import type { AiSpeed } from './components/Controls/WatchControls';
import { MoveListTree } from './components/Controls/MoveListTree';
import {
  IconSettings, IconRefresh, IconFlip, IconBarChart, IconTree,
  IconBot, IconX, IconPause, IconPlay, IconSave, IconLibrary, IconArrow,
  IconPawn, IconCheck, IconCopy, IconLink, IconDownload, IconUpload, IconSkipBack, IconChevronLeft, IconChevronRight,
  IconSkipForward, IconMore, IconSearch, IconTarget, IconSpark
} from './components/icons';
import { useEngine, type EngineSearchStats, type PvLine, type WdlStats } from './hooks/useEngine';
import { formatEngineDownload, formatEngineDownloadShort } from './utils/engineAssetProgress';
import { useXiangqi, type GameResult, type MoveRecord, type MoveTreeSnapshot } from './hooks/useXiangqi';
import { START_FEN, hasAnyLegalMove, parseFenBoard, pieceSide, squareToUci, uciToSquare, validatePieceMove, type Side } from './utils/xiangqi';
import { WdlBar } from './components/Panels/WdlBar';
import { playMoveSound, playCaptureSound, playCheckSound, unlockSoundEffects } from './utils/sounds';
import { formatMoveRuleHint } from './utils/moveRuleHints';
import { isPieceCode, summarizeMaterial, type PieceCode } from './utils/material';
import { serializeSavedMoveTree } from './utils/savedMoveTree';
import { rovingIndexForKey, rovingTabStopIndex } from './utils/rovingFocus';
import { pgnDownloadFilename } from './utils/pgnFilename';
import {
  DEFAULT_PANEL_WIDTH,
  PANEL_KEYBOARD_STEP,
  PANEL_MAX_WIDTH,
  clampPanelWidth,
  initialPanelWidth,
  stepPanelWidth,
} from './utils/panelWidth';
import { getOpeningCandidates, matchOpening } from './utils/openings';
import { buildLibraryPositionIndex, formatExplorerRecord, libraryPositionSignature, lookupLibraryPosition } from './utils/positionExplorer';
import { useGameLibrary } from './hooks/useGameLibrary';
import type { SavedGame, SavedMoveTreeNode } from './utils/gameLibrary';
import { narrativeTags } from './utils/narrativeTags';
import {
  type AutoSavedGame,
  clearAutoSavedGame,
  isWorthAutoSaving,
  readAutoSavedGame,
  writeAutoSavedGame,
} from './utils/autoSave';
import { decodeSavedMoveTreeParam, encodeSavedMoveTreeParam } from './utils/shareTree';
import type { HistoricalGame } from './utils/historicalGames';
import { useGameReview } from './hooks/useGameReview';
import { GameOverModal } from './components/GameOverModal';
import { AutoSaveRecoveryModal } from './components/AutoSaveRecoveryModal';
import { BoardEditor } from './components/Board/BoardEditor';
import { exportPgn, exportPgnTree, copyToClipboard, downloadTextFile } from './utils/gameExport';
import { formatMoveRecordLabel, formatMoveRecordTitle, formatUciMove } from './utils/moveNotation';
import { MAX_MOVE_COMMENT_LENGTH, normalizeMoveComment } from './utils/moveComment';
import { describeMoveNumber } from './utils/moveNumbering';
import { passMoveFen } from './utils/threatPosition';
import { isDrillSuccess, judgeDrillAttempt, orderDrillMoments, type DrillVerdict } from './utils/mistakeDrill';
import { describePvStanding } from './utils/pvStanding';
import { formatRecordText } from './utils/recordText';
import { useCloudBook } from './hooks/useCloudBook';
import { useCloudRule } from './hooks/useCloudRule';
import { CLOUD_BOOK_SITE_NAME, formatCloudBookScore } from './utils/cloudBook';
import {
  NOTATION_STYLES,
  NOTATION_STYLE_DESCRIPTIONS,
  NOTATION_STYLE_LABELS,
  boardBeforeRecord,
  formatLineInStyle,
  formatMoveInStyle,
  formatRecordInStyle,
  isNotationStyle,
  parseNotationRecord,
  type XiangqiNotationStyle,
} from './utils/xiangqiNotation';
import { getMovePhaseForRecord, plyOffsetFromRootFen } from './utils/gamePhase';
import { LazyPanelBoundary } from './components/LazyPanelBoundary';
import { QaForcedRenderError } from './components/QaForcedRenderError';
import { PREFERENCES_STORAGE_KEY, readVersionedStorage } from './utils/storageKeys';
import {
  describeRepetition,
  formatRepetitionHeadline,
  formatRepetitionRule,
  shouldReportRepetition,
} from './utils/repetition';
import {
  describeCaptureFree,
  formatCaptureFreeHeadline,
  formatCaptureFreeRule,
  readCaptureFreePlies,
} from './utils/captureFreeRule';
import {
  describeAnalysisActivity,
  formatAnalysisActivity,
  isAnalysisActivityStalled,
  resolveAnalysisActivity,
} from './utils/analysisActivity';
import { describeShareLinkFailure, shareLinkHeadline, type ShareLinkFailure } from './utils/shareLinkNotice';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import type { Command } from './utils/commandPalette';
import { COMMAND_PALETTE_ARIA_KEYSHORTCUTS, commandPaletteShortcutLabel } from './utils/commandPalette';
import {
  extractFenTag,
  extractAnnotatedMainLine,
  extractUciMoveLine,
  hasTooManyUciMoves,
  extractUciMoveTree,
  stripRecordMetadata,
  isMoveImportTextTooLarge,
  MAX_MOVE_IMPORT_TEXT_LENGTH,
  MAX_MOVE_IMPORT_UCI_MOVES,
} from './utils/moveImport';
import {
  detectDeviceProfile,
  detectDeviceScreen,
  detectSimdSupport,
  detectThreadSupport,
  hashChoicesForTier,
  resolveDeepDiveBudget,
  resolveEngineBootConfig,
  resolveLiveAnalysisPolicy,
  resolveReviewPolicy,
  threadChoicesForProfile,
} from './utils/analysisProfile';
import {
  classifyMoveQualityForEval,
  summarizeAccuracyByPhase,
  computeReviewArtifacts,
  describeReviewEngineSummary,
  formatAverageCentipawnLoss,
  formatReviewQuality,
  formatWinPercentLoss,
  getEvalLossForMove,
  formatReviewCount,
  getReviewSideForRecord,
  type ReviewKeyMoment,
  makeReviewLineSignature,
  makeReviewLineSignatureFromMoves,
  remapReviewSummaryToLine,
  type ReviewEngineSummary,
  type ReviewMoveQuality,
  rebuildSummaryFromAnnotations,
  reviewSideFromStartFen,
  selectRevisitNodes,
  nextCriticalSwing,
} from './utils/review';
import {
  AI_STRENGTH_LABELS,
  WORKER_SAFE_MAX_DEPTH,
  buildAiGoCommand,
  chooseAiMoveFromPv,
  describeAiStrength,
  getAiSearchConfig,
  isAiStrength,
  type AiStrength,
} from './utils/aiOpponent';

const LazyLibraryPanel = React.lazy(() =>
  import('./components/Library/LibraryPanel').then((module) => ({ default: module.LibraryPanel }))
);

/**
 * The one breakpoint the app has. Written here and read by `matchMedia` so the
 * markup switches on the same condition `@media (max-width: 900px)` does in
 * App.css; two copies of a breakpoint is two layouts that can be on screen at
 * once.
 */
const MOBILE_LAYOUT_QUERY = '(max-width: 900px)';

export type GameMode = 'PvP' | 'PvAI-Black' | 'PvAI-Red' | 'AIvAI';
type WorkspaceMode = 'play' | 'analysis';
type AssistMode = 'coach' | 'pro';
type AnalysisEngineMode = 'stable' | 'optimized';
type PvLineCount = 1 | 3 | 5;
/** How long a deep search runs: the tier's bounded budget, or until stopped. */
type DeepSearchMode = 'bounded' | 'infinite';
type EngineNotice = { tone: 'warning' | 'danger'; text: string } | null;
type EngineHashFeedback = 'queued' | 'cleared' | null;
type ShareLinkNotice = { tone: 'warning'; text: string; detail: string; positionKey?: string } | null;
type ExportFailureKey = 'copy-pgn' | 'download-pgn' | 'copy-share' | 'copy-fen' | 'copy-record' | `copy-pv-${number}`;
type BoardSquare = { file: number; rank: number };
type BoardArrow = {
  from: BoardSquare;
  to: BoardSquare;
  color: string;
  kind?: 'last' | 'engine' | 'engine-focus' | 'book' | 'threat' | 'user';
  opacity?: number;
  strokeWidth?: number;
};

const GAME_MODES: Array<{ mode: GameMode; label: string; shortLabel: string; description: string }> = [
  { mode: 'PvP', label: 'Local board', shortLabel: 'Local', description: 'Two players, one board, no engine moves.' },
  { mode: 'PvAI-Black', label: 'You play Red', shortLabel: 'Red vs AI', description: 'Red moves first while the engine replies as Black.' },
  { mode: 'PvAI-Red', label: 'You play Black', shortLabel: 'Black vs AI', description: 'The engine starts as Red, then you defend as Black.' },
  { mode: 'AIvAI', label: 'AI exhibition', shortLabel: 'AI vs AI', description: 'Both sides are engine-driven for watching and review.' },
];

const AI_SPEED_MS: Record<Exclude<AiSpeed, 'step'>, number> = {
  slow: 1500,
  normal: 800,
  fast: 150,
};
const PV_LINE_OPTIONS: PvLineCount[] = [1, 3, 5];
const PV_LINE_CONTROL_COPY: Record<PvLineCount, { ariaLabel: string; title: string }> = {
  1: {
    ariaLabel: 'Set principal variation lines to 1, fastest best-move search',
    title: 'Show 1 engine line for the fastest best-move search.',
  },
  3: {
    ariaLabel: 'Set principal variation lines to 3, compare main candidates',
    title: 'Show 3 engine lines to compare main candidate moves.',
  },
  5: {
    ariaLabel: 'Set principal variation lines to 5, broad option scan',
    title: 'Show 5 engine lines for a broader option scan. This uses more engine time.',
  },
};
const ANALYSIS_ENGINE_MODE_COPY: Record<AnalysisEngineMode, { ariaLabel: string; title: string }> = {
  stable: {
    ariaLabel: 'Stable analysis engine profile, safer boot and conservative resources',
    title: 'Stable profile: safer boot and conservative engine resources.',
  },
  optimized: {
    ariaLabel: 'Optimized analysis engine profile, faster search when supported',
    title: 'Optimized profile: faster search when this device supports it.',
  },
};
const ASSIST_MODE_COPY: Record<AssistMode, { ariaLabel: string; title: string }> = {
  coach: {
    ariaLabel: 'Coach interface, show rule hints and guided move context',
    title: 'Coach interface: show rule hints and guided move context.',
  },
  pro: {
    ariaLabel: 'Pro interface, compact analysis with fewer teaching prompts',
    title: 'Pro interface: compact analysis with fewer teaching prompts.',
  },
};
const ANALYSIS_TAG_PREFIX = 'analysis';
const AI_TAG_PREFIX = 'ai';
const REVIEW_TAG_PREFIX = 'review';
const THREAT_TAG_PREFIX = 'threat';
const HINT_TAG_PREFIX = 'hint';
const THIRD_PARTY_NOTICES_HREF = `${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`;
const FILE_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
const DEFAULT_LEFT_PANEL_WIDTH = DEFAULT_PANEL_WIDTH;
const DEFAULT_RIGHT_PANEL_WIDTH = DEFAULT_PANEL_WIDTH;
const PIECE_SYMBOLS: Record<PieceCode, string> = {
  K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵',
  k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒',
};
const PIECE_NAMES: Record<PieceCode, string> = {
  K: 'Red general',
  A: 'Red advisor',
  B: 'Red elephant',
  N: 'Red horse',
  R: 'Red chariot',
  C: 'Red cannon',
  P: 'Red soldier',
  k: 'Black general',
  a: 'Black advisor',
  b: 'Black elephant',
  n: 'Black horse',
  r: 'Black chariot',
  c: 'Black cannon',
  p: 'Black soldier',
};
/**
 * One line about the piece a beginner just picked up, in coach mode.
 *
 * Each names the restrictions the rules engine actually enforces on that piece,
 * because the alternative is a refused move the hint gave no warning of. The
 * elephant's eye was the one missing: the horse's leg was here from the start,
 * and `formatMoveRuleHint` has a sentence for a blocked eye, so a beginner
 * could be told about a rule at the moment it stopped them and never before.
 */
const PIECE_MOVE_HINTS: Record<PieceCode, string> = {
  K: 'General: palace steps; open-file capture',
  A: 'Advisor: diagonal inside palace',
  B: 'Elephant: 2 diagonal; eye can block; no river',
  N: 'Horse: L move; leg can block',
  R: 'Chariot: straight lines, no blockers',
  C: 'Cannon: straight; capture over 1 screen',
  P: 'Soldier: forward; sideways after crossing river',
  k: 'General: palace steps; open-file capture',
  a: 'Advisor: diagonal inside palace',
  b: 'Elephant: 2 diagonal; eye can block; no river',
  n: 'Horse: L move; leg can block',
  r: 'Chariot: straight lines, no blockers',
  c: 'Cannon: straight; capture over 1 screen',
  p: 'Soldier: forward; sideways after crossing river',
};
/**
 * An error boundary you cannot trigger is one you cannot verify. `main.tsx`
 * already exposes `?qa-error-boundary` for the app-level one; this is the same
 * switch for the lazy panel boundary, so the containment can be seen rather
 * than assumed — the board should survive while only the panel goes quiet.
 * DEV only.
 */
const qaForcePanelError = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('qa-panel-boundary');


const MAX_PREFERENCES_JSON_LENGTH = 4096;
const START_POSITION_FEN = `${START_FEN} w - - 0 1`;


function isGameMode(value: unknown): value is GameMode {
  return value === 'PvP' || value === 'PvAI-Black' || value === 'PvAI-Red' || value === 'AIvAI';
}

function isAiGameModeValue(mode: GameMode) {
  return mode !== 'PvP';
}

/**
 * Which way up the board should be for the person playing it.
 *
 * "You play Black" used to leave Red at the bottom, so the human played from
 * the top of the board for the whole game -- every other board turns to face
 * the player. Null for the two modes where nobody or everybody is a human,
 * which leave the orientation as the reader had it.
 */
function orientationForHuman(mode: GameMode): BoardOrientation | null {
  if (mode === 'PvAI-Black') return 'red';
  if (mode === 'PvAI-Red') return 'black';
  return null;
}

type ShareUrlBuildResult = {
  url: string;
  treeOmitted: boolean;
};

function buildShareUrl(rootFen: string, moves: string[], mode: GameMode, moveTree?: SavedMoveTreeNode[]): ShareUrlBuildResult | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  if (rootFen !== START_POSITION_FEN) {
    url.searchParams.set('fen', rootFen);
  }
  if (moves.length > 0) {
    url.searchParams.set('moves', moves.join(' '));
  }
  let treeIncluded = false;
  if (moveTree?.length) {
    const encodedTree = encodeSavedMoveTreeParam(moveTree);
    if (encodedTree) {
      url.searchParams.set('tree', encodedTree);
      treeIncluded = true;
    }
  }
  if (mode !== 'PvP') {
    url.searchParams.set('mode', mode);
  }
  return {
    url: url.toString(),
    treeOmitted: Boolean(moveTree?.length) && !treeIncluded,
  };
}

function moveTreeContainsLine(moveTree: SavedMoveTreeNode[] | undefined, moves: string[]) {
  if (moves.length === 0) return true;
  let siblings = moveTree ?? [];
  for (const move of moves) {
    const child = siblings.find((node) => node.uci === move);
    if (!child) return false;
    siblings = child.children ?? [];
  }
  return true;
}


type ReviewPhase = 'base' | 'revisit';

/**
 * A run through the review's key moments as questions. See
 * `utils/mistakeDrill` for the grading; this is the sequence.
 */
type MistakeDrillState = {
  moments: ReviewKeyMoment[];
  index: number;
  /** The move the reader played from the position before the mistake. */
  attempt: { nodeId: string; uci: string } | null;
  verdict: DrillVerdict | null;
  found: number;
  finished: boolean;
};

type StoredPreferences = {
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
  deepSearchMode?: DeepSearchMode;
  cloudBookEnabled?: boolean;
};

type ReviewController = {
  active: boolean;
  phase: ReviewPhase;
  baseQueue: string[];
  revisitQueue: string[];
  provisionalEvals: Map<string, number>;
  criticalDecisionSwings: Map<string, number>;
  pendingEvals: Map<string, number>;
  completed: number;
  total: number;
  currentNodeId: string | null;
  flushTimer: number | null;
};

function createReviewController(): ReviewController {
  return {
    active: false,
    phase: 'base',
    baseQueue: [],
    revisitQueue: [],
    provisionalEvals: new Map(),
    criticalDecisionSwings: new Map(),
    pendingEvals: new Map(),
    completed: 0,
    total: 0,
    currentNodeId: null,
    flushTimer: null,
  };
}

function nodeLabel(
  nodeId: string,
  rootNodeId: string,
  treeNodes: ReturnType<typeof useXiangqi>['treeNodes'],
  notationStyle: XiangqiNotationStyle,
  rootFen: string
) {
  if (nodeId === rootNodeId) return 'Start';
  const record = treeNodes[nodeId]?.record;
  if (!record) return 'Node';
  // The breadcrumb sits directly above the move list on a phone. Writing the
  // same move two ways six pixels apart -- "俥 E1→F1" over "R5=4" -- reads as
  // two different moves.
  //
  // The number had the same problem and it was not fixed with the notation.
  // This read `${record.ply}.`, which is a ply index punctuated as a move
  // number: on a 40-ply game the last chip said "39. C8-6" while the move list
  // immediately below it called that same move "20. C8-6". `describeMoveNumber`
  // is the move list's own rule, so the two now agree by construction. The
  // chip's `aria-label` still says "Ply 39", which is the honest reading of a
  // strip carrying one chip per ply.
  const { label } = describeMoveNumber(rootFen, record.ply);
  if (notationStyle !== 'uci') return `${label} ${formatRecordInStyle(record, notationStyle)}`;
  return `${label} ${formatMoveRecordLabel(record)}`;
}

function nodeTitle(nodeId: string, rootNodeId: string, treeNodes: ReturnType<typeof useXiangqi>['treeNodes']) {
  if (nodeId === rootNodeId) return 'Start position';
  const record = treeNodes[nodeId]?.record;
  if (!record) return 'Move node';
  return `Ply ${record.ply}: ${formatMoveRecordTitle(record)}`;
}

// detectCoarsePointer, detectDeviceScreen and detectSimdSupport now live in
// utils/analysisProfile, beside the tier they feed. They were here while
// useEngine kept a second copy of the same judgement that read the window
// instead of the machine; one of the two had to be the only one.

function isAssistMode(value: unknown): value is AssistMode {
  return value === 'coach' || value === 'pro';
}

function isBoardOrientation(value: unknown): value is BoardOrientation {
  return value === 'red' || value === 'black';
}

function isAnalysisEngineMode(value: unknown): value is AnalysisEngineMode {
  return value === 'stable' || value === 'optimized';
}

function isAiSpeed(value: unknown): value is AiSpeed {
  return value === 'slow' || value === 'normal' || value === 'fast' || value === 'step';
}

function isDeepSearchMode(value: unknown): value is DeepSearchMode {
  return value === 'bounded' || value === 'infinite';
}

function isPvLineCount(value: unknown): value is PvLineCount {
  return value === 1 || value === 3 || value === 5;
}

function normalizeStoredPreferencesValue(raw: string | null): StoredPreferences {
  if (!raw) return {};
  try {
    if (raw.length > MAX_PREFERENCES_JSON_LENGTH) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const searchDepth = Number(record.searchDepth);
    return {
      assistMode: isAssistMode(record.assistMode) ? record.assistMode : undefined,
      orientation: isBoardOrientation(record.orientation) ? record.orientation : undefined,
      showArrows: typeof record.showArrows === 'boolean' ? record.showArrows : undefined,
      soundEnabled: typeof record.soundEnabled === 'boolean' ? record.soundEnabled : undefined,
      searchDepth: Number.isFinite(searchDepth) ? Math.max(1, Math.min(24, Math.trunc(searchDepth))) : undefined,
      // Not clamped here: which sizes are allowed is the tier's business, and
      // resolveEngineBootConfig drops anything off this machine's ladder back
      // to its own default. A value saved on another machine is a statement
      // about that machine.
      engineHashMB: Number.isFinite(Number(record.engineHashMB)) ? Math.trunc(Number(record.engineHashMB)) : undefined,
      engineThreads: Number.isFinite(Number(record.engineThreads)) ? Math.trunc(Number(record.engineThreads)) : undefined,
      analysisEngineMode: isAnalysisEngineMode(record.analysisEngineMode) ? record.analysisEngineMode : undefined,
      enginePvLineCount: isPvLineCount(record.enginePvLineCount) ? record.enginePvLineCount : undefined,
      aiStrength: isAiStrength(record.aiStrength) ? record.aiStrength : undefined,
      aiSpeed: isAiSpeed(record.aiSpeed) ? record.aiSpeed : undefined,
      notationStyle: isNotationStyle(record.notationStyle) ? record.notationStyle : undefined,
      deepSearchMode: isDeepSearchMode(record.deepSearchMode) ? record.deepSearchMode : undefined,
      cloudBookEnabled: typeof record.cloudBookEnabled === 'boolean' ? record.cloudBookEnabled : undefined,
    };
  } catch {
    return {};
  }
}

function readStoredPreferences(): StoredPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = readVersionedStorage(PREFERENCES_STORAGE_KEY);
    return normalizeStoredPreferencesValue(raw);
  } catch {
    return {};
  }
}

function writeStoredPreferences(preferences: StoredPreferences) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are a convenience; storage failures should never interrupt play.
  }
}

function clearStoredPreferences() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  } catch {
    // Ignore storage failures for the same reason.
  }
}

function logDiagnosticWarning(message: string, ...details: unknown[]) {
  if (import.meta.env.DEV) {
    console.warn(message, ...details);
  }
}

function logDiagnosticError(message: string, ...details: unknown[]) {
  if (import.meta.env.DEV) {
    console.error(message, ...details);
  }
}

type AnalysisPhase = 'primary' | 'deepen' | 'deep';

function makeAnalysisTag(phase: AnalysisPhase, requestKey: string) {
  return `${ANALYSIS_TAG_PREFIX}|${phase}|${requestKey}`;
}

function parseAnalysisTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${ANALYSIS_TAG_PREFIX}|`)) return null;
  const [, phase, ...rest] = tag.split('|');
  if ((phase !== 'primary' && phase !== 'deepen' && phase !== 'deep') || rest.length === 0) return null;
  return { phase: phase as AnalysisPhase, requestKey: rest.join('|') };
}

function makeReviewTag(phase: ReviewPhase, nodeId: string) {
  return `${REVIEW_TAG_PREFIX}|${phase}|${nodeId}`;
}

/**
 * A threat search carries its own prefix so it cannot be mistaken for the
 * analysis of the position on screen.
 *
 * It is a search of a *different* position -- the same board with the other
 * side to move -- and everything the analysis panel shows is filtered on
 * `parseAnalysisTag`. Reusing that prefix would put the opponent's evaluation
 * on the eval bar and the opponent's move at the top of the candidate list,
 * both labelled as the position's own. The request key inside it is still the
 * analysis one, so a threat is dropped by the same navigation that drops an
 * analysis.
 */
function makeThreatTag(requestKey: string) {
  return `${THREAT_TAG_PREFIX}|${requestKey}`;
}

function parseThreatTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${THREAT_TAG_PREFIX}|`)) return null;
  const requestKey = tag.slice(THREAT_TAG_PREFIX.length + 1);
  return requestKey ? { requestKey } : null;
}

/**
 * A hint is a search of the position the human is about to move in, during a
 * game against the engine -- where analysis is off, so nothing else is
 * looking at it. It carries the position command so a reply that arrives
 * after the position has changed is dropped rather than drawn.
 */
function makeHintTag(positionCommand: string) {
  return `${HINT_TAG_PREFIX}|${positionCommand}`;
}

function parseHintTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${HINT_TAG_PREFIX}|`)) return null;
  const positionCommand = tag.slice(HINT_TAG_PREFIX.length + 1);
  return positionCommand ? { positionCommand } : null;
}

/** Enough to be right about the obvious and quick enough to feel like an answer. */
const HINT_GO_CMD = 'go depth 14 movetime 900';

function makeAiTag(positionCommand: string, depth: number, strength: AiStrength) {
  return `${AI_TAG_PREFIX}|${depth}|${strength}|${positionCommand}`;
}

function parseAiTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${AI_TAG_PREFIX}|`)) return null;
  const [, depthText, strengthText, ...rest] = tag.split('|');
  const depth = Number(depthText);
  const strength = Number(strengthText);
  const positionCommand = rest.join('|');
  if (!Number.isFinite(depth) || !isAiStrength(strength) || !positionCommand) return null;
  return { depth, strength, positionCommand };
}

function parseReviewTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${REVIEW_TAG_PREFIX}|`)) return null;
  const [, phase, nodeId] = tag.split('|');
  if ((phase !== 'base' && phase !== 'revisit') || !nodeId) return null;
  return { phase, nodeId };
}

function sideFromFen(fen: string): Side {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
}

function normalizeEvalForSide(score: number, side: Side) {
  return side === 'b' ? -score : score;
}

function normalizeEvalForFen(score: number, fen: string) {
  return normalizeEvalForSide(score, sideFromFen(fen));
}

function normalizeWdlForSide(stats: WdlStats | null, side: Side): WdlStats | null {
  if (!stats || side === 'w') return stats;
  return {
    win: stats.loss,
    draw: stats.draw,
    loss: stats.win,
  };
}

function formatEvalScore(score: number, decimals = 1) {
  return `${score > 0 ? '+' : ''}${(score / 100).toFixed(decimals)}`;
}

function parseMateScoreText(scoreStr: string | undefined) {
  const match = scoreStr?.match(/^([+-])M(\d+)$/);
  if (!match) return null;
  const distance = Number(match[2]);
  if (!Number.isFinite(distance)) return null;
  return match[1] === '-' ? -distance : distance;
}

function formatMateScoreText(distance: number) {
  return distance >= 0 ? `+M${distance}` : `-M${Math.abs(distance)}`;
}

function formatRedPovEngineScore(pv: Pick<PvLine, 'score' | 'scoreStr'>, side: Side, decimals = 1) {
  const mateDistance = parseMateScoreText(pv.scoreStr);
  if (mateDistance !== null) {
    const redPovMateDistance = side === 'b' ? -mateDistance : mateDistance;
    return formatMateScoreText(redPovMateDistance);
  }
  return formatEvalScore(normalizeEvalForSide(pv.score, side), decimals);
}

function formatCompactCount(value: number) {
  const normalized = Math.max(0, Math.trunc(value));
  if (normalized >= 1_000_000) {
    return `${(normalized / 1_000_000).toFixed(normalized >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (normalized >= 1_000) {
    return `${(normalized / 1_000).toFixed(normalized >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  }
  return `${normalized}`;
}

function formatEngineDepthLabel(
  stats: EngineSearchStats | null,
  fallbackDepth: number,
  isSearchQueued: boolean,
  isSearching: boolean,
  isReady: boolean,
) {
  if (!stats) {
    if (isSearchQueued) return 'Queued';
    if (isSearching) return 'Pending';
    return isReady ? 'Idle' : 'Booting';
  }

  const depth = stats.depth ?? fallbackDepth;
  const seldepth = stats?.seldepth;
  if (seldepth && seldepth > depth) {
    return `D${depth}/S${seldepth}`;
  }
  return `D${depth}`;
}

function formatEngineTelemetry(
  stats: EngineSearchStats | null,
  fallbackDepth: number,
  fallbackMoveTimeMs: number,
  isSearchQueued: boolean,
  isSearching: boolean,
) {
  if (!stats) {
    const target = `target D${fallbackDepth}`;
    if (isSearchQueued) return `${target} · queued`;
    return isSearching ? `${target} · ${fallbackMoveTimeMs}ms` : target;
  }

  const parts: string[] = [];
  if (typeof stats.nps === 'number') {
    parts.push(`${formatCompactCount(stats.nps)} nps`);
  } else if (typeof stats.nodes === 'number') {
    parts.push(`${formatCompactCount(stats.nodes)} nodes`);
  }
  if (typeof stats.hashfull === 'number') {
    parts.push(`hash ${Math.round(stats.hashfull / 10)}%`);
  }
  if (parts.length === 0 && typeof stats.timeMs === 'number') {
    parts.push(`${stats.timeMs}ms`);
  }

  return parts.length > 0 ? parts.slice(0, 2).join(' · ') : `${fallbackMoveTimeMs}ms primary`;
}

function formatEngineTelemetryDetail(
  stats: EngineSearchStats | null,
  fallbackDepth: number,
  fallbackMoveTimeMs: number,
  isSearchQueued: boolean,
  isSearching: boolean,
  isReady: boolean,
) {
  if (!stats) {
    return `Search ${formatEngineDepthLabel(stats, fallbackDepth, isSearchQueued, isSearching, isReady)}; ${formatEngineTelemetry(stats, fallbackDepth, fallbackMoveTimeMs, isSearchQueued, isSearching)}`;
  }

  const parts = [formatEngineDepthLabel(stats, fallbackDepth, isSearchQueued, isSearching, isReady)];
  if (typeof stats.nodes === 'number') {
    parts.push(`${formatCompactCount(stats.nodes)} nodes`);
  }
  if (typeof stats.nps === 'number') {
    parts.push(`${formatCompactCount(stats.nps)} nps`);
  }
  if (typeof stats.hashfull === 'number') {
    parts.push(`hash ${Math.round(stats.hashfull / 10)}%`);
  }
  if (typeof stats.timeMs === 'number') {
    parts.push(`${stats.timeMs}ms`);
  }
  return `Search ${parts.join(' · ')}`;
}

function getQualityArrowColor(quality: ReviewMoveQuality) {
  switch (quality) {
    case 'best':
      return '#22c55e';
    case 'good':
      return '#4ade80';
    case 'inaccuracy':
      return '#facc15';
    case 'mistake':
      return '#f97316';
    case 'blunder':
      return '#ef4444';
  }
}

function formatSquare(square: BoardSquare | null) {
  if (!square) return '';
  return `${FILE_LABELS[square.file]}${square.rank}`;
}

function formatMaterialValue(valueTenths: number) {
  const value = valueTenths / 10;
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}


function makeEnginePositionCommand(rootFen: string, moves: string[]) {
  const rootParts = rootFen.trim().split(/\s+/);
  const isDefaultStart = rootParts[0] === START_FEN && rootParts[1] === 'w';
  const baseCommand = isDefaultStart ? 'position startpos' : `position fen ${rootFen}`;
  return moves.length > 0 ? `${baseCommand} moves ${moves.join(' ')}` : baseCommand;
}

/** Long enough that a fast sequence of moves writes once, not per move. */
const AUTO_SAVE_DEBOUNCE_MS = 600;

function savedResultToGameResult(result: SavedGame['result']): GameResult {
  if (result === 'red') return 'red-wins';
  if (result === 'black') return 'black-wins';
  if (result === 'draw') return 'draw';
  return null;
}

function getDialogFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(container.querySelectorAll<HTMLElement>(selector))
    .filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
}

function formatCapturedTrayLabel(
  side: 'Red' | 'Black',
  captured: Array<{ piece: PieceCode; count: number }>
) {
  // The tray shows glyphs, and the per-piece title is a mouse-only tooltip on a
  // generic span, so the names never reached the accessibility tree. Spell the
  // haul out in the label the tray already carries.
  if (captured.length === 0) return `Pieces captured by ${side}: none`;
  const pieces = captured.map(({ piece, count }) => (
    count > 1 ? `${count} ${PIECE_NAMES[piece]}s` : PIECE_NAMES[piece]
  ));
  return `Pieces captured by ${side}: ${pieces.join(', ')}`;
}

function App() {
  const storedPreferences = useMemo(() => readStoredPreferences(), []);
  // A narrow window is not a weaker machine. This read innerWidth, so opening
  // the app small on a large display picked the lower depth and saved it, and
  // it stayed after the window grew. Ask the screen, as the engine tier does.
  // High enough that the tier's own ceiling and its move-time budget decide how
  // long a search runs, rather than this preference. It used to default to 8,
  // which on a high-tier machine meant a 9ms search inside an 1800ms budget --
  // the slider was the binding constraint on every position, and nothing said
  // so. Lowering it is still a real choice; raising it past the tier's ceiling
  // is not, which is what the label under it now reports.
  const defaultSearchDepth = detectDeviceScreen().width <= 900 ? 14 : 22;
  const initialSoundEnabled = storedPreferences.soundEnabled ?? true;
  const initialAiSpeed = storedPreferences.aiSpeed ?? 'normal';
  const [gameMode, setGameMode] = useState<GameMode>('PvP');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('analysis');
  const [assistMode, setAssistMode] = useState<AssistMode>(storedPreferences.assistMode ?? 'coach');
  const [leftWidth, setLeftWidth] = useState(() => initialPanelWidth(DEFAULT_LEFT_PANEL_WIDTH));
  const [rightWidth, setRightWidth] = useState(() => initialPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH));
  const [topPanelOpen, setTopPanelOpen] = useState(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [analysisTab, setAnalysisTab] = useState<'tree' | 'review' | 'engine'>('tree');
  const [mobileView, setMobileView] = useState<'board' | 'analysis'>('board');
  const [mobileAnalysisTab, setMobileAnalysisTab] = useState<'moves' | 'review' | 'engine' | 'graph' | 'library'>('moves');
  const [showArrows, setShowArrows] = useState(storedPreferences.showArrows ?? true);
  const [userHighlights, setUserHighlights] = useState<BoardSquare[]>([]);
  const [userArrows, setUserArrows] = useState<BoardArrow[]>([]);
  const [showMobileBoardActionMenu, setShowMobileBoardActionMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showNewGameMenu, setShowNewGameMenu] = useState(false);
  const [showBoardEditor, setShowBoardEditor] = useState(false);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const newGameDialogRef = useRef<HTMLDivElement | null>(null);
  const treeBreadcrumbRef = useRef<HTMLDivElement | null>(null);
  const engineOutputRef = useRef<HTMLDivElement | null>(null);
  const [pendingGameMode, setPendingGameMode] = useState<GameMode>('PvP');
  const [aiStrength, setAiStrength] = useState<AiStrength>(storedPreferences.aiStrength ?? 5);
  const [leftPanelTab, setLeftPanelTab] = useState<'graph' | 'library'>('graph');
  const [graphLoadSweepToken, setGraphLoadSweepToken] = useState(0);
  const [orientation, setOrientation] = useState<BoardOrientation>(storedPreferences.orientation ?? 'red');
  // WXF is the default because it is the notation both a Chinese record and an
  // English one can be read against, and it needs no font the board does not
  // already load. UCI stays available: it is what the engine says and what a
  // share link carries.
  const [notationStyle, setNotationStyle] = useState<XiangqiNotationStyle>(
    storedPreferences.notationStyle ?? 'wxf'
  );
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));
  const [isPageVisible, setIsPageVisible] = useState(() => (
    typeof document === 'undefined' ? true : !document.hidden
  ));

  const [soundEnabled, setSoundEnabled] = useState(initialSoundEnabled);
  const soundEnabledRef = useRef(initialSoundEnabled);
  const updateSoundEnabled = useCallback((enabled: boolean) => {
    soundEnabledRef.current = enabled;
    setSoundEnabled(enabled);
  }, []);
  const handleSoundToggle = useCallback((enabled: boolean) => {
    if (enabled) unlockSoundEffects();
    updateSoundEnabled(enabled);
  }, [updateSoundEnabled]);

  useEffect(() => {
    if (!soundEnabled || typeof window === 'undefined') return;
    const unlock = () => unlockSoundEffects();
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [soundEnabled]);

  const [searchDepth, setSearchDepth] = useState(storedPreferences.searchDepth ?? defaultSearchDepth);
  const [analysisEngineMode, setAnalysisEngineMode] = useState<AnalysisEngineMode>(storedPreferences.analysisEngineMode ?? 'optimized');
  const [engineHashMB, setEngineHashMB] = useState<number | undefined>(storedPreferences.engineHashMB);
  const [engineThreads, setEngineThreads] = useState<number | undefined>(storedPreferences.engineThreads);
  const [enginePvLineCount, setEnginePvLineCount] = useState<PvLineCount>(storedPreferences.enginePvLineCount ?? 3);
  const [engineRestartToken, setEngineRestartToken] = useState(0);
  // State rather than the stage ref, because the ref cannot re-render the
  // button that has to turn into "Stop". It happened to look right only
  // because a running search re-renders constantly for its own reasons.
  const [deepDiveActive, setDeepDiveActiveState] = useState(false);
  /**
   * The same flag where an event handler can read it. The visibility handler is
   * subscribed once and must not resubscribe every time a deep search starts,
   * and it has to see the current value rather than the one from the last
   * commit -- so the ref is written by the setter, not by an effect behind it.
   */
  const deepDiveActiveRef = useRef(false);
  const setDeepDiveActive = useCallback((next: boolean) => {
    deepDiveActiveRef.current = next;
    setDeepDiveActiveState(next);
  }, []);
  /**
   * Bounded by default: a search that settles on its own needs nothing
   * remembered. Infinite is the mode every desktop GUI offers and a strong
   * player expects -- the engine keeps going on this position until told to
   * stop or the position changes, and the depth keeps climbing past what any
   * budget would allow. Navigation cancels it the way it cancels any other
   * search: the queue sends `stop`, waits for `bestmove`, and dispatches the
   * next position.
   */
  const [deepSearchMode, setDeepSearchMode] = useState<DeepSearchMode>(storedPreferences.deepSearchMode ?? 'bounded');
  /**
   * Off until asked. The cloud book is the one feature here that sends
   * anything off the machine -- the position, to chessdb.cn -- and a reader
   * who never asked for that should not find it happening. Once on, it stays
   * on across reloads like any other preference.
   */
  const [cloudBookEnabled, setCloudBookEnabled] = useState(storedPreferences.cloudBookEnabled ?? false);
  /**
   * Whether the board is showing the opponent's threat rather than the
   * position's own analysis.
   *
   * State rather than a ref for the same reason `deepDiveActive` is: it decides
   * what the button says and what the panel draws. It also gates the live
   * analysis effect, which is the part that needs care -- see the comment where
   * it is turned off.
   */
  const [threatActive, setThreatActive] = useState(false);
  /**
   * The move the engine would play for the human, when they asked. Cleared on
   * every position change, so a hint is only ever drawn where it was asked.
   */
  const [hintMove, setHintMove] = useState<string | null>(null);
  const [hintPending, setHintPending] = useState(false);
  const [engineSafetyBootLevel, setEngineSafetyBootLevel] = useState(0);
  const [engineNotice, setEngineNotice] = useState<EngineNotice>(null);
  const [spotlightPvIndex, setSpotlightPvIndex] = useState<number | null>(null);
  const [shareLinkNotice, setShareLinkNotice] = useState<ShareLinkNotice>(null);
  const [aiSpeed, setAiSpeed] = useState<AiSpeed>(initialAiSpeed);
  const aiSpeedRef = useRef<AiSpeed>(initialAiSpeed);
  const handleSpeedChange = useCallback((s: AiSpeed) => {
    setAiSpeed(s);
    aiSpeedRef.current = s;
  }, []);

  const applyPreferences = useCallback((preferences: StoredPreferences) => {
    setAssistMode(preferences.assistMode ?? 'coach');
    setOrientation(preferences.orientation ?? 'red');
    setShowArrows(preferences.showArrows ?? true);
    updateSoundEnabled(preferences.soundEnabled ?? true);
    setSearchDepth(preferences.searchDepth ?? defaultSearchDepth);
    setAnalysisEngineMode(preferences.analysisEngineMode ?? 'optimized');
    setEngineHashMB(preferences.engineHashMB);
    setEngineThreads(preferences.engineThreads);
    setEnginePvLineCount(preferences.enginePvLineCount ?? 3);
    setAiStrength(preferences.aiStrength ?? 5);
    setNotationStyle(preferences.notationStyle ?? 'wxf');
    setDeepSearchMode(preferences.deepSearchMode ?? 'bounded');
    setCloudBookEnabled(preferences.cloudBookEnabled ?? false);
    handleSpeedChange(preferences.aiSpeed ?? 'normal');
  }, [defaultSearchDepth, handleSpeedChange, updateSoundEnabled]);

  const resetPreferences = useCallback(() => {
    clearStoredPreferences();
    applyPreferences({});
  }, [applyPreferences]);

  useEffect(() => {
    writeStoredPreferences({
      assistMode,
      orientation,
      showArrows,
      soundEnabled,
      searchDepth,
      engineHashMB,
      engineThreads,
      analysisEngineMode,
      enginePvLineCount,
      aiStrength,
      aiSpeed,
      notationStyle,
      deepSearchMode,
      cloudBookEnabled,
    });
  }, [
    aiSpeed,
    cloudBookEnabled,
    deepSearchMode,
    aiStrength,
    analysisEngineMode,
    assistMode,
    engineHashMB,
    enginePvLineCount,
    engineThreads,
    notationStyle,
    orientation,
    searchDepth,
    showArrows,
    soundEnabled,
  ]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key !== PREFERENCES_STORAGE_KEY && event.key !== null) return;
      applyPreferences(normalizeStoredPreferencesValue(event.newValue));
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [applyPreferences]);

  // AI pause/resume state
  const [paused, setPaused] = useState(false);
  const [aiMoveError, setAiMoveError] = useState<string | null>(null);
  const pausedRef = useRef(false);
  const stepPendingRef = useRef(false);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    setAiMoveError(null);
    stepPendingRef.current = false;
  }, []);

  const step = useCallback(() => {
    // In step mode: allow exactly one AI move then re-pause
    stepPendingRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    setAiMoveError(null);
  }, []);

  const pauseAiWithMoveError = useCallback((message: string) => {
    stepPendingRef.current = false;
    pausedRef.current = true;
    setPaused(true);
    setAiMoveError(message);
  }, []);

  const {
    board,
    selected,
    validTargets,
    moveHistory,
    currentMoveIndex,
    currentNodeId,
    rootNodeId,
    treeNodes,
    activeLineNodeIds,
    currentFen,
    rootFen,
    inCheck,
    gameResult,
    setGameResult,
    onSquareClick,
    resetBoard,
    loadMoves,
    loadMoveTree,
    validateMoveTree,
    validateMoveSequence,
    loadFen,
    sideToMove,
    applyUciMove,
    applyUciMoveAtNode,
    setCurrentNodeEval,
    setNodeEvals,
    setNodeBestMove,
    setNodeComment,
    setNodeComments,
    setNodeReviewDataBulk,
    clearAllReviewData,
    getNodeFen,
    getNodeMoves,
    jumpToMove,
    jumpToNode,
    deleteNode,
    captureTreeSnapshot,
    restoreTreeSnapshot,
  } = useXiangqi();

  const viewportWidth = viewportSize.width;
  /**
   * Which layout is on screen, taken from the same query the stylesheet uses.
   *
   * It used to be `viewportWidth <= 900`, and `viewportWidth` arrives through a
   * 50ms debounce -- so a window crossing the breakpoint got the mobile
   * *stylesheet* immediately and the mobile *markup* two frames later. In
   * between, the desktop dock and toolbars were laid out at phone width, wrapped
   * onto enough rows to eat the stage, and `.board-workspace` is a size
   * container whose rows do not stretch: the board, which takes its height from
   * its row and its width from that, collapsed to 36x36. Measured at 1280x820
   * resized to 390x844, the speck stood for about 100ms on every crossing --
   * every tablet rotation.
   *
   * `matchMedia` flips on the crossing itself and nowhere else, so the markup
   * and the stylesheet change in the same frame. The debounce stays for
   * `viewportWidth`, which feeds panel sizing where the cost of running on
   * every resize event is real and the cost of being 50ms late is not.
   */
  const [isMobile, setIsMobile] = useState(() => (
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : window.matchMedia(MOBILE_LAYOUT_QUERY).matches
  ));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // initialPanelWidth scales the starting width to the window, but it only ran
  // at mount: a window opened narrow and then widened kept 26%-of-narrow panels
  // for the rest of the session, leaving the graph too thin to read. Recompute
  // while the width is still the one this scaling picked, and leave alone any
  // width the reader has since dragged, stepped or collapsed.
  const autoLeftWidthRef = useRef(leftWidth);
  const autoRightWidthRef = useRef(rightWidth);
  useEffect(() => {
    const nextLeft = initialPanelWidth(DEFAULT_LEFT_PANEL_WIDTH);
    const nextRight = initialPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH);
    if (leftWidth === autoLeftWidthRef.current && leftWidth !== nextLeft) {
      autoLeftWidthRef.current = nextLeft;
      setLeftWidth(nextLeft);
    }
    if (rightWidth === autoRightWidthRef.current && rightWidth !== nextRight) {
      autoRightWidthRef.current = nextRight;
      setRightWidth(nextRight);
    }
  }, [viewportWidth, leftWidth, rightWidth]);
  // The AI opponent plays its own ladder, and nothing else adjusts it. Search
  // Depth is the *analysis* preference -- its ceiling is the tier's, set in
  // resolveLiveAnalysisPolicy against the move-time budget it has to fit
  // inside -- and letting it cap the opponent too made the strength labels
  // lie: with the old default of 8, "Hard" and "Master" both played depth 8
  // while their tooltips promised 9 and 12, so the top two rungs of the ladder
  // were the same opponent.
  const currentLineMoves = useMemo(() => {
    return activeLineNodeIds
      .slice(0, currentMoveIndex + 1)
      .map((nodeId) => treeNodes[nodeId]?.record?.uci)
      .filter((uci): uci is string => Boolean(uci));
  }, [activeLineNodeIds, currentMoveIndex, treeNodes]);
  const hasMoveTreeMoves = useMemo(() => (
    Boolean(treeNodes[rootNodeId]?.childrenIds.some((childId) => treeNodes[childId]?.record))
  ), [rootNodeId, treeNodes]);
  const hasStudyBranches = useMemo(() => (
    Object.values(treeNodes).some((node) => node.childrenIds.length > 1)
  ), [treeNodes]);
  /**
   * A straight line is stored as a list of moves, which is compact and cannot
   * carry anything else. A note is attached to a move, so a game holding one
   * has to be stored as a tree even when it has no variations -- otherwise the
   * note is written, shown, and silently dropped by the next save.
   */
  const hasCommentedMoves = useMemo(() => (
    Object.values(treeNodes).some((node) => Boolean(node.record?.comment))
  ), [treeNodes]);
  const currentPositionCommand = useMemo(() => {
    return makeEnginePositionCommand(rootFen, currentLineMoves);
  }, [currentLineMoves, rootFen]);
  const isAiMode = gameMode !== 'PvP';
  const engineEnabled = workspaceMode === 'analysis';
  const aiPlayActive = workspaceMode === 'play' && isAiMode;
  const isAiTurn =
    aiPlayActive &&
    (gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w'));
  const engineRequired = engineEnabled || aiPlayActive;

  const {
    status: reviewStatus,
    progress: reviewProgress,
    summary: reviewSummary,
    startReview,
    updateReviewProgress,
    completeReview,
    hydrateReview,
    cancelReview,
    resetReview,
  } = useGameReview();
  /**
   * The line a finished review is about, by node id.
   *
   * A review used to be thrown away the moment the active line changed --
   * which is exactly what playing a variation does, and what "Try best" on
   * the review's own card does -- so the thing that took thirty seconds to
   * compute vanished on the first attempt to learn from it, quality dots and
   * all. It now stays for as long as the line it describes is still in the
   * tree. Its figures keep reading off that line rather than whichever line
   * the board is on, and it is saved with a game only when that line is the
   * one being saved.
   */
  const [reviewedLineNodeIds, setReviewedLineNodeIds] = useState<string[]>([]);
  const completedReviewSummaryLabel = useMemo(() => {
    if (!reviewSummary) return '';
    return [
      `Review summary: ${reviewSummary.accuracy}% accuracy`,
      typeof reviewSummary.averageCentipawnLoss === 'number' ? `average centipawn loss ${formatAverageCentipawnLoss(reviewSummary.averageCentipawnLoss)}` : '',
      typeof reviewSummary.redAccuracy === 'number' ? `Red ${reviewSummary.redAccuracy}% accuracy` : '',
      typeof reviewSummary.blackAccuracy === 'number' ? `Black ${reviewSummary.blackAccuracy}% accuracy` : '',
      formatReviewCount(reviewSummary.blunderCount, 'blunder'),
      formatReviewCount(reviewSummary.mistakeCount, 'mistake'),
      formatReviewCount(reviewSummary.inaccuracyCount, 'inaccuracy', 'inaccuracies'),
      `Engine: ${describeReviewEngineSummary(reviewSummary.engine)}`,
    ].filter(Boolean).join(', ');
  }, [reviewSummary]);

  const applyBestMoveRef = useRef(false);
  /**
   * Grades a drill attempt once the live analysis has an evaluation for the
   * position it reached. Written each render, below, where the drill state
   * is; read from the engine's bestmove callback, which runs long after the
   * render that created it.
   */
  const drillJudgeRef = useRef<(evalScore: number) => void>(() => {});
  const analysisStageRef = useRef<'idle' | 'primary-pending' | 'primary-complete' | 'deepen-pending' | 'deep-pending' | 'settled'>('idle');
  const analysisDeepenTimerRef = useRef<number | null>(null);
  const activeAnalysisRequestRef = useRef('');
  const currentAnalysisRequestKeyRef = useRef('');
  const currentMultiPvRef = useRef(1);
  const currentShowWdlRef = useRef(false);
  const reviewControllerRef = useRef<ReviewController>(createReviewController());
  const reviewLineSignatureRef = useRef('');
  const engineRecoveryTimestampsRef = useRef<number[]>([]);
  const lastEngineRecoveryAtRef = useRef(0);

  const restartEngine = useCallback(() => {
    setEngineRestartToken((value) => value + 1);
  }, []);

  const deviceProfile = useMemo(() => detectDeviceProfile(), []);

  // Both read the machine once. Threads are the one that changes between here
  // and the deploy: `vite.config.ts` sends COOP/COEP so every dev server and
  // every browser test is cross-origin isolated, and GitHub Pages sends
  // neither, so the built app runs single-threaded for real.
  const engineCapabilities = useMemo(
    () => ({ allowSIMD: detectSimdSupport(), allowThreads: detectThreadSupport() }),
    []
  );

  const baseEngineBootConfig = useMemo(
    () => resolveEngineBootConfig(deviceProfile, { ...engineCapabilities, hashMB: engineHashMB, threads: engineThreads }),
    [deviceProfile, engineCapabilities, engineHashMB, engineThreads]
  );

  const engineBootConfig = useMemo(() => {
    if (engineSafetyBootLevel < 1) return baseEngineBootConfig;
    return resolveEngineBootConfig(deviceProfile, {
      ...engineCapabilities,
      hashMB: engineHashMB,
      threads: engineThreads,
      saferBoot: true,
    });
  }, [baseEngineBootConfig, deviceProfile, engineCapabilities, engineHashMB, engineSafetyBootLevel, engineThreads]);

  // A strong player on a sixteen-core machine reading `single-simd` and a
  // few hundred thousand nodes per second is owed the reason, and the reason
  // is not their machine: a page has to be cross-origin isolated before a
  // browser will hand out SharedArrayBuffer, and GitHub Pages does not send
  // those headers. Nothing else in the app says this, so the dashboard does.
  const engineCoreDetail = useMemo(() => {
    const size = `${engineBootConfig.hashMB}MB hash`;
    if (engineBootConfig.saferBoot) {
      return `Running ${engineBootConfig.variant} on one thread with ${size}, after the engine failed to start.`;
    }
    if (!engineCapabilities.allowThreads) {
      return (
        `Running ${engineBootConfig.variant} on one thread with ${size}. ` +
        `A multi-threaded search needs SharedArrayBuffer, which a browser only grants a ` +
        `cross-origin isolated page, and this one is not served with the COOP and COEP ` +
        `headers that would make it so. The search is correct, just slower.`
      );
    }
    return `Running ${engineBootConfig.variant} on ${engineBootConfig.threads} thread${engineBootConfig.threads === 1 ? '' : 's'} with ${size}.`;
  }, [engineBootConfig, engineCapabilities]);

  const engineDetailEnabled = engineEnabled && analysisTab === 'engine' && !isAiTurn && reviewStatus !== 'running';
  const analysisMultiPv = engineDetailEnabled ? enginePvLineCount : 1;
  const analysisWdlEnabled = engineDetailEnabled;
  const liveAnalysisPolicy = useMemo(() => resolveLiveAnalysisPolicy({
    tier: engineBootConfig.tier,
    mode: analysisEngineMode,
    searchDepth,
    detailEnabled: engineDetailEnabled,
  }), [analysisEngineMode, engineBootConfig.tier, engineDetailEnabled, searchDepth]);

  const reviewPolicy = useMemo(() => resolveReviewPolicy(deviceProfile), [deviceProfile]);
  const reviewEngineSummary = useMemo<ReviewEngineSummary>(() => ({
    tier: reviewPolicy.tier,
    baseDepth: reviewPolicy.base.depth,
    baseMoveTimeMs: reviewPolicy.base.moveTimeMs,
    ...(reviewPolicy.revisit
      ? {
          revisitDepth: reviewPolicy.revisit.depth,
          revisitMoveTimeMs: reviewPolicy.revisit.moveTimeMs,
        }
      : {}),
  }), [reviewPolicy]);
  const analysisRequestKey = useMemo(
    () => `${currentPositionCommand}::mode:${analysisEngineMode}::policy:${liveAnalysisPolicy.signature}::detail:${engineDetailEnabled ? 'detail' : 'compact'}::multipv:${analysisMultiPv}`,
    [analysisEngineMode, analysisMultiPv, currentPositionCommand, engineDetailEnabled, liveAnalysisPolicy.signature]
  );
  currentAnalysisRequestKeyRef.current = analysisRequestKey;

  const clearAnalysisDeepenTimer = useCallback(() => {
    if (analysisDeepenTimerRef.current !== null) {
      window.clearTimeout(analysisDeepenTimerRef.current);
      analysisDeepenTimerRef.current = null;
    }
  }, []);

  const flushReviewEvalUpdates = useCallback(() => {
    const controller = reviewControllerRef.current;
    if (controller.flushTimer !== null) {
      window.clearTimeout(controller.flushTimer);
      controller.flushTimer = null;
    }
    if (controller.pendingEvals.size === 0) return;

    const updates = Array.from(controller.pendingEvals.entries()).map(([nodeId, evalScore]) => ({
      nodeId,
      evalScore,
    }));
    controller.pendingEvals.clear();
    setNodeEvals(updates);
  }, [setNodeEvals]);

  const resetReviewController = useCallback((flushPending = false) => {
    const controller = reviewControllerRef.current;
    if (controller.flushTimer !== null) {
      window.clearTimeout(controller.flushTimer);
      controller.flushTimer = null;
    }
    if (flushPending && controller.pendingEvals.size > 0) {
      const updates = Array.from(controller.pendingEvals.entries()).map(([nodeId, evalScore]) => ({
        nodeId,
        evalScore,
      }));
      controller.pendingEvals.clear();
      setNodeEvals(updates);
    }
    reviewControllerRef.current = createReviewController();
  }, [setNodeEvals]);

  const getEffectiveNodeEval = useCallback((nodeId: string | null) => {
    if (!nodeId) return undefined;
    const provisional = reviewControllerRef.current.provisionalEvals.get(nodeId);
    if (typeof provisional === 'number') {
      return provisional;
    }
    return treeNodes[nodeId]?.record?.evalScore;
  }, [treeNodes]);

  const queueReviewEvalUpdate = useCallback((nodeId: string, evalScore: number) => {
    const controller = reviewControllerRef.current;
    controller.provisionalEvals.set(nodeId, evalScore);
    controller.pendingEvals.set(nodeId, evalScore);

    if (controller.pendingEvals.size >= reviewPolicy.batchSize) {
      flushReviewEvalUpdates();
      return;
    }

    if (controller.flushTimer === null) {
      controller.flushTimer = window.setTimeout(() => {
        controller.flushTimer = null;
        flushReviewEvalUpdates();
      }, reviewPolicy.flushMs);
    }
  }, [flushReviewEvalUpdates, reviewPolicy.batchSize, reviewPolicy.flushMs]);

  const finalizeReview = useCallback(() => {
    const controller = reviewControllerRef.current;
    const reviewedAt = Date.now();
    const { summary, annotations } = computeReviewArtifacts(
      activeLineNodeIds,
      treeNodes,
      controller.provisionalEvals,
      reviewedAt,
      reviewEngineSummary,
    );
    flushReviewEvalUpdates();
    setNodeReviewDataBulk(annotations);
    resetReviewController(false);
    completeReview(summary);
    setReviewedLineNodeIds(activeLineNodeIds);
    setAnalysisTab('review');
    setMobileAnalysisTab('review');
  }, [activeLineNodeIds, completeReview, flushReviewEvalUpdates, resetReviewController, reviewEngineSummary, setNodeReviewDataBulk, treeNodes]);

  const handleEngineWorkerError = useCallback((message: string) => {
    const now = Date.now();
    if (now - lastEngineRecoveryAtRef.current < 1000) {
      return;
    }
    lastEngineRecoveryAtRef.current = now;

    engineRecoveryTimestampsRef.current = [
      ...engineRecoveryTimestampsRef.current.filter((timestamp) => now - timestamp < 15000),
      now,
    ];

    applyBestMoveRef.current = false;
    activeAnalysisRequestRef.current = '';
    analysisStageRef.current = 'idle';
    clearAnalysisDeepenTimer();

    if (reviewControllerRef.current.active) {
      resetReviewController(true);
      clearAllReviewData();
      cancelReview();
    }

    if (engineRecoveryTimestampsRef.current.length > 3) {
      logDiagnosticError('Pikafish worker crashed repeatedly; automatic restart suppressed.', message);
      setEngineNotice({ tone: 'danger', text: 'Engine paused after crashes' });
      return;
    }

    setEngineNotice({ tone: 'warning', text: 'Recovering engine' });
    if (workspaceMode === 'analysis') {
      setAnalysisEngineMode('stable');
    }
    if (engineRecoveryTimestampsRef.current.length >= 2) {
      setEngineSafetyBootLevel(1);
    }

    restartEngine();
  }, [cancelReview, clearAllReviewData, clearAnalysisDeepenTimer, resetReviewController, restartEngine, workspaceMode]);

  const {
    isReady,
    isSearching,
    isSearchQueued,
    variant: engineVariant,
    stopSearch,
    getActiveSearchTag,
    queueSearch,
    clearQueuedSearch,
    clearPvLines,
    trimPvLines,
    clearWdl,
    setOption,
    outputLines,
    pvLines,
    wdl,
    searchStats,
    assetProgress,
  } = useEngine({
    enabled: engineRequired,
    restartToken: engineRestartToken,
    variant: engineBootConfig.variant,
    allowSIMD: engineBootConfig.allowSIMD,
    threads: engineBootConfig.threads,
    hashMB: engineBootConfig.hashMB,
    captureInfoLines: assistMode === 'pro' && analysisTab === 'engine',
    onWorkerError: handleEngineWorkerError,
    onBestMove: (uci, score, searchTag, completedPvLines) => {
      const reviewTag = parseReviewTag(searchTag);
      if (reviewTag && reviewControllerRef.current.active) {
        const controller = reviewControllerRef.current;
        if (controller.currentNodeId !== reviewTag.nodeId) {
          return;
        }

        controller.currentNodeId = null;
        const normalizedScore = normalizeEvalForFen(score, getNodeFen(reviewTag.nodeId));
        queueReviewEvalUpdate(reviewTag.nodeId, normalizedScore);

        // Store engine's recommended move for the child node that was actually played
        // so the coach UI can show "Engine suggests X" when a move was a mistake/blunder
        if (uci) {
          const childNodeId = treeNodes[reviewTag.nodeId]?.childrenIds
            .find(cid => activeLineNodeIds.includes(cid));
          // The principal variation arrives with `bestmove` and starts with it,
          // so the line the engine would have played on costs nothing extra to
          // keep -- and without it the review can say which move was better and
          // never what it was for.
          if (childNodeId) setNodeBestMove(childNodeId, uci, completedPvLines[0]?.moves);
        }

        if (reviewTag.phase === 'base' && reviewPolicy.revisit) {
          const record = treeNodes[reviewTag.nodeId]?.record;
          const parentId = treeNodes[reviewTag.nodeId]?.parentId ?? null;
          const parentEval = parentId ? getEffectiveNodeEval(parentId) : undefined;
          if (record && parentId && typeof parentEval === 'number') {
            const side = getReviewSideForRecord(record, Math.max(0, record.ply - 1));
            const swing = getEvalLossForMove(parentEval, normalizedScore, side);
            const recorded = nextCriticalSwing(
              controller.criticalDecisionSwings.get(parentId),
              swing,
              reviewPolicy.revisitThreshold
            );
            if (recorded !== null) controller.criticalDecisionSwings.set(parentId, recorded);
          }
        }

        controller.completed += 1;
        updateReviewProgress(controller.completed, controller.total);
        return;
      }

      const hintTag = parseHintTag(searchTag);
      if (hintTag) {
        setHintPending(false);
        if (uci && hintTag.positionCommand === currentPositionCommand) setHintMove(uci);
        return;
      }

      const aiTag = parseAiTag(searchTag);
      if (aiTag) {
        const shouldApplyAiMove =
          applyBestMoveRef.current &&
          isAiTurn &&
          !gameResult &&
          aiTag.positionCommand === currentPositionCommand;
        applyBestMoveRef.current = false;

        if (shouldApplyAiMove) {
          const choice = chooseAiMoveFromPv({
            fallbackMove: uci || '',
            fallbackScore: score,
            pvLines: completedPvLines,
            searchTag,
            strength: aiTag.strength,
          });
          if (!choice.move) {
            pauseAiWithMoveError('AI move unavailable');
          } else if (applyUciMove(choice.move)) {
            setAiMoveError(null);
          } else {
            pauseAiWithMoveError('AI move rejected');
          }
        }

        if (shouldApplyAiMove && (aiSpeedRef.current === 'step' || stepPendingRef.current)) {
          stepPendingRef.current = false;
          pausedRef.current = true;
          setPaused(true);
        }
        return;
      }

      const analysisTag = parseAnalysisTag(searchTag);
      if (!analysisTag) {
        applyBestMoveRef.current = false;
        return;
      }
      if (
        analysisTag.requestKey !== activeAnalysisRequestRef.current ||
        analysisTag.requestKey !== currentAnalysisRequestKeyRef.current
      ) {
        return;
      }

      if (currentMoveIndex >= 0 && reviewStatus !== 'done') {
        setCurrentNodeEval(normalizeEvalForSide(score, sideToMove));
      }
      drillJudgeRef.current(normalizeEvalForSide(score, sideToMove));

      if (analysisTag.phase === 'deep') setDeepDiveActive(false);

      if (
        analysisTag.phase === 'primary' &&
        liveAnalysisPolicy.deepen &&
        !document.hidden &&
        engineEnabled &&
        !isAiTurn &&
        !reviewControllerRef.current.active &&
        analysisTab === 'engine'
      ) {
        analysisStageRef.current = 'primary-complete';
      } else {
        analysisStageRef.current = 'settled';
      }
    },
  });

  useEffect(() => {
    if (!isReady) return;
    setEngineNotice(engineSafetyBootLevel > 0
      ? { tone: 'warning', text: 'Safe engine mode' }
      : null
    );
  }, [engineSafetyBootLevel, isReady]);

  const reviewRevisitGoCmd = reviewPolicy.revisit?.goCmd ?? null;
  const aiSearchConfig = useMemo(
    () => getAiSearchConfig(aiStrength, WORKER_SAFE_MAX_DEPTH),
    [aiStrength]
  );
  const canGoBack = currentMoveIndex >= 0;
  const canGoForward = currentMoveIndex < moveHistory.length - 1;
  const goToFirstMove = useCallback(() => {
    jumpToMove(-1);
  }, [jumpToMove]);
  const goToPreviousMove = useCallback(() => {
    jumpToMove(currentMoveIndex - 1);
  }, [currentMoveIndex, jumpToMove]);
  const goToNextMove = useCallback(() => {
    jumpToMove(currentMoveIndex + 1);
  }, [currentMoveIndex, jumpToMove]);
  const goToLatestMove = useCallback(() => {
    jumpToMove(moveHistory.length - 1);
  }, [jumpToMove, moveHistory.length]);
  const viewedPly = Math.max(0, currentMoveIndex + 1);
  const timelinePly = Math.min(viewedPly, moveHistory.length);
  const timelineMoveNoun = moveHistory.length === 1 ? 'move' : 'moves';
  const timelineA11yText = moveHistory.length === 0
    ? 'No moves'
    : timelinePly <= 0
      ? `Start position, 0 of ${moveHistory.length} ${timelineMoveNoun}`
      : `Move ${timelinePly} of ${moveHistory.length} ${timelineMoveNoun}`;
  const timelineCompactText = moveHistory.length === 0
    ? 'No moves'
    : timelinePly <= 0
      ? `Start / ${moveHistory.length}`
      : `${timelinePly} / ${moveHistory.length}`;
  const currentLineSignature = useMemo(
    () => makeReviewLineSignature(activeLineNodeIds, treeNodes),
    [activeLineNodeIds, treeNodes]
  );
  const shareNoticePositionKey = useMemo(
    () => `${rootFen}::${currentLineSignature}`,
    [currentLineSignature, rootFen]
  );

  const breadcrumbNodeIds = useMemo(() => {
    const path: string[] = [];
    let cursor: string | null = currentNodeId;
    while (cursor && cursor !== rootNodeId) {
      path.unshift(cursor);
      cursor = treeNodes[cursor]?.parentId ?? null;
    }
    return [rootNodeId, ...path];
  }, [currentNodeId, rootNodeId, treeNodes]);

  useEffect(() => {
    const container = treeBreadcrumbRef.current;
    const active = container?.querySelector('.tree-breadcrumb-chip-active') as HTMLElement | null;
    if (!container || !active) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const activeCenter = container.scrollLeft
      + activeRect.left
      - containerRect.left
      + activeRect.width / 2;
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const targetLeft = Math.max(0, Math.min(maxLeft, activeCenter - container.clientWidth / 2));
    const distance = Math.abs(targetLeft - container.scrollLeft);
    const activeFullyVisible = activeRect.left >= containerRect.left && activeRect.right <= containerRect.right;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = prefersReducedMotion || !activeFullyVisible || distance > container.clientWidth
      ? 'auto'
      : 'smooth';

    if (distance > 1) {
      container.scrollTo({ left: targetLeft, behavior });
    }
    // The panel holding this strip is not always mounted. On a phone the moves
    // are played on the board view, where the breadcrumb does not exist, so the
    // ref is null and this returns early; switching to the moves tab mounts it
    // but changes neither dependency, leaving the strip parked at scrollLeft 0
    // with the current node a thousand pixels off the right edge. Re-run when
    // the view that carries it comes back.
  }, [breadcrumbNodeIds.length, currentNodeId, mobileView, mobileAnalysisTab, analysisTab]);

  /**
   * The breadcrumb is one composite widget, so it gets one tab stop.
   *
   * `rovingFocus.ts` holds the arithmetic and says why. The stop follows focus,
   * so tabbing out and back returns you to the chip you were on rather than to
   * the end of the line.
   */
  const [rovingBreadcrumbIndex, setRovingBreadcrumbIndex] = useState<number | null>(null);
  const breadcrumbCurrentIndex = breadcrumbNodeIds.indexOf(currentNodeId);
  const breadcrumbTabStopIndex = rovingTabStopIndex(
    breadcrumbNodeIds.length,
    rovingBreadcrumbIndex,
    breadcrumbCurrentIndex >= 0 ? breadcrumbCurrentIndex : null
  );

  const handleBreadcrumbKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const next = rovingIndexForKey(event.key, breadcrumbNodeIds.length, index);
    if (next === null) return;
    event.preventDefault();
    setRovingBreadcrumbIndex(next);
    const strip = treeBreadcrumbRef.current;
    const target = strip?.querySelector<HTMLButtonElement>(`[data-breadcrumb-index="${next}"]`);
    target?.focus();
  }, [breadcrumbNodeIds.length]);

  // A role="log" that does not follow its tail shows stale lines while the
  // newest sit below the fold -- measured 42px out of view on desktop. The
  // panel is display:none off-tab, so pinning while hidden writes scrollTop on
  // a 0-height box and achieves nothing; re-pin when it is laid out, the same
  // way the move list does.
  const pinEngineOutput = useCallback(() => {
    const el = engineOutputRef.current;
    if (!el || el.clientHeight === 0) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => { pinEngineOutput(); }, [pinEngineOutput, outputLines]);

  useEffect(() => {
    const el = engineOutputRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let wasCollapsed = el.clientHeight === 0;
    const observer = new ResizeObserver(() => {
      const collapsed = el.clientHeight === 0;
      if (wasCollapsed && !collapsed) pinEngineOutput();
      wasCollapsed = collapsed;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pinEngineOutput, assistMode]);

  const graphBranchCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    activeLineNodeIds.forEach((nodeId, idx) => {
      const children = treeNodes[nodeId]?.childrenIds.length ?? 0;
      if (children > 1) {
        counts[idx] = children;
      }
    });
    return counts;
  }, [activeLineNodeIds, treeNodes]);

  const rootGraphBranchCount = treeNodes[rootNodeId]?.childrenIds.length ?? 0;
  const leftPanelOpen = leftWidth > 0;
  const rightPanelOpen = rightWidth > 0;

  // Sync panel width state → CSS custom property (used for smooth drag via direct DOM updates)
  useEffect(() => {
    document.documentElement.style.setProperty('--left-panel-w', leftWidth + 'px');
  }, [leftWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty('--right-panel-w', rightWidth + 'px');
  }, [rightWidth]);

  const stopAnalysis = useCallback(() => {
    applyBestMoveRef.current = false;
    activeAnalysisRequestRef.current = '';
    analysisStageRef.current = 'idle';
    clearAnalysisDeepenTimer();
    clearQueuedSearch();
    stopSearch();
  }, [clearAnalysisDeepenTimer, clearQueuedSearch, stopSearch]);

  const handleCancelReview = useCallback(() => {
    reviewLineSignatureRef.current = '';
    reviewControllerRef.current.active = false;
    reviewControllerRef.current.currentNodeId = null;
    flushReviewEvalUpdates();
    resetReviewController(false);
    clearAllReviewData();
    cancelReview();
    clearQueuedSearch();
    stopSearch();
  }, [cancelReview, clearAllReviewData, clearQueuedSearch, flushReviewEvalUpdates, resetReviewController, stopSearch]);

  const clearCompletedReview = useCallback(() => {
    reviewLineSignatureRef.current = '';
    reviewControllerRef.current.active = false;
    reviewControllerRef.current.currentNodeId = null;
    resetReviewController(false);
    clearAllReviewData();
    resetReview();
  }, [clearAllReviewData, resetReview, resetReviewController]);

  const resetGame = useCallback(() => {
    stopAnalysis();
    handleCancelReview();
    pausedRef.current = false;
    setPaused(false);
    setAiMoveError(null);
    resetReview();
    resetBoard();
  }, [handleCancelReview, resetBoard, resetReview, stopAnalysis]);

  useEffect(() => {
    if (!engineEnabled) {
      stopAnalysis();
      if (reviewControllerRef.current.active) {
        handleCancelReview();
      }
      trimPvLines(1);
      clearWdl();
    }
  }, [clearWdl, engineEnabled, handleCancelReview, stopAnalysis, trimPvLines]);

  useEffect(() => {
    if (!engineEnabled && analysisTab === 'engine') {
      setAnalysisTab('tree');
    }
  }, [engineEnabled, analysisTab]);

  useEffect(() => {
    if (!engineEnabled && mobileAnalysisTab === 'engine') {
      setMobileAnalysisTab('moves');
    }
  }, [engineEnabled, mobileAnalysisTab]);

  // A finished review outlives a change of line and dies with its line: it is
  // cleared when a move it describes is no longer in the tree (deleted, or a
  // new game loaded without going through resetReview), and not before.
  useEffect(() => {
    if (reviewStatus !== 'done' || !reviewSummary) return;
    if (reviewedLineNodeIds.length > 0 && reviewedLineNodeIds.every((nodeId) => Boolean(treeNodes[nodeId]?.record))) return;
    clearCompletedReview();
  }, [clearCompletedReview, reviewStatus, reviewSummary, reviewedLineNodeIds, treeNodes]);

  /** Whether the board is on the line the review describes. */
  const reviewMatchesActiveLine = reviewStatus === 'done' && reviewSummary?.lineSignature === currentLineSignature;
  /**
   * The records the review's figures are read off. The active line while the
   * board is on it, and the reviewed line itself once the reader has stepped
   * into a variation -- the accuracy by phase, the narrative and the saved
   * annotations all describe the game that was reviewed, not the sideline.
   */
  const reviewedHistory = useMemo(() => {
    if (reviewStatus !== 'done' || reviewMatchesActiveLine) return moveHistory;
    return reviewedLineNodeIds
      .map((nodeId) => treeNodes[nodeId]?.record)
      .filter((record): record is MoveRecord => Boolean(record));
  }, [moveHistory, reviewMatchesActiveLine, reviewStatus, reviewedLineNodeIds, treeNodes]);

  useEffect(() => {
    if (reviewStatus !== 'running') return;
    if (!reviewLineSignatureRef.current) {
      reviewLineSignatureRef.current = currentLineSignature;
      return;
    }
    if (reviewLineSignatureRef.current !== currentLineSignature) {
      handleCancelReview();
    }
  }, [currentLineSignature, handleCancelReview, reviewStatus]);

  useEffect(() => {
    if (!shareLinkNotice?.positionKey) return;
    if (shareLinkNotice.positionKey === shareNoticePositionKey) return;
    setShareLinkNotice(null);
  }, [shareLinkNotice, shareNoticePositionKey]);

  useEffect(() => {
    if (!showMobileBoardActionMenu) return;
    if (isMobile && mobileView === 'board') return;
    setShowMobileBoardActionMenu(false);
  }, [isMobile, mobileView, showMobileBoardActionMenu]);

  // Stop AI engine when game ends
  useEffect(() => {
    if (gameResult) {
      stopAnalysis();
    }
  }, [gameResult, stopAnalysis]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Command/Control+K, the near-universal palette binding and the only
      // chord this app claims. Handled before anything else so it works from a
      // text field too, which is where a reader often is when they reach for it.
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        setShowCommandPalette((open) => !open);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowSettings(false);
        setShowNewGameMenu(false);
        setShowMobileBoardActionMenu(false);
        if (fenErrorTimerRef.current !== null) {
          window.clearTimeout(fenErrorTimerRef.current);
          fenErrorTimerRef.current = null;
        }
        setFenError(null);
        setMoveLineError(null);
      }
    };
    let resizeTimer: number | undefined;
    const onResize = () => {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        setViewportSize({ width: window.innerWidth, height: window.innerHeight });
      }, 50);
    };
    const onVisibilityChange = () => {
      const visible = !document.hidden;
      setIsPageVisible(visible);
      // A deep or infinite search is the one search the reader asked for by
      // name, and the reason to ask is usually so they can do something else
      // while it runs -- which on a browser means another tab. Live analysis
      // and the AI opponent still stop the moment the tab goes away; this one
      // is left alone, and the infinite mode's own description says it runs
      // until stopped.
      if (!visible && deepDiveActiveRef.current) return;
      if (!visible) {
        applyBestMoveRef.current = false;
        activeAnalysisRequestRef.current = '';
        analysisStageRef.current = 'idle';
        clearAnalysisDeepenTimer();
        clearQueuedSearch();
        stopSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    };
  }, [clearAnalysisDeepenTimer, clearQueuedSearch, stopSearch]);

  useEffect(() => {
    const activeDialog = showSettings
      ? settingsDialogRef.current
      : showNewGameMenu
        ? newGameDialogRef.current
        : null;
    if (!activeDialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusInitial = () => {
      if (activeDialog.contains(document.activeElement)) return;
      const firstFocusable = getDialogFocusableElements(activeDialog)[0];
      (firstFocusable ?? activeDialog).focus({ preventScroll: true });
    };

    focusInitial();
    const frame = window.requestAnimationFrame(focusInitial);
    const retryTimer = window.setTimeout(focusInitial, 80);
    const onDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getDialogFocusableElements(activeDialog);
      if (focusable.length === 0) {
        event.preventDefault();
        activeDialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !activeDialog.contains(current))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (current === last || !activeDialog.contains(current))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retryTimer);
      document.removeEventListener('keydown', onDialogKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [showNewGameMenu, showSettings]);

  // Sound effect: fire when a move is played (currentMoveIndex advanced by 1)
  const prevMoveIndexRef = useRef(currentMoveIndex);
  const prevNodeIdRef = useRef(currentNodeId);
  useEffect(() => {
    const prevIdx = prevMoveIndexRef.current;
    const prevNodeId = prevNodeIdRef.current;
    prevMoveIndexRef.current = currentMoveIndex;
    prevNodeIdRef.current = currentNodeId;

    if (
      soundEnabledRef.current &&
      currentMoveIndex === prevIdx + 1 &&
      currentNodeId !== prevNodeId
    ) {
      const record = treeNodes[currentNodeId]?.record;
      if (record) {
        if (record.inCheck) { playCheckSound(); }
        else if (record.captured) { playCaptureSound(); }
        else { playMoveSound(); }
      }
    }
  }, [currentMoveIndex, currentNodeId, treeNodes]);

  useEffect(() => {
    if (!isReady) {
      currentMultiPvRef.current = 1;
      currentShowWdlRef.current = false;
      return;
    }
    if (!engineRequired) return;

    const targetMultiPv = reviewStatus === 'running'
      ? 1
      : isAiTurn
        ? aiSearchConfig.multiPv
        : analysisMultiPv;
    const showWdl = engineDetailEnabled && analysisWdlEnabled;

    if (currentMultiPvRef.current !== targetMultiPv) {
      currentMultiPvRef.current = targetMultiPv;
      setOption('MultiPV', targetMultiPv);
      if (targetMultiPv === 1) {
        trimPvLines(1);
      } else {
        clearPvLines();
      }
    }

    if (currentShowWdlRef.current !== showWdl) {
      currentShowWdlRef.current = showWdl;
      setOption('UCI_ShowWDL', showWdl);
      if (!showWdl) {
        clearWdl();
      }
    }
  }, [aiSearchConfig.multiPv, analysisMultiPv, analysisWdlEnabled, clearPvLines, clearWdl, engineDetailEnabled, engineRequired, isAiTurn, isReady, reviewStatus, setOption, trimPvLines]);

  // Analysis engine effect
  useEffect(() => {
    // Before the teardown below, which is what would otherwise stop the deep
    // search this effect re-runs for: hiding the tab flips `isPageVisible`, and
    // the teardown clears the stage the search is holding. Coming back finds
    // the stage still `deep-pending` and queues nothing, which is the same
    // thing that happens when the tab was never hidden at all.
    if (!isPageVisible && deepDiveActiveRef.current) return;
    if (!engineEnabled || !isReady || isAiTurn || reviewControllerRef.current.active || !isPageVisible) {
      activeAnalysisRequestRef.current = '';
      analysisStageRef.current = 'idle';
      setDeepDiveActive(false);
      clearAnalysisDeepenTimer();
      clearQueuedSearch();
      clearPvLines();
      clearWdl();
      // Only a search this effect started is this effect's to stop. This
      // used to read `isSearching && !applyBestMoveRef.current`, which is
      // true of a *review* search the moment it starts -- `isSearching`
      // flipping is what re-runs the effect, and the review being active is
      // what lands it in this branch -- so every review search was stopped
      // two milliseconds after `go`. Measured with the real engine: eleven
      // review searches in 293ms, reaching depth 5 to 10 against the D16 and
      // 1.5s the panel claimed. A hint during a game had the same stop, for
      // the same reason with the workspace switch in place of the review.
      if (isSearching && parseAnalysisTag(getActiveSearchTag())) {
        stopSearch();
      }
      return;
    }

    // A threat search is running or its result is on screen. Restarting live
    // analysis here would overwrite the one thing the reader asked to see.
    if (threatActive) return;

    if (activeAnalysisRequestRef.current !== analysisRequestKey) {
      activeAnalysisRequestRef.current = analysisRequestKey;
      analysisStageRef.current = 'idle';
      // The deep search belonged to the position that just went away.
      setDeepDiveActive(false);
      clearAnalysisDeepenTimer();
      clearPvLines();
      clearWdl();
      applyBestMoveRef.current = false;
    }

    if (analysisStageRef.current !== 'idle') {
      return;
    }

    analysisStageRef.current = 'primary-pending';
    queueSearch(
      currentPositionCommand,
      liveAnalysisPolicy.primary.goCmd,
      liveAnalysisPolicy.debounceMs,
      makeAnalysisTag('primary', analysisRequestKey),
    );
  }, [
    analysisRequestKey,
    clearAnalysisDeepenTimer,
    clearQueuedSearch,
    clearPvLines,
    clearWdl,
    currentPositionCommand,
    engineEnabled,
    getActiveSearchTag,
    isPageVisible,
    isAiTurn,
    isReady,
    isSearching,
    liveAnalysisPolicy.debounceMs,
    liveAnalysisPolicy.primary.goCmd,
    queueSearch,
    setDeepDiveActive,
    stopSearch,
    threatActive,
  ]);

  useEffect(() => {
    if (analysisStageRef.current !== 'primary-complete') return;
    const deepenPolicy = liveAnalysisPolicy.deepen;
    if (
      !deepenPolicy ||
      !engineEnabled ||
      !isReady ||
      isAiTurn ||
      // A threat is on screen, and a deepen search would replace it with an
      // analysis of the position it is not about. Not reachable through the UI
      // as it stands -- leaving the Engine tab clears `engineDetailEnabled` and
      // settles the stage, and the threat control only exists inside that tab
      // -- but the argument is about tab ordering rather than about this
      // effect, which is exactly the kind of coupling worth stating in code.
      // Toggling a threat now also re-runs this effect, whose cleanup cancels
      // any deepen already scheduled.
      threatActive ||
      reviewControllerRef.current.active ||
      !isPageVisible ||
      !engineDetailEnabled
    ) {
      analysisStageRef.current = 'settled';
      return;
    }

    clearAnalysisDeepenTimer();
    const requestKey = analysisRequestKey;
    analysisDeepenTimerRef.current = window.setTimeout(() => {
      analysisDeepenTimerRef.current = null;
      if (
        activeAnalysisRequestRef.current !== requestKey ||
        currentAnalysisRequestKeyRef.current !== requestKey ||
        analysisStageRef.current !== 'primary-complete' ||
        document.hidden ||
        !engineEnabled ||
        isAiTurn ||
        reviewControllerRef.current.active ||
        !engineDetailEnabled
      ) {
        return;
      }

      analysisStageRef.current = 'deepen-pending';
      queueSearch(
        currentPositionCommand,
        deepenPolicy.goCmd,
        0,
        makeAnalysisTag('deepen', requestKey),
      );
    }, deepenPolicy.delayMs);

    return clearAnalysisDeepenTimer;
  }, [
    analysisRequestKey,
    clearAnalysisDeepenTimer,
    currentPositionCommand,
    engineDetailEnabled,
    engineEnabled,
    isPageVisible,
    isAiTurn,
    isReady,
    liveAnalysisPolicy.deepen,
    queueSearch,
    threatActive,
  ]);

  // AI move effect
  useEffect(() => {
    if (!isReady) return;
    if (!isPageVisible) {
      applyBestMoveRef.current = false;
      return undefined;
    }
    if (gameResult || reviewControllerRef.current.active || reviewStatus === 'running') {
      applyBestMoveRef.current = false;
      return undefined;
    }

    if (!isAiTurn) {
      applyBestMoveRef.current = false;
      return undefined;
    }

    if (isSearching || isSearchQueued) {
      return undefined;
    }

    // If paused, don't start the search (unless stepPending)
    if (pausedRef.current && !stepPendingRef.current) {
      return undefined;
    }

    const delayMs = aiSpeedRef.current === 'step'
      ? 0
      : (AI_SPEED_MS[aiSpeedRef.current as Exclude<AiSpeed, 'step'>] ?? 800);
    const aiSearchDepth = aiSearchConfig.depth;

    const timer = setTimeout(() => {
      if (!isPageVisible) {
        applyBestMoveRef.current = false;
        return;
      }
      // Check again in case pause was set during the delay
      if (pausedRef.current && !stepPendingRef.current) {
        return;
      }
      applyBestMoveRef.current = true;
      queueSearch(
        currentPositionCommand,
        buildAiGoCommand(aiSearchConfig),
        0,
        makeAiTag(currentPositionCommand, aiSearchDepth, aiStrength),
      );
    }, delayMs);

    return () => clearTimeout(timer);
  }, [aiSearchConfig, aiSpeed, aiStrength, currentPositionCommand, gameResult, isAiTurn, isPageVisible, isReady, isSearchQueued, isSearching, paused, queueSearch, reviewStatus]);

  // Review engine drive: when review is running and engine is idle, fire next search
  useEffect(() => {
    const controller = reviewControllerRef.current;
    if (!controller.active) return;
    if (isSearching || isSearchQueued) return;
    if (!isReady) return;
    if (controller.currentNodeId) return;

    if (controller.phase === 'base' && controller.baseQueue.length === 0) {
      if (reviewPolicy.revisit && controller.revisitQueue.length === 0) {
        controller.revisitQueue = selectRevisitNodes(
          controller.criticalDecisionSwings,
          reviewPolicy.revisitLimit
        );

        if (controller.revisitQueue.length > 0) {
          controller.phase = 'revisit';
          controller.total = controller.completed + controller.revisitQueue.length;
          updateReviewProgress(controller.completed, controller.total);
        }
      }

      if (controller.phase === 'base' && controller.baseQueue.length === 0) {
        finalizeReview();
        return;
      }
    }

    if (controller.phase === 'revisit' && controller.revisitQueue.length === 0) {
      finalizeReview();
      return;
    }

    const queue = controller.phase === 'base' ? controller.baseQueue : controller.revisitQueue;
    const nodeId = queue.shift() ?? null;
    if (!nodeId) {
      return;
    }
    controller.currentNodeId = nodeId;
    const goCmd = controller.phase === 'base' ? reviewPolicy.base.goCmd : (reviewRevisitGoCmd ?? reviewPolicy.base.goCmd);
    // The same command shape live analysis sends, rather than a bare FEN. The
    // engine detects repetition from the move list, and in xiangqi a repetition
    // is not a draw: perpetual check and perpetual chase lose for the side
    // forcing them. Reviewing from a FEN alone asked the engine a different
    // question from the one the board was asking, and gave the same node a
    // different evaluation depending on whether it was reviewed or hovered.
    const positionCommand = makeEnginePositionCommand(rootFen, getNodeMoves(nodeId));
    queueSearch(positionCommand, goCmd, 0, makeReviewTag(controller.phase, nodeId));
  }, [finalizeReview, getNodeMoves, isReady, isSearchQueued, isSearching, queueSearch, reviewPolicy.base.goCmd, reviewPolicy.revisit, reviewPolicy.revisitLimit, reviewRevisitGoCmd, reviewStatus, rootFen, updateReviewProgress]);

  const startGameReview = useCallback(() => {
    if (applyBestMoveRef.current) return;
    if (!engineEnabled || !isReady) return;
    if (isAiMode) {
      stepPendingRef.current = false;
      pausedRef.current = true;
      setPaused(true);
    }
    stopAnalysis();
    resetReviewController(true);
    clearAllReviewData();
    clearPvLines();
    clearWdl();
    currentMultiPvRef.current = 1;
    currentShowWdlRef.current = false;
    setOption('MultiPV', 1);
    setOption('UCI_ShowWDL', false);
    setAnalysisTab('review');
    setMobileAnalysisTab('review');
    reviewLineSignatureRef.current = currentLineSignature;

    const totalSteps = activeLineNodeIds.length + 1;
    if (!startReview(totalSteps)) {
      const { summary } = computeReviewArtifacts(activeLineNodeIds, treeNodes, undefined, Date.now(), reviewEngineSummary);
      completeReview(summary);
      return;
    }

    reviewControllerRef.current = {
      ...createReviewController(),
      active: true,
      phase: 'base',
      baseQueue: [rootNodeId, ...activeLineNodeIds],
      total: totalSteps,
    };
  }, [activeLineNodeIds, applyBestMoveRef, clearAllReviewData, clearPvLines, clearWdl, completeReview, currentLineSignature, engineEnabled, isAiMode, isReady, resetReviewController, reviewEngineSummary, rootNodeId, setOption, startReview, stopAnalysis, treeNodes]);

  const clearBoardMarkers = useCallback(() => {
    setUserHighlights((prev) => prev.length ? [] : prev);
    setUserArrows((prev) => prev.length ? [] : prev);
  }, []);

  const handleToggleHighlight = useCallback((square: BoardSquare) => {
    setUserHighlights((prev) => {
      const exists = prev.some((item) => item.file === square.file && item.rank === square.rank);
      if (exists) {
        return prev.filter((item) => item.file !== square.file || item.rank !== square.rank);
      }
      return [...prev, square].slice(-12);
    });
  }, []);

  const handleAddUserArrow = useCallback((from: BoardSquare, to: BoardSquare) => {
    setUserArrows((prev) => {
      const isSameArrow = (arrow: BoardArrow) =>
        arrow.from.file === from.file &&
        arrow.from.rank === from.rank &&
        arrow.to.file === to.file &&
        arrow.to.rank === to.rank;
      const exists = prev.some(isSameArrow);
      const withoutExisting = prev.filter((arrow) => !isSameArrow(arrow));
      if (exists) return withoutExisting;
      const nextArrow: BoardArrow = { from, to, color: '#60a5fa', kind: 'user', opacity: 0.72, strokeWidth: 4 };
      return [
        ...withoutExisting,
        nextArrow,
      ].slice(-12);
    });
  }, []);

  useEffect(() => {
    clearBoardMarkers();
  }, [clearBoardMarkers, currentNodeId]);

  const [moveRuleHint, setMoveRuleHint] = useState<string | null>(null);
  const moveRuleHintTimerRef = useRef<number | null>(null);
  const clearMoveRuleHint = useCallback(() => {
    if (moveRuleHintTimerRef.current !== null) {
      window.clearTimeout(moveRuleHintTimerRef.current);
      moveRuleHintTimerRef.current = null;
    }
    setMoveRuleHint(null);
  }, []);

  const showMoveRuleHint = useCallback((message: string) => {
    if (moveRuleHintTimerRef.current !== null) {
      window.clearTimeout(moveRuleHintTimerRef.current);
    }
    setMoveRuleHint(message);
    moveRuleHintTimerRef.current = window.setTimeout(() => {
      moveRuleHintTimerRef.current = null;
      setMoveRuleHint(null);
    }, 3200);
  }, []);

  const handleSquareClick = useCallback((file: number, rank: number) => {
    if (gameResult) return;
    if (!isAiTurn) {
      if (selected) {
        const clickedPiece = board[rank]?.[file] || '';
        const clickedOwnPiece = Boolean(clickedPiece) && pieceSide(clickedPiece) === sideToMove;
        const clickedSameSquare = selected.file === file && selected.rank === rank;
        const clickedLegalTarget = validTargets.some((target) => target.file === file && target.rank === rank);
        if (!clickedSameSquare && !clickedOwnPiece && !clickedLegalTarget) {
          const uci = squareToUci(selected.file, selected.rank) + squareToUci(file, rank);
          const validation = validatePieceMove(board, {
            fromFile: selected.file,
            fromRank: selected.rank,
            toFile: file,
            toRank: rank,
            raw: uci,
          }, sideToMove);
          showMoveRuleHint(formatMoveRuleHint(validation.reason));
          return;
        }
      }

      const moved = onSquareClick(file, rank);
      if (moved) {
        clearBoardMarkers();
        clearMoveRuleHint();
      } else if (
        !selected ||
        (selected.file === file && selected.rank === rank) ||
        pieceSide(board[rank]?.[file] || '') === sideToMove
      ) {
        clearMoveRuleHint();
      }
    }
  }, [board, clearBoardMarkers, clearMoveRuleHint, gameResult, isAiTurn, onSquareClick, selected, showMoveRuleHint, sideToMove, validTargets]);

  const applyMode = useCallback((mode: GameMode) => {
    if (isAiGameModeValue(mode)) {
      setWorkspaceMode('play');
    }
    setGameMode(mode);
    const facing = orientationForHuman(mode);
    if (facing) setOrientation(facing);
    resetGame();
  }, [resetGame]);

  /**
   * Keep this position and start playing it against the engine.
   *
   * Switching to a Play mode goes through `applyMode`, which resets the board --
   * so the one thing you most want to do after a review found your mistake was
   * the one thing you could not do. You could see that move 15 was a blunder and
   * be told what was better, and then had no way to try it.
   *
   * You take the side to move, because the position is being handed to you at
   * the moment it is your turn. That is also what makes it safe: the engine does
   * not move first, so nothing happens until you play something.
   *
   * The line up to here is kept rather than the whole game -- playing on from
   * move 15 of a 40-move game means the moves after 15 did not happen.
   */
  const playFromHere = useCallback(() => {
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    setPaused(false);
    // The mode names the *engine's* side, so the human gets the other one.
    setGameMode(sideToMove === 'w' ? 'PvAI-Black' : 'PvAI-Red');
    setOrientation(sideToMove === 'w' ? 'red' : 'black');
    setWorkspaceMode('play');
    loadMoves(currentLineMoves, rootFen);
    setGraphLoadSweepToken((token) => token + 1);
    setMobileView('board');
  }, [currentLineMoves, handleCancelReview, loadMoves, resetReview, rootFen, sideToMove, stopAnalysis]);

  const openLibraryPanel = useCallback(() => {
    setShowMobileBoardActionMenu(false);
    setLeftWidth((width) => width === 0 ? DEFAULT_LEFT_PANEL_WIDTH : width);
    setLeftPanelTab('library');
    setMobileAnalysisTab('library');
    setMobileView('analysis');
  }, []);

  const adjustLeftPanelWidth = useCallback((delta: number) => {
    setLeftWidth((width) => stepPanelWidth(width, delta, DEFAULT_LEFT_PANEL_WIDTH));
  }, []);

  const adjustRightPanelWidth = useCallback((delta: number) => {
    setRightWidth((width) => stepPanelWidth(width, delta, DEFAULT_RIGHT_PANEL_WIDTH));
  }, []);

  // The tab strips announce role="tablist"; arrow, Home and End keys are part of
  // that contract. Activating on focus is fine here — switching a panel is cheap
  // and reversible. Claiming the key also keeps it from reaching the global move
  // shortcuts while a tab has focus.
  const handleTablistKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')
    );
    const from = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (from === -1) return;
    const next = key === 'Home'
      ? 0
      : key === 'End'
        ? tabs.length - 1
        : (from + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  }, []);

  const handleLeftResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustLeftPanelWidth(-PANEL_KEYBOARD_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      adjustLeftPanelWidth(PANEL_KEYBOARD_STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setLeftWidth(0);
    } else if (event.key === 'End' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setLeftWidth(DEFAULT_LEFT_PANEL_WIDTH);
    }
  }, [adjustLeftPanelWidth]);

  const handleRightResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustRightPanelWidth(PANEL_KEYBOARD_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      adjustRightPanelWidth(-PANEL_KEYBOARD_STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setRightWidth(0);
    } else if (event.key === 'End' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setRightWidth(DEFAULT_RIGHT_PANEL_WIDTH);
    }
  }, [adjustRightPanelWidth]);

  const startLeftResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add('resizing');
    const startX = event.clientX;
    const startW = leftWidth;
    let last = startW;
    const onMove = (e: PointerEvent) => {
      const next = startW + e.clientX - startX;
      last = clampPanelWidth(next);
      document.documentElement.style.setProperty('--left-panel-w', last + 'px');
    };
    const onUp = () => {
      document.body.classList.remove('resizing');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      setLeftWidth(last);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, [leftWidth]);

  const startRightResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add('resizing');
    const startX = event.clientX;
    const startW = rightWidth;
    let last = startW;
    const onMove = (e: PointerEvent) => {
      const next = startW - (e.clientX - startX);
      last = clampPanelWidth(next);
      document.documentElement.style.setProperty('--right-panel-w', last + 'px');
    };
    const onUp = () => {
      document.body.classList.remove('resizing');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      setRightWidth(last);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, [rightWidth]);

  const currentModeMeta = GAME_MODES.find((candidate) => candidate.mode === gameMode) ?? GAME_MODES[0];
  const pendingModeMeta = GAME_MODES.find((candidate) => candidate.mode === pendingGameMode) ?? GAME_MODES[0];
  const currentModeLabel = currentModeMeta.label;
  const pendingModeLabel = pendingModeMeta.label;
  const pendingModeIsAi = pendingGameMode !== 'PvP';
  const currentAnalysisPvLines = useMemo(() => {
    if (!engineEnabled) return [];
    return pvLines.filter((pv) => parseAnalysisTag(pv.searchTag)?.requestKey === analysisRequestKey);
  }, [analysisRequestKey, engineEnabled, pvLines]);
  /**
   * The engine's answer to the threat question, kept apart from the analysis of
   * the position on screen -- they are evaluations of two different positions
   * and must never be read as one.
   */
  const threatPvLines = useMemo(() => {
    if (!engineEnabled || !threatActive) return [];
    return pvLines.filter((pv) => parseThreatTag(pv.searchTag)?.requestKey === analysisRequestKey);
  }, [analysisRequestKey, engineEnabled, pvLines, threatActive]);
  const threatPv = threatPvLines[0] ?? null;
  const threatMove = threatPv?.moves[0] ?? null;
  const spotlightPvLine = spotlightPvIndex == null ? null : currentAnalysisPvLines[spotlightPvIndex] ?? null;
  useEffect(() => {
    setSpotlightPvIndex(null);
  }, [analysisRequestKey]);
  const engineSearchDetail = useMemo(
    () => formatEngineTelemetryDetail(
      searchStats,
      liveAnalysisPolicy.primary.depth,
      liveAnalysisPolicy.primary.moveTimeMs,
      isSearchQueued,
      isSearching,
      isReady,
    ),
    [isReady, isSearchQueued, isSearching, liveAnalysisPolicy.primary.depth, liveAnalysisPolicy.primary.moveTimeMs, searchStats]
  );
  const topAnalysisPv = currentAnalysisPvLines[0] ?? null;
  const visibleEngineOutputLineCount = Math.min(outputLines.length, 20);
  const engineOutputTerminalLabel = visibleEngineOutputLineCount > 0
    ? `Raw engine UCI output, showing latest ${visibleEngineOutputLineCount} ${visibleEngineOutputLineCount === 1 ? 'line' : 'lines'}`
    : 'Raw engine UCI output, waiting for engine output';
  const coachBestMoveText = topAnalysisPv?.moves[0]
    ? formatLineInStyle(board, [topAnalysisPv.moves[0]], notationStyle, 1)
    : isSearchQueued || isSearching
      ? 'Waiting for engine'
      : 'No engine move yet';
  const coachLineText = topAnalysisPv?.moves.length
    ? formatLineInStyle(board, topAnalysisPv.moves, notationStyle, 5)
    : isSearchQueued || isSearching
      ? 'Waiting for engine line'
      : 'No engine line yet';
  const liveEvalScore = currentAnalysisPvLines[0]?.score ?? null;
  const displayEvalScore = useMemo(
    () => typeof liveEvalScore === 'number' ? normalizeEvalForSide(liveEvalScore, sideToMove) : null,
    [liveEvalScore, sideToMove]
  );
  // `wdl` comes straight off the engine and carries no search tag, unlike the
  // PV lines. While a threat is showing, the running search is of a different
  // position with the other side to move, so those numbers describe neither the
  // position nor the side this bar is drawn for -- they would arrive inverted
  // and labelled as the position's own. There is no win/draw/loss reading for
  // the board while the question on screen is about a passed move.
  const displayWdl = useMemo(
    () => (threatActive ? null : normalizeWdlForSide(wdl, sideToMove)),
    [sideToMove, threatActive, wdl]
  );
  const shouldShowWdlBar = engineEnabled && (engineDetailEnabled || displayWdl !== null);
  const currentEvalText = topAnalysisPv
    ? formatRedPovEngineScore(topAnalysisPv, sideToMove)
    : null;
  const redPerspectiveEvalText = currentEvalText ? `Red POV ${currentEvalText}` : null;
  const liveEvalLabel = currentEvalText ? `Live engine evaluation, ${redPerspectiveEvalText}` : undefined;
  // Only where the board leaves room beside it. On a phone the board is the
  // full width of the screen and there is no gutter to sit in; the eval is on
  // the mobile header chip and in the analysis tab there instead.
  const engineHashChoices = useMemo(() => hashChoicesForTier(deviceProfile.tier), [deviceProfile.tier]);
  const deepDiveBudget = useMemo(() => resolveDeepDiveBudget(deviceProfile.tier), [deviceProfile.tier]);
  const engineThreadChoices = useMemo(
    () => threadChoicesForProfile(deviceProfile, engineCapabilities.allowThreads),
    [deviceProfile, engineCapabilities]
  );
  const showEvalBar = engineEnabled && !isMobile;
  // No eval to show, nothing wrong, and not ready yet: the wait itself.
  const mobileEngineLoading = engineEnabled && !isReady && displayEvalScore === null;

  const displayEvalClass = displayEvalScore === null
    ? ''
    : displayEvalScore > 0
      ? 'eval-positive'
      : displayEvalScore < 0
        ? 'eval-negative'
        : '';

  const sideToMoveLabel = sideToMove === 'w' ? 'Red' : 'Black';
  const selectedPieceRaw = selected ? board[selected.rank][selected.file] : '';
  const selectedPiece = selectedPieceRaw && isPieceCode(selectedPieceRaw) ? selectedPieceRaw : null;
  const legalCaptureCount = useMemo(
    () => validTargets.filter((target) => target.capture).length,
    [validTargets]
  );
  const selectedSquareText = selected ? formatSquare(selected) : '';
  const selectedPieceText = selectedPiece
    ? `${PIECE_NAMES[selectedPiece]} on ${selectedSquareText}`
    : 'No piece selected';
  const legalMoveCountText = `${validTargets.length} ${validTargets.length === 1 ? 'move' : 'moves'}${legalCaptureCount > 0 ? ` · ${legalCaptureCount} ${legalCaptureCount === 1 ? 'capture' : 'captures'}` : ''}`;
  const legalMoveText = selectedPiece
    ? `${assistMode === 'coach' ? `${PIECE_MOVE_HINTS[selectedPiece]} · ` : ''}${legalMoveCountText}`
    : `${sideToMoveLabel} to move`;

  // A screen reader needs one thing from the board: what just happened. The
  // dock used to be the live region, so a move announced the selection being
  // cleared ("No piece selected") and never the move itself. Announce the
  // selection while a piece is held, and otherwise the move now in view.
  const boardAnnouncement = useMemo(() => {
    if (selectedPiece) return `${selectedPieceText}. ${legalMoveText}.`;
    const record = currentMoveIndex >= 0 ? moveHistory[currentMoveIndex] : null;
    const move = record ? `${formatMoveRecordTitle(record)}.` : 'Start position.';
    // Once the game is over there is no side to move, and saying "Check. Black
    // to move." after a mate contradicts the result the modal is showing.
    // Read the outcome the same way the modal derives its subtitle.
    if (gameResult) {
      if (gameResult === 'draw') return `${move} Draw.`;
      const winner = gameResult === 'red-wins' ? 'Red' : 'Black';
      const how = hasAnyLegalMove(board, sideToMove)
        ? ''
        : inCheck ? ' Checkmate.' : ' No legal moves.';
      return `${move}${how} ${winner} wins.`;
    }
    return `${move}${inCheck ? ' Check.' : ''} ${sideToMoveLabel} to move.`;
  }, [
    selectedPiece, selectedPieceText, legalMoveText,
    currentMoveIndex, moveHistory, inCheck, sideToMoveLabel,
    gameResult, board, sideToMove,
  ]);

  // The start position, not the standard opening set: a game loaded from a FEN
  // began where its FEN says, and subtracting from the standard set reported
  // every piece that setup never had as one this game captured.
  const rootBoardForMaterial = useMemo(() => {
    try {
      return parseFenBoard(rootFen.split(/\s+/)[0]);
    } catch {
      return parseFenBoard(START_FEN);
    }
  }, [rootFen]);
  const materialSummary = useMemo(
    () => summarizeMaterial(board, rootBoardForMaterial),
    [board, rootBoardForMaterial]
  );

  const materialText = materialSummary.deltaTenths > 0
    ? `Red +${formatMaterialValue(materialSummary.deltaTenths)}`
    : materialSummary.deltaTenths < 0
      ? `Black +${formatMaterialValue(Math.abs(materialSummary.deltaTenths))}`
      // The card is already labelled Material; repeating the word here made the
      // level case read differently from "Red +1.4" for no reason.
      : 'Even';
  const canSaveCurrentPosition = moveHistory.length > 0 || rootFen !== START_POSITION_FEN || hasMoveTreeMoves;
  const canExportCurrentLine = (currentMoveIndex >= 0 && moveHistory.length > 0) || hasMoveTreeMoves;
  // A finished game has nothing to play on from, and the starting position is
  // already what "New game" gives you.
  const canPlayFromHere = !gameResult && (currentMoveIndex >= 0 || rootFen !== START_POSITION_FEN);
  const canShareCurrentPosition = canExportCurrentLine || rootFen !== START_POSITION_FEN;


  const gameOverKey = gameResult ? `${gameResult}:${currentFen}:${moveHistory.length}` : null;
  const [dismissedGameOverKey, setDismissedGameOverKey] = useState<string | null>(null);
  const visibleGameResult = gameResult && gameOverKey !== dismissedGameOverKey ? gameResult : null;
  const visibleGameOverReason = useMemo(() => {
    if (!visibleGameResult || visibleGameResult === 'draw') return undefined;
    if (hasAnyLegalMove(board, sideToMove)) return 'result';
    return inCheck ? 'checkmate' : 'stalemate';
  }, [board, inCheck, sideToMove, visibleGameResult]);
  const aiMoveSearchActive = isAiTurn && (isSearching || isSearchQueued);
  const boardAiStatusText = aiMoveError
    ?? (paused
      ? 'AI paused'
      : aiMoveSearchActive && applyBestMoveRef.current
        ? 'AI thinking'
        // The AI cannot search until the engine is ready. Without this the board
        // said nothing at all on its turn -- while booting, while recovering
        // after a crash, and for as long as an engine that never loads keeps
        // the turn -- so the game simply appeared to stop.
        : isAiTurn && !isReady
          ? 'Waiting for engine'
          : '');
  const analysisActivity = resolveAnalysisActivity({
    engineEnabled,
    isReady,
    pageVisible: isPageVisible,
    deepSearchRunning: deepDiveActive,
    isSearchQueued,
    isSearching,
  });
  const analysisIsStalled = isAnalysisActivityStalled(analysisActivity);
  // A boot failure has a message of its own and it is more specific than
  // "Loading engine", so it still wins that slot.
  const bottomEngineStatus = !isReady
    ? engineNotice?.text ?? formatAnalysisActivity(analysisActivity)
    : formatAnalysisActivity(analysisActivity);
  /**
   * The engine's weights are 53MB and the whole app waits on them, so "Loading
   * engine" used to stand alone for a minute or more on a phone connection --
   * indistinguishable from an engine that is never coming. The count comes out
   * of the worker, which is the only place that can see the request at all.
   */
  const engineDownloadText = formatEngineDownload(assetProgress);
  const engineDownloadShortText = formatEngineDownloadShort(assetProgress);
  const topEngineStatusText = engineNotice?.text ?? (
    isReady
      ? 'Engine ready'
      : engineDownloadText
        ? `Loading engine · ${engineDownloadText}`
        : 'Loading engine'
  );
  const topEngineStatusLabel = isReady
    ? `${topEngineStatusText}, runtime ${engineVariant}`
    : topEngineStatusText;
  /**
   * One move of the reviewed line, in the reader's notation.
   *
   * A key moment carries node ids rather than boards, and both real notations
   * need the position the move was played in -- so the lookup happens here,
   * where the tree is, rather than by handing every moment a board copy.
   */
  const formatReviewMoveText = useCallback((nodeId: string, uci: string) => {
    if (notationStyle === 'uci') return formatUciMove(uci);
    const record = treeNodes[nodeId]?.record;
    const before = record ? boardBeforeRecord(record) : null;
    return before ? formatMoveInStyle(before, uci, notationStyle) : formatUciMove(uci);
  }, [notationStyle, treeNodes]);

  /**
   * The engine's line from the position before a move, in the reader's
   * notation. Every move after the first needs the board the one before it
   * left, which is what `formatLineInStyle` walks -- a per-move formatter
   * cannot do this, since it only ever has one board.
   */
  const formatReviewLineText = useCallback((nodeId: string, moves: string[]) => {
    if (notationStyle === 'uci') return moves.map((uci) => formatUciMove(uci)).join(' ');
    const record = treeNodes[nodeId]?.record;
    const before = record ? boardBeforeRecord(record) : null;
    if (!before) return moves.map((uci) => formatUciMove(uci)).join(' ');
    return formatLineInStyle(before, moves, notationStyle, moves.length);
  }, [notationStyle, treeNodes]);

  /**
   * Whether this position has stood here before, and what the rules say about
   * how it got back.
   *
   * Read off the played line rather than the whole tree: a repetition is a
   * property of the moves actually made, and a variation explored and left is
   * not one of them.
   */
  const repetition = useMemo(() => {
    const line = moveHistory.slice(0, currentMoveIndex + 1).map((record) => ({
      board: record.board,
      sideToMove: record.sideToMove,
      inCheck: record.inCheck,
    }));
    // The root comes from its FEN rather than from the hook, which does not
    // expose the board -- and the FEN is already the hook's own description of
    // that position, so there is nothing to keep in step.
    const [placement, sideChar] = rootFen.trim().split(/\s+/);
    return describeRepetition(parseFenBoard(placement), sideChar === 'b' ? 'b' : 'w', line);
  }, [currentMoveIndex, moveHistory, rootFen]);
  /**
   * chessdb.cn's ruling on the moves from here, once the position has stood
   * here before. It is the part `describeRepetition` cannot do: a chase.
   */
  const repetitionLineMoves = useMemo(
    () => moveHistory.slice(0, currentMoveIndex + 1).map((record) => record.uci),
    [currentMoveIndex, moveHistory]
  );
  const cloudRule = useCloudRule(rootFen, repetitionLineMoves, repetition.occurrences >= 2, cloudBookEnabled);
  const cloudRuleHasVerdict = cloudRule.status === 'ok' && (cloudRule.banned.length > 0 || cloudRule.drawing.length > 0);
  // A forbidden move is worth saying at the first repetition, before it is
  // played, whatever the threshold for an unforced one.
  const visibleRepetition = shouldReportRepetition(repetition) || cloudRuleHasVerdict ? repetition : null;
  /**
   * Why a won ending reads level. The clock is already the fifth field of the
   * FEN the board hands the engine, so this needs no state of its own.
   */
  const captureFree = useMemo(
    () => describeCaptureFree(readCaptureFreePlies(currentFen)),
    [currentFen]
  );
  const cloudRuleText = useMemo(() => {
    if (!cloudRuleHasVerdict) return null;
    const name = (uci: string) => formatMoveInStyle(board, uci, notationStyle);
    const parts: string[] = [];
    if (cloudRule.banned.length > 0) {
      parts.push(`${cloudRule.banned.map(name).join(', ')} ${cloudRule.banned.length === 1 ? 'is' : 'are'} forbidden: repeating it loses.`);
    }
    if (cloudRule.drawing.length > 0) {
      parts.push(`${cloudRule.drawing.map(name).join(', ')} would be ruled a draw.`);
    }
    return `${CLOUD_BOOK_SITE_NAME}: ${parts.join(' ')}`;
  }, [board, cloudRule.banned, cloudRule.drawing, cloudRuleHasVerdict, notationStyle]);

  const canStartReview = engineEnabled && isReady && moveHistory.length > 0 && !aiMoveSearchActive;
  const engineUnavailableReviewTitle = engineNotice?.text ?? 'Engine is still loading';
  const engineUnavailableReviewLabel = engineNotice?.text === 'Engine paused after crashes'
    ? 'Engine Paused'
    : engineNotice?.text === 'Recovering engine'
      ? 'Recovering Engine'
      : 'Engine Loading';
  const reviewStartTitle = !engineEnabled
    ? 'Switch to Analysis to review this line'
    : moveHistory.length === 0
      ? 'Play or import moves before running review'
      : !isReady
        ? engineUnavailableReviewTitle
        : aiMoveSearchActive
          ? 'AI is finishing its move'
          : 'Analyze all moves in the current line';
  const reviewStartLabel = canStartReview
    ? 'Run Review'
    : !engineEnabled
      ? 'Analysis Off'
      : moveHistory.length === 0
        ? 'No Moves Yet'
        : !isReady
          ? engineUnavailableReviewLabel
          : aiMoveSearchActive
            ? 'AI Thinking'
            : 'No Moves Yet';

  useEffect(() => {
    if (!gameResult) {
      setDismissedGameOverKey(null);
    }
  }, [gameResult]);

  const lastMoveUci = treeNodes[currentNodeId]?.record?.uci ?? null;
  const lastMoveFrom = useMemo(() => lastMoveUci ? uciToSquare(lastMoveUci.substring(0, 2)) : null, [lastMoveUci]);
  const lastMoveTo   = useMemo(() => lastMoveUci ? uciToSquare(lastMoveUci.substring(2, 4)) : null, [lastMoveUci]);

  const lastMoveArrowColor = useMemo(() => {
    const record = treeNodes[currentNodeId]?.record;
    const currentEval = record?.evalScore;
    const parentId    = treeNodes[currentNodeId]?.parentId;
    // Same baseline the move tree and the eval graph use for a first move: the
    // root holds no record, so `parentId ? lookup : 0` found nothing and left
    // the opening move's arrow grey while every later one was coloured. The
    // root's id is truthy, so the zero was unreachable.
    const parentIsRoot = !parentId || parentId === rootNodeId;
    const parentEval  = parentIsRoot ? 0 : treeNodes[parentId]?.record?.evalScore;
    if (!record || typeof currentEval !== 'number' || typeof parentEval !== 'number') return '#94a3b8';
    const side = getReviewSideForRecord(record, record.ply - 1);
    const delta = getEvalLossForMove(parentEval, currentEval, side);
    return getQualityArrowColor(classifyMoveQualityForEval(delta, parentEval, currentEval, side));
  }, [currentNodeId, rootNodeId, treeNodes]);

  // Opening recognition
  // Both pass the root: the book names lines from the standard array, and the
  // same four moves from somewhere else are four moves, not that opening.
  const detectedOpening = useMemo(() => {
    const uciMoves = moveHistory.slice(0, currentMoveIndex + 1).map(r => r.uci);
    return matchOpening(uciMoves, rootFen);
  }, [moveHistory, currentMoveIndex, rootFen]);
  const openingCandidates = useMemo(() => {
    const uciMoves = moveHistory.slice(0, currentMoveIndex + 1).map(r => r.uci);
    return getOpeningCandidates(uciMoves, assistMode === 'pro' ? 6 : 4, rootFen);
  }, [assistMode, currentMoveIndex, moveHistory, rootFen]);

  // The cloud book answers the same question the local book does -- what is
  // played here -- from a database no bundled table could match. Asked only
  // when switched on, and only for the position on the board.
  const cloudBookReading = useCloudBook(currentFen, cloudBookEnabled);
  // The hook answers for the position it was last asked about, and for the
  // frame between a navigation and its effect that is the previous one.
  // Drawing that list under the new side's label would put Red's moves
  // beside 'for Black', so anything not for this position reads as loading.
  const cloudBook = cloudBookReading.fen === currentFen || cloudBookReading.status === 'off'
    ? cloudBookReading
    : { status: 'loading' as const, moves: [], fen: currentFen };
  const cloudBookMoveLimit = assistMode === 'pro' ? 6 : 4;

  // Game library
  const { games: savedGames, save: saveGameToLibrary, remove: deleteGameFromLibrary, rename: renameGameInLibrary } = useGameLibrary();

  // "Have I been here before?" over the games the player owns.
  //
  // Built once per change to the library rather than searched per position:
  // measured at 24ms for 200 games of 120 plies and 267ms for a full 500-game
  // library of 1024-move games, against a 9-microsecond lookup. Doing it the
  // other way round would pay the whole cost on every position stepped through.
  const librarySignature = useMemo(() => libraryPositionSignature(savedGames), [savedGames]);
  const libraryPositionIndex = useMemo(
    () => buildLibraryPositionIndex(savedGames),
    // Keyed on the signature, so re-reading storage into an equal array does
    // not rebuild the whole index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [librarySignature]
  );
  const libraryPositionReport = useMemo(
    () => lookupLibraryPosition(libraryPositionIndex, board, sideToMove),
    [libraryPositionIndex, board, sideToMove]
  );

  const [copiedToast, setCopiedToast] = useState(false);
  const [copiedFenToast, setCopiedFenToast] = useState(false);
  const [copiedRecordToast, setCopiedRecordToast] = useState(false);
  const copiedRecordToastTimerRef = useRef<number | null>(null);
  const [copiedShareToast, setCopiedShareToast] = useState(false);
  const [downloadedPgnToast, setDownloadedPgnToast] = useState(false);
  const [engineHashFeedback, setEngineHashFeedback] = useState<EngineHashFeedback>(null);
  const [copiedPvIndex, setCopiedPvIndex] = useState<number | null>(null);
  const [exportFailureKey, setExportFailureKey] = useState<ExportFailureKey | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const [saveFailedToast, setSaveFailedToast] = useState(false);
  const savedToastTimerRef = useRef<number | null>(null);
  const copiedToastTimerRef = useRef<number | null>(null);
  const copiedFenToastTimerRef = useRef<number | null>(null);
  const copiedShareToastTimerRef = useRef<number | null>(null);
  const downloadedPgnTimerRef = useRef<number | null>(null);
  const clearedHashTimerRef = useRef<number | null>(null);
  // A paste can hold a whole database. Only the first game is read, and saying
  // so is the difference between a deliberate choice and silently losing the
  // rest -- which is what it looked like before the importer stopped running
  // the games together.
  /**
   * The slot is capped at about 25 characters, so what is shown and what is
   * read out cannot be the same string. They used to be one hardcoded pair
   * describing a multi-game paste, which became wrong the moment a second kind
   * of notice started using this slot: a reader was told "imported the first
   * game only" about a record that was nothing of the sort.
   */
  const [importNotice, setImportNotice] = useState<{ text: string; label: string } | null>(null);
  const importNoticeTimerRef = useRef<number | null>(null);
  const showImportNotice = useCallback((text: string | null, label?: string) => {
    if (importNoticeTimerRef.current !== null) {
      window.clearTimeout(importNoticeTimerRef.current);
      importNoticeTimerRef.current = null;
    }
    setImportNotice(text ? { text, label: label ?? text } : null);
    if (!text) return;
    importNoticeTimerRef.current = window.setTimeout(() => {
      importNoticeTimerRef.current = null;
      setImportNotice(null);
    }, 12000);
  }, []);
  useEffect(() => () => {
    if (importNoticeTimerRef.current !== null) window.clearTimeout(importNoticeTimerRef.current);
  }, []);
  const copiedPvTimerRef = useRef<number | null>(null);
  const exportFailureTimerRef = useRef<number | null>(null);
  const fenErrorTimerRef = useRef<number | null>(null);
  const moveLineFileInputRef = useRef<HTMLInputElement | null>(null);
  const shareLinkLoadedRef = useRef(false);
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);
  const [moveLineInput, setMoveLineInput] = useState('');
  const [moveLineFileName, setMoveLineFileName] = useState('');
  const [moveLineError, setMoveLineError] = useState<string | null>(null);
  const showMobilePgnAction =
    canExportCurrentLine ||
    downloadedPgnToast ||
    exportFailureKey === 'download-pgn';
  const showMobileShareAction =
    canShareCurrentPosition ||
    copiedShareToast ||
    exportFailureKey === 'copy-share';

  useEffect(() => {
    return () => {
      if (savedToastTimerRef.current !== null) {
        window.clearTimeout(savedToastTimerRef.current);
      }
      if (copiedToastTimerRef.current !== null) {
        window.clearTimeout(copiedToastTimerRef.current);
      }
      if (copiedFenToastTimerRef.current !== null) {
        window.clearTimeout(copiedFenToastTimerRef.current);
      }
      if (copiedRecordToastTimerRef.current !== null) {
        window.clearTimeout(copiedRecordToastTimerRef.current);
      }
      if (copiedShareToastTimerRef.current !== null) {
        window.clearTimeout(copiedShareToastTimerRef.current);
      }
      if (downloadedPgnTimerRef.current !== null) {
        window.clearTimeout(downloadedPgnTimerRef.current);
      }
      if (clearedHashTimerRef.current !== null) {
        window.clearTimeout(clearedHashTimerRef.current);
      }
      if (copiedPvTimerRef.current !== null) {
        window.clearTimeout(copiedPvTimerRef.current);
      }
      if (moveRuleHintTimerRef.current !== null) {
        window.clearTimeout(moveRuleHintTimerRef.current);
      }
      if (exportFailureTimerRef.current !== null) {
        window.clearTimeout(exportFailureTimerRef.current);
      }
      if (fenErrorTimerRef.current !== null) {
        window.clearTimeout(fenErrorTimerRef.current);
      }
    };
  }, []);

  const clearExportFailure = useCallback(() => {
    if (exportFailureTimerRef.current !== null) {
      window.clearTimeout(exportFailureTimerRef.current);
      exportFailureTimerRef.current = null;
    }
    setExportFailureKey(null);
  }, []);

  const showExportFailure = useCallback((key: ExportFailureKey) => {
    if (exportFailureTimerRef.current !== null) {
      window.clearTimeout(exportFailureTimerRef.current);
    }
    setExportFailureKey(key);
    exportFailureTimerRef.current = window.setTimeout(() => {
      exportFailureTimerRef.current = null;
      setExportFailureKey(null);
    }, 2400);
  }, []);

  const clearFenError = useCallback(() => {
    if (fenErrorTimerRef.current !== null) {
      window.clearTimeout(fenErrorTimerRef.current);
      fenErrorTimerRef.current = null;
    }
    setFenError(null);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const toggleSettings = useCallback(() => {
    setShowMobileBoardActionMenu(false);
    setShowNewGameMenu(false);
    clearFenError();
    setMoveLineError(null);
    setShowSettings((open) => !open);
  }, [clearFenError]);

  const closeNewGameMenu = useCallback(() => {
    setShowNewGameMenu(false);
    setShowMobileBoardActionMenu(false);
    clearFenError();
    setMoveLineError(null);
  }, [clearFenError]);

  const openNewGameMenu = useCallback(() => {
    setShowMobileBoardActionMenu(false);
    setShowSettings(false);
    setPendingGameMode(gameMode);
    setFenInput('');
    setMoveLineInput('');
    setMoveLineFileName('');
    clearFenError();
    setMoveLineError(null);
    setShowNewGameMenu(true);
  }, [clearFenError, gameMode]);

  const toggleNewGameMenu = useCallback(() => {
    if (showNewGameMenu) {
      closeNewGameMenu();
      return;
    }
    openNewGameMenu();
  }, [closeNewGameMenu, openNewGameMenu, showNewGameMenu]);

  const startNewGameFromMenu = useCallback(() => {
    applyMode(pendingGameMode);
    closeNewGameMenu();
  }, [applyMode, closeNewGameMenu, pendingGameMode]);

  const buildCurrentPgn = useCallback(() => {
    if (hasMoveTreeMoves && (hasStudyBranches || currentMoveIndex < 0)) {
      return exportPgnTree(treeNodes, rootNodeId, {
        mainLineNodeIds: activeLineNodeIds,
        gameMode,
        opening: detectedOpening?.name,
        result: gameResult,
        startFen: rootFen,
      });
    }

    const moves = activeLineNodeIds
      .slice(0, currentMoveIndex + 1)
      .map(id => treeNodes[id]?.record)
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (moves.length === 0) return null;
    return exportPgn(moves, {
      gameMode,
      opening: detectedOpening?.name,
      result: gameResult,
      startFen: rootFen,
    });
  }, [activeLineNodeIds, currentMoveIndex, treeNodes, rootNodeId, gameMode, detectedOpening, gameResult, rootFen, hasMoveTreeMoves, hasStudyBranches]);

  const handleCopyPgn = useCallback(async () => {
    const pgn = buildCurrentPgn();
    if (!pgn) return;
    const ok = await copyToClipboard(pgn);
    if (!ok) {
      showExportFailure('copy-pgn');
      return;
    }
    clearExportFailure();
    if (copiedToastTimerRef.current !== null) {
      window.clearTimeout(copiedToastTimerRef.current);
    }
    setCopiedToast(true);
    copiedToastTimerRef.current = window.setTimeout(() => {
      copiedToastTimerRef.current = null;
      setCopiedToast(false);
    }, 2000);
  }, [buildCurrentPgn, clearExportFailure, showExportFailure]);

  const handleDownloadPgn = useCallback(() => {
    const pgn = buildCurrentPgn();
    if (!pgn) return;
    const ok = downloadTextFile(
      pgnDownloadFilename(detectedOpening?.name),
      pgn,
      'application/x-chess-pgn;charset=utf-8'
    );
    if (!ok) {
      showExportFailure('download-pgn');
      return;
    }

    clearExportFailure();
    if (downloadedPgnTimerRef.current !== null) {
      window.clearTimeout(downloadedPgnTimerRef.current);
    }
    setDownloadedPgnToast(true);
    downloadedPgnTimerRef.current = window.setTimeout(() => {
      downloadedPgnTimerRef.current = null;
      setDownloadedPgnToast(false);
    }, 2000);
  }, [buildCurrentPgn, clearExportFailure, detectedOpening, showExportFailure]);

  const handleCopyShareLink = useCallback(async () => {
    // Notes travel with the link for the same reason variations do: what is
    // being shared is a study, not a move list. They spend the same 8000
    // characters of tree budget, and a link that outgrows it already falls back
    // to the main line with "Variations omitted" said out loud.
    const moveTree = hasMoveTreeMoves && (hasStudyBranches || hasCommentedMoves || currentLineMoves.length === 0)
      ? serializeSavedMoveTree(treeNodes, rootNodeId)
      : undefined;
    const share = buildShareUrl(rootFen, currentLineMoves, gameMode, moveTree);
    if (!share || !canShareCurrentPosition) return;
    const ok = await copyToClipboard(share.url);
    if (!ok) {
      showExportFailure('copy-share');
      return;
    }

    clearExportFailure();
    setShareLinkNotice(share.treeOmitted
      ? {
          tone: 'warning',
          text: 'Variations omitted',
          detail: 'The link was copied. This study is larger than a link can hold, so only the line on screen went with it -- its variations, and any notes written on them, stayed behind.',
          positionKey: shareNoticePositionKey,
        }
      : null
    );
    if (copiedShareToastTimerRef.current !== null) {
      window.clearTimeout(copiedShareToastTimerRef.current);
    }
    setCopiedShareToast(true);
    copiedShareToastTimerRef.current = window.setTimeout(() => {
      copiedShareToastTimerRef.current = null;
      setCopiedShareToast(false);
    }, 2000);
  }, [canShareCurrentPosition, clearExportFailure, currentLineMoves, gameMode, hasCommentedMoves, hasMoveTreeMoves, hasStudyBranches, rootFen, rootNodeId, shareNoticePositionKey, showExportFailure, treeNodes]);

  const handlePickMoveLineFile = useCallback(() => {
    moveLineFileInputRef.current?.click();
  }, []);

  const handleMoveLineFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    if (file.size > MAX_MOVE_IMPORT_TEXT_LENGTH) {
      setMoveLineFileName('');
      setMoveLineInput('');
      setMoveLineError(`File is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.`);
      return;
    }

    try {
      const text = await file.text();
      if (isMoveImportTextTooLarge(text)) {
        setMoveLineInput('');
        setMoveLineFileName('');
        setMoveLineError(`File is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.`);
        return;
      }
      setMoveLineInput(text);
      setMoveLineFileName(file.name);
      setMoveLineError(null);
    } catch {
      setMoveLineFileName('');
      setMoveLineError('Could not read file');
    }
  }, []);

  const handleCopyFen = useCallback(async () => {
    const ok = await copyToClipboard(currentFen);
    if (!ok) {
      showExportFailure('copy-fen');
      return;
    }
    clearExportFailure();
    if (copiedFenToastTimerRef.current !== null) {
      window.clearTimeout(copiedFenToastTimerRef.current);
    }
    setCopiedFenToast(true);
    copiedFenToastTimerRef.current = window.setTimeout(() => {
      copiedFenToastTimerRef.current = null;
      setCopiedFenToast(false);
    }, 2000);
  }, [clearExportFailure, currentFen, showExportFailure]);

  /**
   * The line on the board as a numbered record in the reader's notation --
   * `1. 炮二平五 馬8進7` -- which is what gets pasted into a chat or a notebook.
   * A PGN is for another program; this is for another person.
   */
  const recordText = useMemo(
    () => formatRecordText(moveHistory.slice(0, currentMoveIndex + 1), rootFen, notationStyle),
    [currentMoveIndex, moveHistory, notationStyle, rootFen]
  );
  const canCopyRecord = recordText.length > 0;

  /**
   * The reader's note on the move they are standing on.
   *
   * Held as a draft rather than written on every keystroke: a comment lives in
   * the move tree, and the tree is what auto-save and the library serialize, so
   * a keystroke that reached it would re-render the app and rewrite storage
   * once per character. The draft is committed when the field loses focus, when
   * the reader steps to another move, and 600ms after they stop typing -- the
   * last one because a note is worth keeping even if the tab is closed with the
   * cursor still in the box.
   */
  const [moveCommentDraft, setMoveCommentDraft] = useState('');
  const moveCommentEditRef = useRef<{ nodeId: string; draft: string } | null>(null);
  const moveCommentTimerRef = useRef<number | null>(null);
  const treeNodesRef = useRef(treeNodes);
  // Synced in an effect rather than during render, and declared immediately
  // above the effect that reads it: effects run in declaration order, so a
  // commit that adds a move and steps onto it has the new tree in hand by the
  // time the note below is loaded from it.
  useEffect(() => {
    treeNodesRef.current = treeNodes;
  }, [treeNodes]);

  const commitMoveComment = useCallback(() => {
    if (moveCommentTimerRef.current !== null) {
      window.clearTimeout(moveCommentTimerRef.current);
      moveCommentTimerRef.current = null;
    }
    const pending = moveCommentEditRef.current;
    if (pending) setNodeComment(pending.nodeId, pending.draft);
  }, [setNodeComment]);

  const handleMoveCommentChange = useCallback((value: string) => {
    setMoveCommentDraft(value);
    if (moveCommentEditRef.current) moveCommentEditRef.current.draft = value;
    if (moveCommentTimerRef.current !== null) window.clearTimeout(moveCommentTimerRef.current);
    moveCommentTimerRef.current = window.setTimeout(() => {
      moveCommentTimerRef.current = null;
      const pending = moveCommentEditRef.current;
      if (pending) setNodeComment(pending.nodeId, pending.draft);
    }, 600);
  }, [setNodeComment]);

  // Stepping to another move writes the note being edited before loading the
  // next one, so a note is never lost by navigating away from it. The tree is
  // read through a ref because it changes on every move and this must not
  // re-run -- and re-reset the draft -- while someone is typing into it.
  useEffect(() => {
    const previous = moveCommentEditRef.current;
    if (previous && previous.nodeId !== currentNodeId) {
      if (moveCommentTimerRef.current !== null) {
        window.clearTimeout(moveCommentTimerRef.current);
        moveCommentTimerRef.current = null;
      }
      setNodeComment(previous.nodeId, previous.draft);
    }
    const editableNodeId = currentNodeId && currentNodeId !== rootNodeId ? currentNodeId : null;
    const stored = editableNodeId ? treeNodesRef.current[editableNodeId]?.record?.comment ?? '' : '';
    moveCommentEditRef.current = editableNodeId ? { nodeId: editableNodeId, draft: stored } : null;
    setMoveCommentDraft(stored);
  }, [currentNodeId, rootNodeId, setNodeComment]);

  useEffect(() => () => {
    if (moveCommentTimerRef.current !== null) window.clearTimeout(moveCommentTimerRef.current);
  }, []);

  const moveCommentTarget = currentNodeId && currentNodeId !== rootNodeId
    ? nodeLabel(currentNodeId, rootNodeId, treeNodes, notationStyle, rootFen)
    : null;
  const handleCopyRecord = useCallback(async () => {
    if (!recordText) return;
    const ok = await copyToClipboard(recordText);
    if (!ok) {
      showExportFailure('copy-record');
      return;
    }
    clearExportFailure();
    if (copiedRecordToastTimerRef.current !== null) {
      window.clearTimeout(copiedRecordToastTimerRef.current);
    }
    setCopiedRecordToast(true);
    copiedRecordToastTimerRef.current = window.setTimeout(() => {
      copiedRecordToastTimerRef.current = null;
      setCopiedRecordToast(false);
    }, 2000);
  }, [clearExportFailure, recordText, showExportFailure]);

  const handleCopyPvLine = useCallback(async (lineIndex: number, moves: string[]) => {
    const rawLine = moves.filter(Boolean).join(' ').trim();
    if (!rawLine) return;
    const ok = await copyToClipboard(rawLine);
    if (!ok) {
      showExportFailure(`copy-pv-${lineIndex}`);
      return;
    }

    clearExportFailure();
    if (copiedPvTimerRef.current !== null) {
      window.clearTimeout(copiedPvTimerRef.current);
    }
    setCopiedPvIndex(lineIndex);
    copiedPvTimerRef.current = window.setTimeout(() => {
      copiedPvTimerRef.current = null;
      setCopiedPvIndex(null);
    }, 1800);
  }, [clearExportFailure, showExportFailure]);

  /**
   * Stop on this position and go as deep as the machine can in a bounded wait.
   *
   * Live analysis is budgeted to keep up with someone stepping through a game.
   * This is the other thing a strong player wants and could not ask for. It
   * rides the same queue and the same tag as the live searches, so the position
   * changing cancels it exactly as it cancels any other search.
   */
  // `!threatActive` closes a race rather than expressing a preference. Starting
  // a deep dive while a threat is showing makes `canShowThreat` false, which
  // fires the guard effect, which calls `stopThreat`, which puts the analysis
  // stage back to `idle` -- and the analysis effect then queues an ordinary
  // primary search straight over the deep search that was just asked for. The
  // two are mutually exclusive in both directions instead: `canShowThreat`
  // carries `!deepDiveActive` for the same reason from the other side.
  const canDeepDive = isReady && engineEnabled && !isAiTurn
    && reviewStatus !== 'running' && !threatActive;

  /**
   * Give the opponent the move and let the engine answer: what is the threat?
   *
   * The question every player has and that the best move does not answer. A
   * beginner asks it as "why is this losing?" and a professional as "what am I
   * being asked to stop?", and the same output serves both.
   *
   * `passMoveFen` refuses when the side to move is in check, because a side
   * that is not to move may not be under attack -- and because a player in
   * check is not being threatened with something, they are being hit with it.
   * So `canShowThreat` is false there and the control says so rather than
   * failing on the press.
   *
   * The command is a bare `position fen`, not the root plus the game's moves,
   * because no move reaches this position. That costs the engine its repetition
   * history for this one search, which is the honest price of the question:
   * repetition in xiangqi decides games, and a passed position is not one the
   * game can arrive at.
   */
  const threatFen = useMemo(() => passMoveFen(currentFen), [currentFen]);
  // `isPageVisible` belongs here for the same reason it gates live analysis: a
  // backgrounded tab has its searches stopped and its queue cleared, so without
  // it the threat card sits on "Searching…" for a search that was cancelled
  // before it began. The guard effect below then takes the card away rather
  // than leaving it lying about what the engine is doing.
  const canShowThreat = isReady && engineEnabled && !isAiTurn && isPageVisible
    && reviewStatus !== 'running' && !deepDiveActive && Boolean(threatFen);

  const stopThreat = useCallback(() => {
    // Live analysis restarts only from `idle`, and the threat search left the
    // stage `settled` with the analysis PV lines cleared underneath it -- so
    // without this the eval bar and the candidate list would stay blank until
    // the reader navigated somewhere else.
    //
    // Written outside the state updater on purpose. React invokes an updater
    // twice in development, so a ref write inside one runs twice; this one is
    // idempotent and would have survived that, but the pattern does not
    // generalise and the guard it needed to be correct is not worth keeping.
    // Every caller already checks that a threat is showing, and the worst a
    // stray call could do is queue one redundant search.
    analysisStageRef.current = 'idle';
    setThreatActive(false);
  }, []);

  const runThreatSearch = useCallback(() => {
    if (!canShowThreat || !threatFen) return;
    analysisStageRef.current = 'settled';
    setThreatActive(true);
    queueSearch(
      `position fen ${threatFen}`,
      liveAnalysisPolicy.primary.goCmd,
      0,
      makeThreatTag(analysisRequestKey),
    );
  }, [analysisRequestKey, canShowThreat, liveAnalysisPolicy.primary.goCmd, queueSearch, threatFen]);

  // Navigating away answers a different question, so the threat goes with it.
  // `analysisRequestKey` changes on every position, mode and policy change,
  // which is exactly the set of things that invalidate the search behind it.
  useEffect(() => {
    setThreatActive(false);
  }, [analysisRequestKey]);

  // Anything that takes the analysis engine away -- the opponent's turn
  // starting, a review beginning, the engine going down -- takes the threat
  // with it. Without this the card stays on screen over a search that has been
  // stopped, and `stopThreat` is what lets live analysis start again after.
  useEffect(() => {
    if (threatActive && !canShowThreat) stopThreat();
  }, [canShowThreat, stopThreat, threatActive]);

  const runDeepDive = useCallback(() => {
    if (!isReady || !engineEnabled || isAiTurn || reviewControllerRef.current.active) return;
    analysisStageRef.current = 'deep-pending';
    setDeepDiveActive(true);
    queueSearch(
      currentPositionCommand,
      deepSearchMode === 'infinite' ? 'go infinite' : deepDiveBudget.goCmd,
      0,
      makeAnalysisTag('deep', analysisRequestKey),
    );
  }, [analysisRequestKey, currentPositionCommand, deepDiveBudget.goCmd, deepSearchMode, engineEnabled, isAiTurn, isReady, queueSearch, setDeepDiveActive]);
  const deepSearchLimitText = deepSearchMode === 'infinite'
    ? 'until stopped'
    : `for up to ${Math.round(deepDiveBudget.moveTimeMs / 1000)}s`;

  /**
   * Ask the engine what it would play for the human, in a game against it.
   *
   * Analysis is off while playing on purpose -- the point of a game is to find
   * the move yourself -- but a beginner who is stuck wants one nudge, not the
   * whole evaluation. The search rides the same queue as the opponent's own
   * moves and it is the human's turn, so the two cannot collide.
   */
  const canHint = aiPlayActive && !isAiTurn && !gameResult && isReady && !paused
    && !isSearching && !isSearchQueued && !hintPending;
  const runHint = useCallback(() => {
    if (!canHint) return;
    setHintMove(null);
    setHintPending(true);
    queueSearch(currentPositionCommand, HINT_GO_CMD, 0, makeHintTag(currentPositionCommand));
  }, [canHint, currentPositionCommand, queueSearch]);

  useEffect(() => {
    setHintMove(null);
    setHintPending(false);
  }, [currentNodeId, aiPlayActive]);

  const hintText = useMemo(() => {
    if (hintPending) return 'Thinking of a hint…';
    if (!hintMove) return null;
    return `Hint: ${formatLineInStyle(board, [hintMove], notationStyle, 1)}`;
  }, [board, hintMove, hintPending, notationStyle]);

  const handleClearEngineHash = useCallback(() => {
    if (clearedHashTimerRef.current !== null) {
      window.clearTimeout(clearedHashTimerRef.current);
      clearedHashTimerRef.current = null;
    }
    if (isSearching || isSearchQueued) {
      setEngineHashFeedback('queued');
      return;
    }
    setOption('Clear Hash');
    setEngineHashFeedback('cleared');
    clearedHashTimerRef.current = window.setTimeout(() => {
      clearedHashTimerRef.current = null;
      setEngineHashFeedback(null);
    }, 1800);
  }, [isSearchQueued, isSearching, setOption]);

  useEffect(() => {
    if (engineHashFeedback !== 'queued') return;
    if (!isReady) {
      setEngineHashFeedback(null);
      return;
    }
    if (isSearching || isSearchQueued) return;

    if (clearedHashTimerRef.current !== null) {
      window.clearTimeout(clearedHashTimerRef.current);
    }
    setOption('Clear Hash');
    setEngineHashFeedback('cleared');
    clearedHashTimerRef.current = window.setTimeout(() => {
      clearedHashTimerRef.current = null;
      setEngineHashFeedback(null);
    }, 1800);
  }, [engineHashFeedback, isReady, isSearchQueued, isSearching, setOption]);

  const handleRestartEngine = useCallback(() => {
    applyBestMoveRef.current = false;
    activeAnalysisRequestRef.current = '';
    analysisStageRef.current = 'idle';
    engineRecoveryTimestampsRef.current = [];
    lastEngineRecoveryAtRef.current = 0;
    clearAnalysisDeepenTimer();
    clearQueuedSearch();
    setEngineSafetyBootLevel(0);
    setEngineNotice({ tone: 'warning', text: 'Restarting engine' });
    restartEngine();
  }, [clearAnalysisDeepenTimer, clearQueuedSearch, restartEngine]);

  const handlePlayPvMove = useCallback((uci: string | undefined) => {
    if (!uci || gameResult) return;
    clearBoardMarkers();
    applyUciMove(uci);
    setAnalysisTab('tree');
    setMobileAnalysisTab('moves');
  }, [applyUciMove, clearBoardMarkers, gameResult]);

  const handlePlayBookMove = useCallback((uci: string) => {
    if (!uci || gameResult || isAiTurn) return;
    clearBoardMarkers();
    applyUciMove(uci);
    setAnalysisTab('tree');
    setMobileAnalysisTab('moves');
  }, [applyUciMove, clearBoardMarkers, gameResult, isAiTurn]);

  const handlePlayReviewBestMove = useCallback((nodeId: string, bestMove: string) => {
    const parentNodeId = treeNodes[nodeId]?.parentId;
    if (!parentNodeId || !bestMove || gameResult) return;
    clearBoardMarkers();
    const moved = applyUciMoveAtNode(parentNodeId, bestMove);
    if (moved) {
      setAnalysisTab('tree');
      setMobileAnalysisTab('moves');
    }
  }, [applyUciMoveAtNode, clearBoardMarkers, gameResult, treeNodes]);

  /** Start an engine game from immediately before a reviewed mistake. */
  const handlePracticeReviewMoment = useCallback((nodeId: string) => {
    const parentNodeId = treeNodes[nodeId]?.parentId;
    if (!parentNodeId) return;
    const practiceMoves = getNodeMoves(parentNodeId);
    const practiceSide = getNodeFen(parentNodeId).trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';

    stopAnalysis();
    handleCancelReview();
    resetReview();
    setGameResult(null);
    setAiMoveError(null);
    setPaused(false);
    setGameMode(practiceSide === 'w' ? 'PvAI-Black' : 'PvAI-Red');
    setOrientation(practiceSide === 'w' ? 'red' : 'black');
    setWorkspaceMode('play');
    loadMoves(practiceMoves, rootFen);
    setAnalysisTab('tree');
    setMobileAnalysisTab('moves');
    setGraphLoadSweepToken((token) => token + 1);
    setMobileView('board');
  }, [getNodeFen, getNodeMoves, handleCancelReview, loadMoves, resetReview, rootFen, setGameResult, stopAnalysis, treeNodes]);

  /**
   * Learn from your mistakes.
   *
   * The review says which move was a mistake and which the engine preferred,
   * and "Try best" plays the engine's move for you. Neither asks the reader
   * to find it, which is the part that teaches. This walks the key moments
   * in game order, puts the position before each mistake on the board with
   * the engine's arrows hidden, and grades whatever the reader plays on the
   * review's own scale -- the engine's move needs no search, anything else
   * waits for the live analysis of the position it reaches. Attempts stay in
   * the tree as variations, which is what a study of the game wants anyway.
   */
  const [drill, setDrill] = useState<MistakeDrillState | null>(null);
  const drillMoments = useMemo(
    () => (reviewStatus === 'done' && reviewSummary ? orderDrillMoments(reviewSummary.keyMoments) : []),
    [reviewStatus, reviewSummary]
  );
  const canStartDrill = engineEnabled && drillMoments.length > 0;
  const drillMoment = drill && !drill.finished ? drill.moments[drill.index] ?? null : null;
  const drillParentNodeId = drillMoment ? treeNodes[drillMoment.nodeId]?.parentId ?? null : null;
  const drillAsking = Boolean(drillMoment && !drill?.verdict);

  const askDrillMoment = useCallback((moment: ReviewKeyMoment) => {
    jumpToNode(treeNodes[moment.nodeId]?.parentId ?? rootNodeId);
  }, [jumpToNode, rootNodeId, treeNodes]);

  const startMistakeDrill = useCallback(() => {
    if (drillMoments.length === 0) return;
    setDrill({ moments: drillMoments, index: 0, attempt: null, verdict: null, found: 0, finished: false });
    askDrillMoment(drillMoments[0]);
    setMobileView('board');
  }, [askDrillMoment, drillMoments]);

  const stopMistakeDrill = useCallback(() => setDrill(null), []);

  const retryDrillMoment = useCallback(() => {
    if (!drill || !drillMoment) return;
    setDrill({ ...drill, attempt: null, verdict: null });
    askDrillMoment(drillMoment);
  }, [askDrillMoment, drill, drillMoment]);

  const nextDrillMoment = useCallback(() => {
    if (!drill) return;
    const found = drill.found + (isDrillSuccess(drill.verdict) ? 1 : 0);
    const index = drill.index + 1;
    if (index >= drill.moments.length) {
      setDrill({ ...drill, found, index, attempt: null, verdict: null, finished: true });
      return;
    }
    setDrill({ ...drill, found, index, attempt: null, verdict: null });
    askDrillMoment(drill.moments[index]);
  }, [askDrillMoment, drill]);

  const showDrillAnswer = useCallback(() => {
    if (!drill || !drillMoment?.bestMove || !drillParentNodeId) return;
    // The verdict is set before the move lands, so the effect below does not
    // read the engine's own move as the reader's attempt.
    setDrill({ ...drill, verdict: { kind: 'shown' } });
    clearBoardMarkers();
    applyUciMoveAtNode(drillParentNodeId, drillMoment.bestMove);
  }, [applyUciMoveAtNode, clearBoardMarkers, drill, drillMoment, drillParentNodeId]);

  // A move played from the asked position is the attempt. The engine's move
  // and the game's move are graded at once; anything else waits for the
  // evaluation, which arrives through drillJudgeRef.
  useEffect(() => {
    if (!drill || drill.finished || drill.verdict || drill.attempt || !drillMoment || !drillParentNodeId) return;
    if (currentNodeId === drillParentNodeId) return;
    const node = treeNodes[currentNodeId];
    if (!node?.record || node.parentId !== drillParentNodeId) return;
    const uci = node.record.uci;
    setDrill({ ...drill, attempt: { nodeId: currentNodeId, uci }, verdict: judgeDrillAttempt(drillMoment, uci, null) });
  }, [currentNodeId, drill, drillMoment, drillParentNodeId, treeNodes]);

  drillJudgeRef.current = (evalScore: number) => {
    if (!drill || drill.finished || drill.verdict || !drill.attempt || !drillMoment) return;
    if (currentNodeId !== drill.attempt.nodeId) return;
    const verdict = judgeDrillAttempt(drillMoment, drill.attempt.uci, evalScore);
    if (verdict) setDrill({ ...drill, verdict });
  };

  // The drill is a reading of the review; it goes when the review does.
  useEffect(() => {
    if (drill && reviewStatus !== 'done') setDrill(null);
  }, [drill, reviewStatus]);

  const drillCopy = useMemo(() => {
    if (!drill) return null;
    if (drill.finished) {
      return {
        headline: `Done: ${drill.found} of ${drill.moments.length} found.`,
        detail: 'Run it again from the review panel whenever you like.',
      };
    }
    if (!drillMoment) return null;
    const side = drillMoment.side === 'red' ? 'Red' : 'Black';
    const bestText = drillMoment.bestMove ? formatReviewMoveText(drillMoment.nodeId, drillMoment.bestMove) : '';
    const attemptText = drill.attempt ? formatReviewMoveText(drillMoment.nodeId, drill.attempt.uci) : '';
    const verdict = drill.verdict;
    if (!verdict) {
      return drill.attempt
        ? { headline: 'Checking with the engine…', detail: `${side} played ${attemptText}.` }
        : {
            headline: `${side} to move. Find a better move than the game's.`,
            detail: `Ply ${drillMoment.ply}, where the review found a ${formatReviewQuality(drillMoment.quality).toLowerCase()}.`,
          };
    }
    switch (verdict.kind) {
      case 'best':
        return { headline: `${attemptText} is the engine's move.`, detail: '' };
      case 'good':
        return {
          headline: `${attemptText} is good enough.`,
          detail: `Winning chance ${formatWinPercentLoss(verdict.winPercentLoss)}; the engine preferred ${bestText}.`,
        };
      case 'wrong':
        return {
          headline: `Not ${attemptText}.`,
          detail: `${formatReviewQuality(verdict.quality)} on the review's scale, winning chance ${formatWinPercentLoss(verdict.winPercentLoss)}. Try again, or see the answer.`,
        };
      case 'repeat':
        return { headline: `${attemptText} is the move from the game.`, detail: 'Look for something better.' };
      case 'shown':
        return { headline: `The engine's move was ${bestText}.`, detail: '' };
    }
  }, [drill, drillMoment, formatReviewMoveText]);
  const drillVerdictKind = drill
    ? drill.finished ? 'finished' : drill.verdict?.kind ?? (drill.attempt ? 'pending' : 'asking')
    : null;
  const drillIsLast = Boolean(drill && drill.index >= drill.moments.length - 1);

  const handleApplyEditedPosition = useCallback((fen: string) => {
    setShowBoardEditor(false);
    // The editor only offers Done for a legal position, so this succeeds;
    // the mode is the one picked in the New Game dialog, or the current one
    // when the editor was opened from the palette.
    handleLoadFenRef.current?.(fen, showNewGameMenu ? pendingGameMode : gameMode);
  }, [gameMode, pendingGameMode, showNewGameMenu]);

  const handleLoadFen = useCallback((fen: string, nextGameMode: GameMode = gameMode) => {
    const ok = loadFen(fen.trim());
    if (!ok) {
      if (fenErrorTimerRef.current !== null) {
        window.clearTimeout(fenErrorTimerRef.current);
      }
      setFenError('FEN must describe a legal Xiangqi position with both generals and a side to move.');
      fenErrorTimerRef.current = window.setTimeout(() => {
        fenErrorTimerRef.current = null;
        setFenError(null);
      }, 2000);
      return;
    }
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    if (isAiGameModeValue(nextGameMode)) {
      setWorkspaceMode('play');
    }
    setGameMode(nextGameMode);
    const facing = orientationForHuman(nextGameMode);
    if (facing) setOrientation(facing);
    setFenInput('');
    clearFenError();
    closeNewGameMenu();
  }, [clearFenError, closeNewGameMenu, gameMode, handleCancelReview, loadFen, resetReview, stopAnalysis]);

  const handleLoadFenRef = useRef<typeof handleLoadFen | null>(null);
  handleLoadFenRef.current = handleLoadFen;

  const handleImportMoveLine = useCallback((text: string, nextGameMode: GameMode = pendingGameMode) => {
    showImportNotice(null);
    if (isMoveImportTextTooLarge(text)) {
      setMoveLineError(`Move line is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.`);
      return;
    }

    const importedLine = extractUciMoveTree(text);
    const startFen = fenInput.trim() || extractFenTag(text) || undefined;
    let moves = importedLine.moves;
    /**
     * A record written in WXF or Chinese carries no coordinates at all, so the
     * UCI extractor finds nothing in it. Fall back to reading the notation --
     * only when there were no coordinates, so a PGN that happens to contain a
     * Chinese comment is still read as a PGN.
     *
     * Variations are not followed on this path: the parenthetical form is a
     * PGN convention and a notation record does not use it, so this imports the
     * line and says so rather than guessing at a tree.
     */
    let importedFromNotation = false;
    /**
     * Tokens the notation reader understood as moves and could not place.
     *
     * Kept because the reader skips them and carries on, so a record it can
     * only half-follow imports as the part it managed -- which looks exactly
     * like a complete import. Saying so is the same call the first-game notice
     * makes below.
     */
    let notationRejected: string[] = [];
    if (moves.length === 0) {
      const parsed = parseNotationRecord(startFen, stripRecordMetadata(text), MAX_MOVE_IMPORT_UCI_MOVES);
      notationRejected = parsed.rejected;
      if (parsed.moves.length > 0) {
        moves = parsed.moves;
        importedFromNotation = true;
      }
    }

    if (importedLine.tooLarge || moves.length > MAX_MOVE_IMPORT_UCI_MOVES) {
      setMoveLineError(`Move line is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.`);
      return;
    }
    if (moves.length === 0) {
      // Telling someone the format is wrong when it was read fine and the
      // *position* is wrong sends them to fix the thing that already works.
      // A record for a handicap or a set-up game reaches here every time.
      setMoveLineError(
        notationRejected.length > 0
          ? `Read ${notationRejected[0]} as a move, but it names no legal move in the starting position. If this record does not start from the opening, paste its FEN first.`
          : 'No moves found. Paste coordinates (b2e2 h9g7), WXF (C2=5 H8+7) or Chinese (炮二平五 马8进7).'
      );
      return;
    }

    const validation = validateMoveSequence(moves, startFen);
    if (!validation.ok) {
      setMoveLineError(
        validation.move
          ? `Move ${validation.failedIndex + 1} ${validation.move}: ${validation.reason}`
          : validation.reason
      );
      return;
    }
    const hasVariations = importedLine.hasVariations && !importedFromNotation;
    if (hasVariations) {
      const treeValidation = validateMoveTree(importedLine.moveTree, startFen);
      if (!treeValidation.ok) {
        setMoveLineError(
          treeValidation.move
            ? `Variation ${treeValidation.move}: ${treeValidation.reason}`
            : treeValidation.reason
        );
        return;
      }
    }

    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    if (isAiGameModeValue(nextGameMode)) {
      setWorkspaceMode('play');
    }
    setGameMode(nextGameMode);
    const facing = orientationForHuman(nextGameMode);
    if (facing) setOrientation(facing);
    const loadedNodeIds = hasVariations
      ? loadMoveTree(importedLine.moveTree, moves, startFen)
      : loadMoves(moves, startFen);
    if (notationRejected.length > 0) {
      // More pressing than the first-game notice: that one says the rest of a
      // file was left, this one says part of *this* game was.
      showImportNotice(
        `Stopped at ${notationRejected[0]}`,
        `Imported ${moves.length} ${moves.length === 1 ? 'move' : 'moves'}. The record then reads ${notationRejected[0]}, which names no legal move in the position it had reached, so the rest was not imported.`
      );
    } else if (importedLine.hadMoreGames) {
      showImportNotice(
        'Imported first game',
        'Imported the first game only. The paste held more than one game.'
      );
    }

    /**
     * The review the record was carrying, if it was carrying one.
     *
     * The exporter writes NAGs and `[%eval ...]` into the PGN, and until now
     * the importer stripped them -- so a game exported from here and pasted
     * back lost every evaluation, and a PGN annotated anywhere else arrived as
     * bare moves. Read on a separate pass, which returns the moves as well as
     * the annotations so the two can be checked against the line that was
     * actually loaded rather than trusted to have walked it the same way.
     *
     * A notation record has no coordinates and takes the other import path, so
     * there is nothing to align to; skipped there.
     */
    if (!importedFromNotation) {
      const annotated = extractAnnotatedMainLine(text);
      const alignsWithLine = annotated.moves.length === moves.length
        && annotated.moves.every((uci, index) => uci === moves[index]);
      if (alignsWithLine) {
        const updates = annotated.annotations
          .map((annotation, index) => {
            const nodeId = loadedNodeIds[index];
            if (!nodeId) return null;
            if (annotation.evalScore === undefined && annotation.quality === undefined) return null;
            return { nodeId, evalScore: annotation.evalScore, quality: annotation.quality };
          })
          .filter((update): update is NonNullable<typeof update> => Boolean(update));
        if (updates.length > 0) setNodeReviewDataBulk(updates);

        // The prose in the same comments. Kept apart from the review data
        // because it is the reader's and a re-run of the review must not
        // overwrite it.
        const comments = annotated.annotations
          .map((annotation, index) => {
            const nodeId = loadedNodeIds[index];
            if (!nodeId || !annotation.comment) return null;
            return { nodeId, comment: annotation.comment };
          })
          .filter((update): update is { nodeId: string; comment: string } => Boolean(update));
        if (comments.length > 0) setNodeComments(comments);
      }
    }

    setFenInput('');
    clearFenError();
    setMoveLineInput('');
    setMoveLineFileName('');
    setMoveLineError(null);
    setGraphLoadSweepToken((token) => token + 1);
    closeNewGameMenu();
  }, [clearFenError, closeNewGameMenu, fenInput, handleCancelReview, loadMoveTree, loadMoves, pendingGameMode, resetReview, setNodeComments, setNodeReviewDataBulk, showImportNotice, stopAnalysis, validateMoveSequence, validateMoveTree]);

  useEffect(() => {
    if (shareLinkLoadedRef.current || typeof window === 'undefined') return;
    shareLinkLoadedRef.current = true;

    /**
     * The recipient did not write this link and cannot see the sender's
     * console, which is where the reason used to go. The import box has said
     * which move stopped it since it was written; a share link said "Shared
     * link not loaded" for five different failures and nothing else.
     */
    const failShareLink = (failure: ShareLinkFailure) => {
      setShareLinkNotice({
        tone: 'warning',
        text: shareLinkHeadline(failure),
        detail: describeShareLinkFailure(failure),
      });
    };

    const params = new URLSearchParams(window.location.search);
    const rawFen = params.get('fen')?.trim() || undefined;
    const rawMoves = params.get('moves') || '';
    const rawTree = params.get('tree');
    const sharedMoveTree = decodeSavedMoveTreeParam(rawTree);
    const rawMode = params.get('mode');
    if (isMoveImportTextTooLarge(rawMoves)) {
      failShareLink({ kind: 'too-long' });
      logDiagnosticWarning('Ignored oversized shared Xiangqi line.');
      return;
    }
    const moves = extractUciMoveLine(rawMoves);
    const mode = isGameMode(rawMode) ? rawMode : 'PvP';
    // Asked of the source text, not of the extracted line: extraction stops at
    // the cap so the line it returns can always be saved, which means its own
    // length can no longer tell us the link was too long.
    if (hasTooManyUciMoves(rawMoves)) {
      failShareLink({ kind: 'too-many-moves' });
      logDiagnosticWarning('Ignored oversized shared Xiangqi line.');
      return;
    }
    // extractUciMoveLine is lenient because the import box takes pasted PGN,
    // where numbering and annotations must be skipped. A share link's moves are
    // machine-written bare UCI, so a token that is not a move means the link was
    // damaged in transit -- and silently dropping it handed the recipient a
    // shorter game than was sent, with nothing said.
    const sharedMoveTokens = rawMoves.trim().split(/\s+/).filter(Boolean);
    const unreadableToken = sharedMoveTokens.find((token) => !/^[a-i][0-9][a-i][0-9]$/i.test(token));
    if (unreadableToken !== undefined) {
      failShareLink({ kind: 'unreadable-move', token: unreadableToken.slice(0, 12) });
      logDiagnosticWarning('Ignored shared Xiangqi link with unreadable moves:', rawMoves.slice(0, 80));
      return;
    }
    if (!rawFen && moves.length === 0 && !sharedMoveTree?.length) {
      // Every move token read as a move above, so an empty line here means the
      // `tree` parameter was the only content and it did not decode.
      if (rawTree || rawMoves.trim()) {
        failShareLink({ kind: 'variations-only' });
      }
      return;
    }

    const validation = validateMoveSequence(moves, rawFen);
    if (!validation.ok) {
      failShareLink(validation.reason === 'Invalid start FEN'
        ? { kind: 'bad-start-position' }
        : { kind: 'illegal-move', moveNumber: (validation.failedIndex ?? 0) + 1, reason: validation.reason });
      logDiagnosticWarning('Ignored invalid shared Xiangqi link:', validation);
      return;
    }

    const treeValidation = sharedMoveTree?.length ? validateMoveTree(sharedMoveTree, rawFen) : null;
    const sharedTreeContainsLine = sharedMoveTree?.length ? moveTreeContainsLine(sharedMoveTree, moves) : false;
    const canLoadSharedTree = sharedMoveTree?.length ? treeValidation?.ok === true && sharedTreeContainsLine : false;
    if (sharedMoveTree?.length && treeValidation && !treeValidation.ok && moves.length === 0 && !rawFen) {
      failShareLink({ kind: 'variations-only' });
      logDiagnosticWarning('Ignored invalid shared Xiangqi variation tree:', treeValidation);
      return;
    }

    if (rawTree && !canLoadSharedTree) {
      failShareLink({ kind: 'variations' });
    } else {
      setShareLinkNotice(null);
    }
    if (sharedMoveTree?.length && treeValidation && !treeValidation.ok) {
      logDiagnosticWarning('Ignored invalid shared Xiangqi variation tree:', treeValidation);
    } else if (sharedMoveTree?.length && treeValidation?.ok && !sharedTreeContainsLine) {
      logDiagnosticWarning('Ignored shared Xiangqi variation tree whose main line is missing:', moves.join(' '));
    }
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    setGameMode(mode);
    if (sharedMoveTree?.length && canLoadSharedTree) {
      loadMoveTree(sharedMoveTree, moves, rawFen);
    } else if (moves.length > 0) {
      loadMoves(moves, rawFen);
    } else if (rawFen) {
      loadFen(rawFen);
    }
    setWorkspaceMode('analysis');
    setAnalysisTab('tree');
    setMobileAnalysisTab('moves');
    setMobileView('board');
    setGraphLoadSweepToken((token) => token + 1);
  }, [handleCancelReview, loadFen, loadMoves, loadMoveTree, resetReview, stopAnalysis, validateMoveSequence, validateMoveTree]);

  const savedReviewSnapshot = useMemo(() => {
    if (reviewStatus !== 'done' || !reviewSummary) return undefined;
    return {
      summary: reviewSummary,
      annotations: reviewedHistory.map((record, moveIndex) => ({
        moveIndex,
        evalScore: record.evalScore,
        bestMove: record.bestMove,
        bestLine: record.bestLine,
        quality: record.quality,
        swing: record.swing,
        winPercentLoss: record.winPercentLoss,
        reviewNote: record.reviewNote,
      })),
    };
  }, [reviewedHistory, reviewStatus, reviewSummary]);

  /**
   * The game as it stands, in the shape both the library and the auto-save
   * store. Built in one place so a recovered game matches a saved one.
   */
  /**
   * The live evaluation, read at the moment a snapshot is written rather than
   * memoised into it. It used to be a dependency of the snapshot below, which
   * meant every buffered info flush -- five a second while the engine searches
   * -- rebuilt the snapshot, re-serialized the move tree of a study, and reset
   * the auto-save debounce. Under an infinite search the write never landed at
   * all. The value the stored game wants is the one that has settled, and a
   * finished search changes the tree (`setCurrentNodeEval`), which is what
   * rewrites the snapshot anyway.
   */
  const displayEvalScoreRef = useRef(displayEvalScore);
  displayEvalScoreRef.current = displayEvalScore;
  const currentGameSnapshot = useMemo(() => {
    // The whole line when it is the reviewed one, so the annotations line up
    // with it; otherwise the line as far as the cursor, and no review -- a
    // review of one line saved beside the moves of another would be read
    // back onto the wrong moves.
    const saveNodeIds = reviewMatchesActiveLine
      ? activeLineNodeIds
      : activeLineNodeIds.slice(0, currentMoveIndex + 1);
    const moves = saveNodeIds
      .map(id => treeNodes[id]?.record?.uci)
      .filter((uci): uci is string => Boolean(uci));
    // `moves` stops where the cursor is standing, so that restoring puts the
    // reader back on the move they were looking at. Anything past the cursor
    // exists only in the tree, and a straight line has no branches and may
    // have no notes -- so without this last clause a game stepped back through
    // and then closed came back cut off at the cursor, with the rest silently
    // dropped. The `=== 0` case is the same bug at the root, where it was
    // noticed first.
    const holdsMoreThanTheSavedLine = moves.length === 0 || moves.length < activeLineNodeIds.length;
    const moveTree = hasMoveTreeMoves && (hasStudyBranches || hasCommentedMoves || holdsMoreThanTheSavedLine)
      ? serializeSavedMoveTree(treeNodes, rootNodeId)
      : undefined;
    return {
      gameMode,
      moves,
      opening: detectedOpening?.name,
      startFen: rootFen !== START_POSITION_FEN ? rootFen : undefined,
      result: (gameResult === 'red-wins' ? 'red' : gameResult === 'black-wins' ? 'black' : gameResult === 'draw' ? 'draw' : 'ongoing') as SavedGame['result'],
      moveTree,
      review: reviewMatchesActiveLine && reviewSummary
        ? {
            ...savedReviewSnapshot!,
            summary: {
              ...reviewSummary,
              lineSignature: makeReviewLineSignatureFromMoves(moves),
            },
          }
        : undefined,
    };
  }, [activeLineNodeIds, currentMoveIndex, detectedOpening, gameMode, gameResult, hasCommentedMoves, hasMoveTreeMoves, hasStudyBranches, reviewMatchesActiveLine, reviewSummary, rootFen, rootNodeId, savedReviewSnapshot, treeNodes]);

  /** The snapshot as it is written: the shape above plus the evaluation of the moment. */
  const snapshotForStorage = useCallback((snapshot: typeof currentGameSnapshot) => ({
    ...snapshot,
    finalEval: displayEvalScoreRef.current ?? undefined,
  }), []);

  const handleSaveGame = useCallback(() => {
    const { gameMode: mode, moves, ...rest } = snapshotForStorage(currentGameSnapshot);
    const saved = saveGameToLibrary(mode, moves, rest);

    if (savedToastTimerRef.current !== null) {
      window.clearTimeout(savedToastTimerRef.current);
    }
    setSavedToast(Boolean(saved));
    setSaveFailedToast(!saved);
    // A failure outlasts a success on purpose. "Saved" is a confirmation of
    // something the reader already expected and can be brief; "Save Failed"
    // says the game they just tried to keep is not anywhere, and it is the only
    // place that is said. At the shared 1800ms it was gone before someone who
    // clicked and glanced away could see it, leaving them believing the save
    // had worked -- measured with local storage filled to its quota, where the
    // write really does fail and the library really does stay empty.
    savedToastTimerRef.current = window.setTimeout(() => {
      savedToastTimerRef.current = null;
      setSavedToast(false);
      setSaveFailedToast(false);
    }, saved ? 1800 : 8000);
  }, [currentGameSnapshot, saveGameToLibrary, snapshotForStorage]);


  /**
   * Cutting the tree is the one edit a study needs that the board cannot
   * express. A running review is over the line as it stands, so it is cancelled
   * first; a finished one goes when a move it describes does, by the effect
   * that watches the reviewed line.
   */
  /**
   * A deletion can be taken back for a few seconds. The cross on a variation
   * row and the palette command both remove a move and everything after it,
   * which on the main line can be a whole game, with no confirmation -- a
   * confirmation would slow down the pruning the cross exists for. An undo
   * costs nothing until it is needed.
   */
  const [deleteUndo, setDeleteUndo] = useState<{ snapshot: MoveTreeSnapshot; removed: number } | null>(null);
  const deleteUndoTimerRef = useRef<number | null>(null);
  const dismissDeleteUndo = useCallback(() => {
    if (deleteUndoTimerRef.current !== null) {
      window.clearTimeout(deleteUndoTimerRef.current);
      deleteUndoTimerRef.current = null;
    }
    setDeleteUndo(null);
  }, []);
  useEffect(() => () => {
    if (deleteUndoTimerRef.current !== null) window.clearTimeout(deleteUndoTimerRef.current);
  }, []);
  // A snapshot from a different root cannot be restored, so do not offer it.
  useEffect(() => { dismissDeleteUndo(); }, [dismissDeleteUndo, rootFen]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    if (nodeId === rootNodeId) return;
    if (reviewStatus === 'running') handleCancelReview();
    clearBoardMarkers();
    const snapshot = captureTreeSnapshot();
    let removed = 0;
    const stack = [nodeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      removed += 1;
      stack.push(...(treeNodes[id]?.childrenIds ?? []));
    }
    if (!deleteNode(nodeId)) return;
    if (deleteUndoTimerRef.current !== null) window.clearTimeout(deleteUndoTimerRef.current);
    setDeleteUndo({ snapshot, removed });
    deleteUndoTimerRef.current = window.setTimeout(() => {
      deleteUndoTimerRef.current = null;
      setDeleteUndo(null);
    }, 10000);
  }, [captureTreeSnapshot, clearBoardMarkers, deleteNode, handleCancelReview, reviewStatus, rootNodeId, treeNodes]);

  const handleUndoDelete = useCallback(() => {
    if (!deleteUndo) return;
    if (reviewStatus === 'running') handleCancelReview();
    clearBoardMarkers();
    restoreTreeSnapshot(deleteUndo.snapshot);
    dismissDeleteUndo();
  }, [clearBoardMarkers, deleteUndo, dismissDeleteUndo, handleCancelReview, restoreTreeSnapshot, reviewStatus]);
  const canDeleteCurrentMove = currentNodeId !== rootNodeId && !isAiTurn;

  const paletteCommands = useMemo<Command[]>(() => [
    { id: 'new-game', label: 'New game', keywords: ['restart', 'reset'], run: () => { setGameResult(null); resetGame(); } },
    { id: 'library', label: 'Library', hint: 'Saved games', keywords: ['open', 'load'], run: openLibraryPanel },
    {
      id: 'save-game',
      label: 'Save game',
      hint: canSaveCurrentPosition ? undefined : 'Play a move or set up a position first',
      keywords: ['store', 'keep'],
      disabled: !canSaveCurrentPosition,
      run: handleSaveGame,
    },
    {
      id: 'review-game',
      label: 'Review game',
      hint: canStartReview ? undefined : reviewStartTitle,
      keywords: ['accuracy', 'blunders', 'report'],
      disabled: !canStartReview,
      run: startGameReview,
    },
    {
      id: 'copy-pgn',
      label: 'Copy PGN',
      hint: canExportCurrentLine ? undefined : 'Play or import a line first',
      keywords: ['clipboard', 'export'],
      disabled: !canExportCurrentLine,
      run: () => { void handleCopyPgn(); },
    },
    {
      id: 'download-pgn',
      label: 'Export PGN',
      hint: canExportCurrentLine ? undefined : 'Play or import a line first',
      keywords: ['download', 'file', 'save'],
      disabled: !canExportCurrentLine,
      run: handleDownloadPgn,
    },
    {
      id: 'setup-position',
      label: 'Set up a position',
      hint: 'Place the pieces by hand',
      keywords: ['editor', 'board', 'compose', 'endgame', 'fen', 'edit'],
      run: () => { setShowSettings(false); setShowBoardEditor(true); },
    },
    {
      id: 'write-note',
      label: 'Write a note on this move',
      hint: moveCommentTarget
        ? `Your own note on ${moveCommentTarget}, kept apart from the review's`
        : 'Step to a move first',
      keywords: ['comment', 'annotate', 'study', 'remark', '注释'],
      disabled: !moveCommentTarget,
      run: () => {
        setAnalysisTab('tree');
        setMobileAnalysisTab('moves');
        setMobileView('analysis');
        // After the panel is up, or the field is not in the document yet.
        window.setTimeout(() => {
          document.getElementById('move-comment-input')?.focus();
        }, 0);
      },
    },
    {
      id: 'copy-record',
      label: `Copy record in ${NOTATION_STYLE_LABELS[notationStyle]}`,
      hint: canCopyRecord ? 'Numbered moves, one pair per line' : 'Play or import a line first',
      keywords: ['notation', 'chinese', 'wxf', 'text', 'clipboard', '棋谱', 'export'],
      disabled: !canCopyRecord,
      run: () => { void handleCopyRecord(); },
    },
    {
      id: 'copy-link',
      label: 'Copy link',
      hint: canShareCurrentPosition ? undefined : 'Play a move or set up a position first',
      keywords: ['share', 'url'],
      disabled: !canShareCurrentPosition,
      run: () => { void handleCopyShareLink(); },
    },
    {
      // The palette is where a keyboard-first player reaches for anything, and
      // these five lived only as buttons -- two of them in the engine panel,
      // which has to be open before they can be clicked at all.
      id: 'deep-dive',
      label: deepDiveActive ? 'Stop deep search' : 'Go deep on this position',
      hint: deepDiveActive
        ? undefined
        : canDeepDive ? (deepSearchMode === 'infinite' ? 'Until stopped' : `Up to ${Math.round(deepDiveBudget.moveTimeMs / 1000)}s`) : 'Analysis engine only',
      keywords: ['deep', 'search', 'think', 'analyse', 'analyze', 'depth', 'infinite'],
      shortcut: 'D',
      disabled: !deepDiveActive && !canDeepDive,
      run: () => { if (deepDiveActive) stopSearch(); else runDeepDive(); },
    },
    {
      id: 'show-threat',
      label: threatActive ? 'Stop showing the threat' : 'Show the threat',
      hint: threatActive
        ? 'Back to analysing the position as it stands'
        : canShowThreat
          ? `Let ${sideToMove === 'w' ? 'Black' : 'Red'} move first`
          : threatFen ? 'Analysis engine only' : `${sideToMoveLabel} is in check`,
      keywords: ['threat', 'null', 'pass', 'opponent', 'danger', 'attack', 'idea'],
      shortcut: 'X',
      disabled: !threatActive && !canShowThreat,
      run: () => { if (threatActive) stopThreat(); else runThreatSearch(); },
    },
    {
      id: 'hint',
      label: 'Hint',
      hint: aiPlayActive
        ? (canHint ? 'What the engine would play for you' : isAiTurn ? 'Wait for your turn' : 'Not right now')
        : 'Only while playing against the engine',
      keywords: ['help', 'suggest', 'stuck', 'best move', 'coach'],
      shortcut: 'H',
      disabled: !canHint,
      run: runHint,
    },
    {
      id: 'learn-from-mistakes',
      label: 'Learn from your mistakes',
      hint: canStartDrill
        ? `${drillMoments.length} ${drillMoments.length === 1 ? 'moment' : 'moments'} to find a better move for`
        : reviewStatus === 'done' ? 'The review found nothing to learn from' : 'Run a review first',
      keywords: ['drill', 'quiz', 'practice', 'blunder', 'train', 'puzzle', 'find'],
      disabled: !canStartDrill,
      run: () => { setAnalysisTab('review'); startMistakeDrill(); },
    },
    {
      id: 'play-from-here',
      label: 'Play from this position',
      hint: canPlayFromHere ? 'You take the side to move' : 'Play a move or set up a position first',
      keywords: ['practice', 'try', 'again', 'continue', 'engine', 'opponent', 'retry'],
      disabled: !canPlayFromHere,
      run: playFromHere,
    },
    {
      id: 'cloud-book',
      label: cloudBookEnabled ? 'Turn the cloud book off' : 'Turn the cloud book on',
      hint: cloudBookEnabled ? undefined : `Looks each position up on ${CLOUD_BOOK_SITE_NAME}`,
      keywords: ['chessdb', 'opening', 'database', 'online', 'book', '云库'],
      run: () => setCloudBookEnabled((enabled) => !enabled),
    },
    { id: 'flip-board', label: 'Flip board', keywords: ['orientation', 'turn', 'rotate', 'side'], shortcut: 'F', run: () => setOrientation((side) => side === 'red' ? 'black' : 'red') },
    {
      id: 'copy-fen',
      label: 'Copy FEN',
      keywords: ['position', 'clipboard', 'export'],
      run: () => { void handleCopyFen(); },
    },
    {
      id: 'restart-engine',
      label: 'Restart engine',
      hint: engineRequired ? undefined : 'Analysis engine only',
      keywords: ['pikafish', 'reload', 'reboot', 'stuck'],
      disabled: !engineRequired,
      run: handleRestartEngine,
    },
    {
      id: 'clear-hash',
      label: 'Clear engine hash',
      hint: isReady ? undefined : 'Engine is not ready',
      keywords: ['transposition', 'table', 'cache', 'reset'],
      disabled: !isReady,
      run: handleClearEngineHash,
    },
    {
      id: 'delete-from-here',
      label: 'Delete this move and what follows',
      hint: canDeleteCurrentMove ? 'Every branch under it goes too' : 'Nothing to delete at the start position',
      keywords: ['remove', 'cut', 'prune', 'variation', 'truncate', 'undo'],
      disabled: !canDeleteCurrentMove,
      run: () => handleDeleteNode(currentNodeId),
    },
    {
      id: 'tab-tree', label: 'Move tree', keywords: ['moves', 'variations'], shortcut: 'T',
      run: () => { setAnalysisTab('tree'); setMobileAnalysisTab('moves'); setMobileView('analysis'); },
    },
    {
      id: 'tab-review', label: 'Review panel', keywords: ['accuracy'], shortcut: 'R',
      run: () => { setAnalysisTab('review'); setMobileAnalysisTab('review'); setMobileView('analysis'); },
    },
    {
      id: 'tab-engine', label: 'Engine panel', hint: engineEnabled ? undefined : 'Available in Analysis',
      keywords: ['pikafish', 'depth', 'pv'], shortcut: 'E', disabled: !engineEnabled,
      run: () => { setAnalysisTab('engine'); setMobileAnalysisTab('engine'); setMobileView('analysis'); },
    },
    { id: 'panel-graph', label: 'Evaluation graph', keywords: ['chart', 'swing'], run: () => setLeftPanelTab('graph') },
    { id: 'go-first', label: 'Go to start', keywords: ['first', 'beginning'], shortcut: '↑', run: goToFirstMove },
    { id: 'go-last', label: 'Go to latest move', keywords: ['end', 'last'], shortcut: '↓', run: goToLatestMove },
    { id: 'settings', label: 'Settings', keywords: ['preferences', 'engine', 'options'], run: () => setShowSettings(true) },
  ], [aiPlayActive, canCopyRecord, canDeepDive, canStartDrill, drillMoments.length, moveCommentTarget, canDeleteCurrentMove, canExportCurrentLine, canHint, canPlayFromHere, canShowThreat, canStartReview, cloudBookEnabled, currentNodeId, handleCopyRecord, handleDeleteNode, isAiTurn, notationStyle, playFromHere, reviewStartTitle, reviewStatus, runHint, startMistakeDrill, canSaveCurrentPosition, canShareCurrentPosition, deepDiveActive, deepSearchMode,
      runThreatSearch, sideToMove, sideToMoveLabel, stopThreat, threatActive, threatFen,
      deepDiveBudget.moveTimeMs, engineEnabled, engineRequired, goToFirstMove, goToLatestMove, handleClearEngineHash,
      handleCopyFen, handleCopyPgn, handleCopyShareLink, handleDownloadPgn, handleRestartEngine,
      handleSaveGame, isReady, openLibraryPanel, resetGame, runDeepDive, setGameResult, startGameReview,
      stopSearch])
  const handleLoadGame = useCallback((game: SavedGame) => {
    const lineValidation = validateMoveSequence(game.moves, game.startFen);
    if (!lineValidation.ok) {
      logDiagnosticWarning('Ignored invalid saved Xiangqi game:', lineValidation);
      return false;
    }

    if (game.moveTree?.length) {
      const treeValidation = validateMoveTree(game.moveTree, game.startFen);
      if (!treeValidation.ok) {
        logDiagnosticWarning('Ignored saved Xiangqi game with invalid variation tree:', treeValidation);
        return false;
      }
      if (!moveTreeContainsLine(game.moveTree, game.moves)) {
        logDiagnosticWarning('Ignored saved Xiangqi game whose main line is missing from its variation tree:', game.id);
        return false;
      }
    }

    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    setGameMode(game.gameMode);
    setWorkspaceMode('analysis');
    setLeftPanelTab('graph');
    const loadedNodeIds = game.moveTree?.length
      ? loadMoveTree(game.moveTree, game.moves, game.startFen)
      : loadMoves(game.moves, game.startFen);
    setGameResult(savedResultToGameResult(game.result));
    if (game.review) {
      setNodeReviewDataBulk(
        game.review.annotations
          .map((annotation) => {
            const nodeId = loadedNodeIds[annotation.moveIndex];
            if (!nodeId) return null;
            return {
              nodeId,
              evalScore: annotation.evalScore,
              bestMove: annotation.bestMove,
              bestLine: annotation.bestLine,
              quality: annotation.quality,
              swing: annotation.swing,
              winPercentLoss: annotation.winPercentLoss,
              reviewNote: annotation.reviewNote,
            };
          })
          .filter((annotation): annotation is NonNullable<typeof annotation> => Boolean(annotation))
      );
      // Rebuilt from the annotations rather than trusted as stored. A summary
      // saved before a scoring change would otherwise sort and average in the
      // library beside summaries computed on the current scale.
      hydrateReview(remapReviewSummaryToLine({
        ...rebuildSummaryFromAnnotations(game.review.annotations, game.review.summary, reviewSideFromStartFen(game.startFen)),
        lineSignature: makeReviewLineSignatureFromMoves(game.moves),
      }, loadedNodeIds));
      setReviewedLineNodeIds(loadedNodeIds.slice(0, game.moves.length));
      setAnalysisTab('review');
      setMobileAnalysisTab('review');
    } else {
      setAnalysisTab('tree');
      setMobileAnalysisTab('moves');
    }
    setMobileView('analysis');
    setGraphLoadSweepToken((token) => token + 1);
    return true;
  }, [handleCancelReview, hydrateReview, loadMoves, loadMoveTree, resetReview, setGameResult, setNodeReviewDataBulk, stopAnalysis, validateMoveSequence, validateMoveTree]);

  // ── Auto-save ────────────────────────────────────────
  // Offer whatever was in progress when the tab last closed, then keep the
  // slot current. The check runs once, before the first write, so a fresh
  // board cannot clear the snapshot it is about to offer.
  const autoSaveCheckedRef = useRef(false);
  // Read once, from the address the tab was opened with, so the recovery modal
  // can tell a cold start from a followed link. Only the shape matters here --
  // the link's own loader above does the validating.
  // The board carries a single roving tab stop, so the square to focus is
  // whichever one currently holds it -- the last square the player used, not a
  // fixed corner.
  const focusBoard = useCallback(() => {
    if (typeof document === 'undefined') return;
    const target = document.querySelector<HTMLElement>('.xiangqi-board [tabindex="0"]')
      ?? document.querySelector<HTMLElement>('.xiangqi-board [data-file][data-rank]');
    target?.focus();
  }, []);

  const incomingLink = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const rawMoves = params.get('moves') ?? '';
    const hasLink = Boolean(rawMoves.trim() || params.get('tree') || params.get('fen'));
    if (!hasLink) return null;
    return { moveCount: extractUciMoveLine(rawMoves).length };
  }, []);

  const [autoSaveRecovery, setAutoSaveRecovery] = useState<AutoSavedGame | null>(null);
  const [autoSaveChecked, setAutoSaveChecked] = useState(false);

  useEffect(() => {
    if (autoSaveCheckedRef.current) return;
    autoSaveCheckedRef.current = true;
    const snapshot = readAutoSavedGame();
    if (snapshot && !isWorthAutoSaving(currentGameSnapshot)) {
      setAutoSaveRecovery(snapshot);
    } else if (snapshot) {
      // Something is already on the board, so the snapshot is stale.
      clearAutoSavedGame();
    }
    setAutoSaveChecked(true);
    // Deliberately mount-only: this is a one-shot check against the board as
    // it was before any move was played.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // currentGameSnapshot is a dependency on purpose: it carries the detected
  // opening and every evaluation a finished search stored on the tree, so as
  // those settle the stored snapshot is rewritten and a recovered game carries
  // them. The live evaluation is deliberately not in it -- see the ref above.
  useEffect(() => {
    if (!autoSaveChecked || autoSaveRecovery) return;
    const timeout = window.setTimeout(() => {
      writeAutoSavedGame(snapshotForStorage(currentGameSnapshot));
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [autoSaveChecked, autoSaveRecovery, currentGameSnapshot, snapshotForStorage]);

  const currentGameSnapshotRef = useRef(currentGameSnapshot);
  useEffect(() => {
    currentGameSnapshotRef.current = currentGameSnapshot;
  }, [currentGameSnapshot]);

  /**
   * The debounce above assumes the tab lives another 600ms, and a phone does
   * not promise that: iOS discards a backgrounded tab without warning and
   * without running an unload handler. What it does run first is `pagehide`,
   * so the snapshot is written there too. The cost of a duplicate write is one
   * localStorage set; the cost of missing one is the move just played -- or the
   * whole game, when it was the first move and nothing had been stored yet.
   *
   * A note being typed is rewritten into the snapshot on the way out rather
   * than read from the tree, because it has not reached the tree yet: it is
   * sitting in the draft ref waiting for its own debounce, and it would
   * otherwise be the one thing this flush failed to save.
   */
  useEffect(() => {
    if (!autoSaveChecked || autoSaveRecovery) return;
    const flush = () => {
      let snapshot = snapshotForStorage(currentGameSnapshotRef.current);
      const pending = moveCommentEditRef.current;
      if (pending) {
        const node = treeNodesRef.current[pending.nodeId];
        const normalized = normalizeMoveComment(pending.draft);
        if (node?.record && normalized !== (node.record.comment ?? '')) {
          const record = { ...node.record };
          if (normalized) record.comment = normalized;
          else delete record.comment;
          const patched = { ...treeNodesRef.current, [pending.nodeId]: { ...node, record } };
          snapshot = { ...snapshot, moveTree: serializeSavedMoveTree(patched, rootNodeId) };
        }
      }
      writeAutoSavedGame(snapshot);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [autoSaveChecked, autoSaveRecovery, rootNodeId, snapshotForStorage]);

  const dismissAutoSaveRecovery = useCallback(() => {
    clearAutoSavedGame();
    setAutoSaveRecovery(null);
  }, []);

  const restoreAutoSavedGame = useCallback(() => {
    if (!autoSaveRecovery) return;
    const restored = handleLoadGame(autoSaveRecovery.game);
    if (!restored) clearAutoSavedGame();
    setAutoSaveRecovery(null);
  }, [autoSaveRecovery, handleLoadGame]);

  /**
   * Single-key shortcuts for the things a player reaches for mid-analysis.
   *
   * The letters are the ones lichess taught a generation of analysis-board
   * users: F flips, X asks what the opponent threatens, and the panel keys
   * follow the tab labels. Held off any text field, any dialog and any
   * modifier, and off the palette's own chord, so they cannot swallow typing.
   *
   * X and D switch to the Engine panel first when the reader is elsewhere,
   * because that is where the answer is drawn -- and switching panels changes
   * the analysis request key, which cancels a threat or a deep search started
   * in the same breath. So the request is held in a ref and run by the effect
   * below once the panel is up, rather than fired and then cancelled.
   */
  const pendingShortcutRef = useRef<'threat' | 'deep' | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (showSettings || showNewGameMenu || showCommandPalette || visibleGameResult || autoSaveRecovery || showBoardEditor) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable || target?.closest('[role="dialog"]')) {
        return;
      }
      const openEnginePanel = () => {
        setAnalysisTab('engine');
        setMobileAnalysisTab('engine');
        setMobileView('analysis');
      };
      switch (event.key.toLowerCase()) {
        case 'f':
          setOrientation((side) => (side === 'red' ? 'black' : 'red'));
          break;
        case 'x':
          if (threatActive) {
            stopThreat();
          } else if (!canShowThreat) {
            return;
          } else if (analysisTab === 'engine') {
            runThreatSearch();
          } else {
            pendingShortcutRef.current = 'threat';
            openEnginePanel();
          }
          break;
        case 'd':
          if (deepDiveActive) {
            stopSearch();
          } else if (!canDeepDive) {
            return;
          } else if (analysisTab === 'engine') {
            runDeepDive();
          } else {
            pendingShortcutRef.current = 'deep';
            openEnginePanel();
          }
          break;
        case 'h':
          if (!canHint) return;
          runHint();
          break;
        case 'e':
          if (!engineEnabled) return;
          openEnginePanel();
          break;
        case 't':
          setAnalysisTab('tree');
          setMobileAnalysisTab('moves');
          setMobileView('analysis');
          break;
        case 'r':
          setAnalysisTab('review');
          setMobileAnalysisTab('review');
          setMobileView('analysis');
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    analysisTab, autoSaveRecovery, canDeepDive, canHint, canShowThreat, deepDiveActive, engineEnabled,
    runDeepDive, runHint, runThreatSearch, showBoardEditor, showCommandPalette, showNewGameMenu, showSettings, stopSearch,
    stopThreat, threatActive, visibleGameResult,
  ]);

  useEffect(() => {
    const pending = pendingShortcutRef.current;
    if (!pending || analysisTab !== 'engine') return;
    if (pending === 'threat' && canShowThreat) {
      pendingShortcutRef.current = null;
      runThreatSearch();
    } else if (pending === 'deep' && canDeepDive) {
      pendingShortcutRef.current = null;
      runDeepDive();
    } else if (!isReady) {
      // Still booting: keep the request until the engine can take it.
      return;
    } else {
      pendingShortcutRef.current = null;
    }
  }, [analysisTab, canDeepDive, canShowThreat, isReady, runDeepDive, runThreatSearch]);

  const reviewNarrativeTags = useMemo(
    () => (reviewStatus === 'done'
      ? narrativeTags(reviewedHistory.map(record => record.evalScore), gameResult ?? null)
      : []),
    [reviewStatus, reviewedHistory, gameResult],
  );

  /**
   * Where the game was played well, not just how well. Derived rather than
   * stored: a review restored from the library carries the per-move losses, and
   * the tree always carries the boards, so this reads the same either way.
   */
  /** The phase each move belongs to, so key moments can be filtered by one. */
  const reviewPhaseByMoveIndex = useMemo(() => {
    if (reviewStatus !== 'done') return [];
    const offset = plyOffsetFromRootFen(rootFen);
    return reviewedHistory.map(record => (record.board
      ? getMovePhaseForRecord({ board: record.board, captured: record.captured }, record.ply + offset)
      : null));
  }, [reviewStatus, reviewedHistory, rootFen]);

  const reviewPhaseAccuracy = useMemo(
    () => (reviewStatus === 'done'
      ? summarizeAccuracyByPhase(reviewedHistory, plyOffsetFromRootFen(rootFen))
      : []),
    [reviewStatus, reviewedHistory, rootFen],
  );

  const handleLoadHistoricalGame = useCallback((game: HistoricalGame) => {
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    setGameMode('PvP');
    setWorkspaceMode('analysis');
    setLeftPanelTab('graph');
    setAnalysisTab('tree');
    loadMoves(game.moves);
    setMobileView('analysis');
    setMobileAnalysisTab('moves');
    setGraphLoadSweepToken((token) => token + 1);
  }, [handleCancelReview, loadMoves, resetReview, stopAnalysis]);

  const dismissGameOverForReview = useCallback(() => {
    if (gameOverKey) {
      setDismissedGameOverKey(gameOverKey);
    }
    setWorkspaceMode('analysis');
    setAnalysisTab('review');
    setMobileView('analysis');
    setMobileAnalysisTab('review');
  }, [gameOverKey]);

  // Board arrows: quality-colored last move + engine recommendation lines
  const boardArrows = useMemo(() => {
    if (!showArrows) return [];
    const result: BoardArrow[] = [];

    // Last played move — color encodes quality (green=good … red=blunder)
    if (lastMoveFrom && lastMoveTo) {
      result.push({ from: lastMoveFrom, to: lastMoveTo, color: lastMoveArrowColor, kind: 'last', opacity: 0.82, strokeWidth: 5 });
    }

    // The threat is what the reader asked to see, so it is drawn even though
    // the engine arrows for the real position are gone while it is showing.
    if (threatMove) {
      const from = uciToSquare(threatMove.substring(0, 2));
      const to = uciToSquare(threatMove.substring(2, 4));
      if (from && to) {
        result.push({ from, to, color: '#f43f5e', kind: 'threat', opacity: 0.92, strokeWidth: 6 });
      }
    }

    if (hintMove) {
      const from = uciToSquare(hintMove.substring(0, 2));
      const to = uciToSquare(hintMove.substring(2, 4));
      if (from && to) {
        result.push({ from, to, color: '#38bdf8', kind: 'engine-focus', opacity: 0.95, strokeWidth: 7 });
      }
    }

    // A question with the answer drawn on the board is not a question.
    if (drillAsking) return [...result, ...userArrows];

    const hasEngineMoveArrows = engineEnabled && Boolean(currentAnalysisPvLines.some((pv) => pv.moves[0]));
    if (!hasEngineMoveArrows && openingCandidates.length > 0) {
      const bookArrowLimit = assistMode === 'pro' ? 3 : 2;
      openingCandidates.slice(0, bookArrowLimit).forEach((candidate, index) => {
        const from = uciToSquare(candidate.move.substring(0, 2));
        const to = uciToSquare(candidate.move.substring(2, 4));
        if (from && to) {
          result.push({
            from,
            to,
            color: index === 0 ? '#f59e0b' : '#fbbf24',
            kind: 'book',
            opacity: index === 0 ? 0.72 : 0.48,
            strokeWidth: index === 0 ? 4.5 : 3.25,
          });
        }
      });
    }

    // Engine best move (green)
    if (engineEnabled && spotlightPvIndex !== 0 && currentAnalysisPvLines[0]?.moves[0]) {
      const uci = currentAnalysisPvLines[0].moves[0];
      const from = uciToSquare(uci.substring(0, 2));
      const to = uciToSquare(uci.substring(2, 4));
      if (from && to) result.push({ from, to, color: '#10b981', kind: 'engine', opacity: 0.88, strokeWidth: 6 });
    }

    // Alternative engine lines (muted green)
    for (let idx = 1; idx <= 2; idx++) {
      if (spotlightPvIndex === idx) continue;
      const uci = currentAnalysisPvLines[idx]?.moves[0];
      if (!uci) continue;
      const from = uciToSquare(uci.substring(0, 2));
      const to = uciToSquare(uci.substring(2, 4));
      if (from && to) result.push({ from, to, color: '#6ee7b7', kind: 'engine', opacity: 0.55, strokeWidth: 3.5 });
    }

    if (engineEnabled && spotlightPvLine?.moves[0]) {
      const uci = spotlightPvLine.moves[0];
      const from = uciToSquare(uci.substring(0, 2));
      const to = uciToSquare(uci.substring(2, 4));
      if (from && to) {
        result.push({ from, to, color: '#38bdf8', kind: 'engine-focus', opacity: 0.95, strokeWidth: 7 });
      }
    }

    return [...result, ...userArrows];
  }, [assistMode, drillAsking, hintMove, lastMoveFrom, lastMoveTo, lastMoveArrowColor, currentAnalysisPvLines, engineEnabled, openingCandidates, showArrows, spotlightPvIndex, spotlightPvLine, threatMove, userArrows]);

  return (
    <main
      className="app-shell"
      data-mobile-view={isMobile ? mobileView : undefined}
      data-assist-mode={assistMode}
    >
      <h1 className="sr-only">Web Xiangqi</h1>

      {/*
        The notices live in the top bar, and the whole top bar is `display:
        none` below 900px -- which takes them out of the accessibility tree
        as well, so a phone got no account of them at all, seen or heard.
        They are exactly the messages that must not be missed: a shared link
        that did not load, a paste whose second game was left behind, a record
        that stopped partway.

        This region is outside that bar and is the only thing that announces
        them, at every width; the chips themselves are visual. The phone sees
        them too, in `.mobile-request-notice` under the board header, which is
        marked aria-hidden so this region stays the only voice.
      */}
      {/* `aria-live` without `role="status"` on purpose: the board's own
          announcer is found by `.sr-only[role="status"]`, and a second match
          for that selector silently becomes the one a query returns. A live
          region needs only the attribute. */}
      <div className="sr-only" aria-live="polite" data-testid="notice-announcement">
        {/* Engine trouble is deliberately not here. The chip in the bar is
            hidden on a phone like everything else in it, but `.mobile-engine-notice`
            already carries that text on a phone and is a live region itself --
            so adding it would announce every engine problem twice. Checked,
            not assumed: with the engine forced to fail at 390px, both regions
            read "Recovering engine". */}
        {importNotice?.label
          ?? (shareLinkNotice ? `${shareLinkNotice.text}. ${shareLinkNotice.detail}` : '')}
      </div>

      {/* Nineteen controls stand between the start of the page and the board:
          the toolbar, the pane resizer, the panel tabs, the graph navigator and
          the opening-book buttons. None of them is waste -- they are all things
          a player uses -- but the board is what the page is for, and reaching it
          took twenty presses of Tab. This is the standard way out, and it is the
          first thing focus lands on. */}
      <button type="button" className="skip-link" onClick={focusBoard}>
        Skip to board
      </button>

      {/* ── Top bar ── */}
      <section className={`panel top ${topPanelOpen ? '' : 'hidden'}`}>
        <div className="panel-inner">
          <div className="panel-content compact-grid">
            <div className="app-brand">
              <IconPawn className="app-brand-icon" />
              <span className="app-brand-text">Web Xiangqi</span>
              <span className="brand-badge">Pikafish</span>
            </div>

            <span className="toolbar-divider desktop-only" />

            {/* Workspace mode pills */}
            <div className="top-mode-pills" role="group" aria-label="Workspace mode">
              <button
                type="button"
                className={`gc-pill ${workspaceMode === 'play' ? 'gc-pill-active' : ''}`}
                onClick={() => setWorkspaceMode('play')}
                aria-pressed={workspaceMode === 'play'}
              >
                Play
              </button>
              <button
                type="button"
                className={`gc-pill ${workspaceMode === 'analysis' ? 'gc-pill-active' : ''}`}
                onClick={() => setWorkspaceMode('analysis')}
                aria-pressed={workspaceMode === 'analysis'}
              >
                Analysis
              </button>
            </div>

            {engineRequired ? (
              <div
                className={`top-engine-state ${engineNotice ? `top-engine-state-${engineNotice.tone}` : ''}`}
                role="status"
                aria-label={topEngineStatusLabel}
              >
                <span className={`status-dot ${isReady ? 'healthy' : ''} ${engineNotice ? engineNotice.tone : ''}`} />
                <span>{topEngineStatusText}</span>
                {isReady ? <span className="engine-variant" aria-hidden="true"> · {engineVariant}</span> : null}
              </div>
            ) : null}
            {shareLinkNotice ? (
              <div
                className={`top-engine-state top-engine-state-${shareLinkNotice.tone}`}
                data-testid="share-link-warning"
                /* Same shape as the import chip beside it: the slot is 192px,
                   so the sentence lives on the tooltip and the label. */
                title={`${shareLinkNotice.text}. ${shareLinkNotice.detail}`}
                aria-label={`${shareLinkNotice.text}. ${shareLinkNotice.detail}`}
              >
                <span className={`status-dot ${shareLinkNotice.tone}`} />
                <span>{shareLinkNotice.text}</span>
              </div>
            ) : null}
            {importNotice ? (
              <div
                className="top-engine-state top-engine-state-warning"
                data-testid="import-notice"
                /* This slot is capped at 192px, which is about 25 characters
                   of the mono face it uses, so a sentence here is clipped
                   mid-word at every viewport width. The visible text is the
                   short form and the whole of it lives on the label and the
                   tooltip -- which is why each notice carries its own. */
                title={importNotice.label}
                aria-label={importNotice.label}
              >
                <span className="status-dot warning" />
                <span>{importNotice.text}</span>
              </div>
            ) : null}

            <span className="toolbar-divider desktop-only" />

            {/* Action buttons */}
            <div className="top-action-buttons">
              <button
                type="button"
                className="top-action-btn"
                onClick={() => setOrientation(o => o === 'red' ? 'black' : 'red')}
                title="Flip board (F)"
                aria-label="Flip board orientation"
                aria-keyshortcuts="F"
              >
                <IconFlip />
                <span className="btn-label-desktop">Flip</span>
              </button>
              <button
                type="button"
                className={`top-action-btn ${showArrows ? 'top-action-btn-active' : ''}`}
                onClick={() => setShowArrows(v => !v)}
                title={showArrows ? 'Hide arrows and markers' : 'Show arrows and markers'}
                aria-label="Toggle board arrows and markers"
                aria-pressed={showArrows}
              >
                <IconArrow />
                <span className="btn-label-desktop">Arrows</span>
              </button>
              <button
                type="button"
                className="top-action-btn"
                onClick={toggleNewGameMenu}
                title="New game"
                aria-label="Start new game"
                aria-haspopup="dialog"
                aria-expanded={showNewGameMenu}
                aria-controls="new-game-menu-dialog"
              >
                <IconRefresh />
                <span className="btn-label-desktop">New</span>
              </button>
              <button
                type="button"
                className="top-action-btn"
                onClick={() => {
                  openLibraryPanel();
                }}
                title="Game library"
                aria-label="Open game library"
              >
                <IconLibrary />
                <span className="btn-label-desktop">Library</span>
              </button>
              {/* The palette was keyboard-only until now, which on a phone means
                  unreachable: there is no Cmd+K on a touch keyboard, and nothing
                  anywhere in the UI said the chord existed. web-katrain surfaces
                  its palette in three places and names the shortcut in each. */}
              <button
                type="button"
                className="top-action-btn"
                onClick={() => setShowCommandPalette(true)}
                title={`Commands (${commandPaletteShortcutLabel()})`}
                aria-label="Open command palette"
                aria-keyshortcuts={COMMAND_PALETTE_ARIA_KEYSHORTCUTS}
                aria-haspopup="dialog"
                data-testid="command-palette-btn"
              >
                <IconSearch />
                <span className="btn-label-desktop">Commands</span>
              </button>
              <button
                type="button"
                className="top-action-btn"
                onClick={toggleSettings}
                title="Settings"
                aria-label="Open settings"
                aria-haspopup="dialog"
                aria-expanded={showSettings}
                aria-controls="settings-dialog"
              >
                <IconSettings />
                <span className="btn-label-desktop">Settings</span>
              </button>
            </div>

          </div>
        </div>
        <button
          type="button"
          className="resize-handle resize-handle-bottom"
          onClick={() => setTopPanelOpen(o => !o)}
          title={topPanelOpen ? 'Collapse top toolbar' : 'Expand top toolbar'}
          aria-label={topPanelOpen ? 'Collapse top toolbar' : 'Expand top toolbar'}
          aria-expanded={topPanelOpen}
          data-testid="top-bar-toggle-handle"
        >
          <span className="resize-pill horizontal" />
        </button>
      </section>

      {/* ── Settings modal ── */}
      {showSettings && (
        <>
          <div
            className="settings-backdrop"
            onClick={closeSettings}
            aria-hidden="true"
          />
          <div
            className="settings-body"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            id="settings-dialog"
            ref={settingsDialogRef}
            tabIndex={-1}
          >
            <div className="settings-header">
              <h2>Settings</h2>
              <button
                className="settings-close-btn"
                type="button"
                onClick={closeSettings}
                aria-label="Close settings"
              >
                <IconX />
              </button>
            </div>

            <div className="settings-group">
              <label htmlFor="settings-workspace-mode">Workspace</label>
              <select
                id="settings-workspace-mode"
                className="premium-select"
                value={workspaceMode}
                onChange={(e) => setWorkspaceMode(e.target.value as WorkspaceMode)}
              >
                <option value="analysis">Analysis</option>
                <option value="play">Play</option>
              </select>
            </div>

            <div className="settings-group">
              <span id="settings-interface-label" className="settings-label">Interface</span>
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-interface-label">
                <button
                  type="button"
                  className={`pill-btn ${assistMode === 'coach' ? 'pill-btn-active' : ''}`}
                  onClick={() => setAssistMode('coach')}
                  aria-pressed={assistMode === 'coach'}
                  aria-label={ASSIST_MODE_COPY.coach.ariaLabel}
                  title={ASSIST_MODE_COPY.coach.title}
                >
                  Coach
                </button>
                <button
                  type="button"
                  className={`pill-btn ${assistMode === 'pro' ? 'pill-btn-active' : ''}`}
                  onClick={() => setAssistMode('pro')}
                  aria-pressed={assistMode === 'pro'}
                  aria-label={ASSIST_MODE_COPY.pro.ariaLabel}
                  title={ASSIST_MODE_COPY.pro.title}
                >
                  Pro
                </button>
              </div>
              {/* The same visible hint Move Notation has. These two groups are
                  the ones whose labels do not explain themselves -- "Coach" and
                  "Optimized" mean nothing until told -- and the telling lived
                  only in `title`, which does not exist on a touch screen. The
                  words are the ones already written for the tooltip. */}
              <p className="settings-hint">{ASSIST_MODE_COPY[assistMode].title}</p>
            </div>

            <div className="settings-group">
              <span id="settings-notation-label" className="settings-label">Move Notation</span>
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-notation-label">
                {NOTATION_STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    className={`pill-btn ${notationStyle === style ? 'pill-btn-active' : ''}`}
                    onClick={() => setNotationStyle(style)}
                    aria-pressed={notationStyle === style}
                    aria-label={`Write moves in ${NOTATION_STYLE_LABELS[style]} notation. ${NOTATION_STYLE_DESCRIPTIONS[style]}`}
                    title={NOTATION_STYLE_DESCRIPTIONS[style]}
                    data-testid={`notation-style-${style}`}
                  >
                    {NOTATION_STYLE_LABELS[style]}
                  </button>
                ))}
              </div>
              <p className="settings-hint">{NOTATION_STYLE_DESCRIPTIONS[notationStyle]}</p>
            </div>

            <div className="settings-group">
              <label htmlFor="settings-game-mode">Game Mode</label>
              <select
                id="settings-game-mode"
                className="premium-select"
                value={gameMode}
                onChange={(e) => {
                  applyMode(e.target.value as GameMode);
                  setShowSettings(false);
                }}
              >
                {GAME_MODES.map(({ mode, label }) => (
                  <option key={mode} value={mode}>{label}</option>
                ))}
              </select>
            </div>

            <div className="settings-group">
              <span id="settings-orientation-label" className="settings-label">Board Orientation</span>
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-orientation-label">
                <button
                  type="button"
                  className={`pill-btn ${orientation === 'red' ? 'pill-btn-active' : ''}`}
                  onClick={() => setOrientation('red')}
                  aria-pressed={orientation === 'red'}
                >
                  Red at bottom
                </button>
                <button
                  type="button"
                  className={`pill-btn ${orientation === 'black' ? 'pill-btn-active' : ''}`}
                  onClick={() => setOrientation('black')}
                  aria-pressed={orientation === 'black'}
                >
                  Black at bottom
                </button>
              </div>
            </div>

            <div className="settings-group">
              <span id="settings-layout-label" className="settings-label">Layout</span>
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-layout-label">
                <button
                  type="button"
                  className={`pill-btn ${leftPanelOpen ? 'pill-btn-active' : ''}`}
                  onClick={() => setLeftWidth(w => w > 0 ? 0 : DEFAULT_LEFT_PANEL_WIDTH)}
                  aria-pressed={leftPanelOpen}
                >
                  Graph Panel
                </button>
                <button
                  type="button"
                  className={`pill-btn ${rightPanelOpen ? 'pill-btn-active' : ''}`}
                  onClick={() => setRightWidth(w => w > 0 ? 0 : DEFAULT_RIGHT_PANEL_WIDTH)}
                  aria-pressed={rightPanelOpen}
                >
                  Tree Panel
                </button>
              </div>
            </div>

            <div className="settings-group">
              <span id="settings-analysis-engine-label" className="settings-label">Analysis Engine</span>
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-analysis-engine-label">
                <button
                  type="button"
                  className={`pill-btn ${analysisEngineMode === 'stable' ? 'pill-btn-active' : ''}`}
                  onClick={() => setAnalysisEngineMode('stable')}
                  aria-pressed={analysisEngineMode === 'stable'}
                  aria-label={ANALYSIS_ENGINE_MODE_COPY.stable.ariaLabel}
                  title={ANALYSIS_ENGINE_MODE_COPY.stable.title}
                >
                  Stable
                </button>
                <button
                  type="button"
                  className={`pill-btn ${analysisEngineMode === 'optimized' ? 'pill-btn-active' : ''}`}
                  onClick={() => setAnalysisEngineMode('optimized')}
                  aria-pressed={analysisEngineMode === 'optimized'}
                  aria-label={ANALYSIS_ENGINE_MODE_COPY.optimized.ariaLabel}
                  title={ANALYSIS_ENGINE_MODE_COPY.optimized.title}
                >
                  Optimized
                </button>
              </div>
              <p className="settings-hint">{ANALYSIS_ENGINE_MODE_COPY[analysisEngineMode].title}</p>
            </div>

            <div className="settings-group">
              {/* Every other group here is a one- or two-word label. Spelling the
                  scope out inline pushed this one onto a second line and orphaned
                  its value; it lives in the tooltip instead. */}
              <label
                htmlFor="settings-search-depth"
                className="settings-label-value"
                title="Caps live analysis; the AI opponent has its own ceiling per strength"
              >
                <span>Search Depth</span>
                <strong>
                  {searchDepth}
                  {liveAnalysisPolicy.primary.depth < searchDepth
                    ? ` · this device ${liveAnalysisPolicy.primary.depth}`
                    : ''}
                </strong>
              </label>
              <input
                id="settings-search-depth"
                type="range"
                min="1"
                max="24"
                value={searchDepth}
                onChange={(e) => setSearchDepth(Number(e.target.value))}
                className="premium-slider"
              />
            </div>

            {/* The transposition table is the one engine resource a strong
                player expects to set, and it matters more now that a search
                runs for a second or two: a table that fills mid-search starts
                discarding work the search is about to want again. `hash %` in
                the engine dashboard is what says the current size is too small.
                Changing it reboots the engine, which takes about a third of a
                second, so the label says so rather than leaving a stall
                unexplained. */}
            {/* Downward only, and the ladder says so by stopping at what this
                machine was going to take anyway. The reason to want it is an
                unplugged laptop or a machine busy with something that matters
                more than the search; upward has nothing to offer, because the
                ceiling is the shipped core's thread pool rather than a policy. */}
            {engineThreadChoices.length > 1 ? (
              <div className="settings-group">
                <span
                  id="settings-engine-threads-label"
                  className="settings-label"
                  title="How much of the processor the search gets. Changing it restarts the engine."
                >
                  Engine Threads
                </span>
                <div className="settings-inline-toggles" role="group" aria-labelledby="settings-engine-threads-label">
                  {engineThreadChoices.map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={`pill-btn ${engineBootConfig.threads === count ? 'pill-btn-active' : ''}`}
                      onClick={() => setEngineThreads(count)}
                      aria-pressed={engineBootConfig.threads === count}
                      aria-label={`Engine threads ${count}${engineBootConfig.threads === count ? ', in use' : ''}`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="settings-group">
              <span
                id="settings-engine-hash-label"
                className="settings-label"
                title="The engine's transposition table. Changing it restarts the engine."
              >
                Engine Hash
              </span>
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-engine-hash-label">
                {engineHashChoices.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`pill-btn ${engineBootConfig.hashMB === size ? 'pill-btn-active' : ''}`}
                    onClick={() => setEngineHashMB(size)}
                    aria-pressed={engineBootConfig.hashMB === size}
                    aria-label={`Engine hash ${size} megabytes${engineBootConfig.hashMB === size ? ', in use' : ''}`}
                  >
                    {size}MB
                  </button>
                ))}
              </div>
            </div>

            {isAiMode && (
              <div className="settings-group">
                <span id="settings-ai-speed-label" className="settings-label">AI Speed</span>
                <div className="settings-inline-toggles" role="group" aria-labelledby="settings-ai-speed-label">
                  {(['slow', 'normal', 'fast', 'step'] as AiSpeed[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`pill-btn ${aiSpeed === s ? 'pill-btn-active' : ''}`}
                      onClick={() => handleSpeedChange(s)}
                      aria-pressed={aiSpeed === s}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="settings-group">
              <span id="settings-sound-label" className="settings-label">Sound Effects</span>
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-sound-label">
                <button
                  type="button"
                  className={`pill-btn ${soundEnabled ? 'pill-btn-active' : ''}`}
                  onClick={() => handleSoundToggle(true)}
                  aria-pressed={soundEnabled}
                >
                  On
                </button>
                <button
                  type="button"
                  className={`pill-btn ${!soundEnabled ? 'pill-btn-active' : ''}`}
                  onClick={() => handleSoundToggle(false)}
                  aria-pressed={!soundEnabled}
                >
                  Off
                </button>
              </div>
            </div>

            <div className="settings-group">
              <a
                className="settings-link"
                href={THIRD_PARTY_NOTICES_HREF}
                target="_blank"
                rel="noreferrer noopener"
              >
                <IconLink /> Engine Notices
              </a>
              <button
                type="button"
                className="gc-btn settings-reset-btn"
                onClick={resetPreferences}
                data-testid="reset-preferences-btn"
              >
                <IconRefresh /> Reset Preferences
              </button>
              <button
                type="button"
                className="gc-btn gc-btn-danger"
                onClick={() => { resetGame(); setShowSettings(false); }}
              >
                <IconRefresh /> New Game
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── New game menu ── */}
      {showNewGameMenu && (
        <>
          <div
            className="settings-backdrop"
            onClick={closeNewGameMenu}
            aria-hidden="true"
          />
          <div
            className="new-game-menu"
            role="dialog"
            aria-modal="true"
            aria-label="New game"
            id="new-game-menu-dialog"
            ref={newGameDialogRef}
            tabIndex={-1}
          >
            <div className="new-game-menu-header">
              <div className="new-game-menu-copy">
                <h2>New Game</h2>
              </div>
              <button
                className="settings-close-btn"
                type="button"
                onClick={closeNewGameMenu}
                aria-label="Close"
              >
                <IconX />
              </button>
            </div>
            <div className="new-game-menu-modes">
              {GAME_MODES.map(({ mode, label, description }) => (
                <button
                  key={mode}
                  type="button"
                  className={`new-game-mode-btn ${pendingGameMode === mode ? 'new-game-mode-btn-active' : ''}`}
                  onClick={() => setPendingGameMode(mode)}
                  aria-pressed={pendingGameMode === mode}
                  aria-label={`${label}. ${description}`}
                >
                  <span>{label}</span>
                  <small>{description}</small>
                </button>
              ))}
            </div>
            {pendingModeIsAi && (
              <div className="new-game-strength-section">
                <p className="new-game-strength-label">AI Difficulty</p>
                <div className="new-game-strength-pills">
                  {([1, 2, 3, 4, 5, 6] as AiStrength[]).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className={`new-game-strength-btn ${aiStrength === lvl ? 'new-game-strength-btn-active' : ''}`}
                      onClick={() => setAiStrength(lvl)}
                      title={describeAiStrength(lvl)}
                      aria-label={describeAiStrength(lvl)}
                      aria-pressed={aiStrength === lvl}
                    >
                      {AI_STRENGTH_LABELS[lvl]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="new-game-fen-section">
              <p className="new-game-strength-label">Load Position (FEN)</p>
              <form
                className="new-game-fen-form"
                onSubmit={(e) => { e.preventDefault(); handleLoadFen(fenInput, pendingGameMode); }}
              >
                <input
                  className={`new-game-fen-input ${fenError ? 'new-game-fen-input-error' : ''}`}
                  type="text"
                  value={fenInput}
                  onChange={(e) => {
                    setFenInput(e.target.value);
                    if (fenError) clearFenError();
                  }}
                  placeholder="rnbakabnr/9/… w - - 0 1"
                  aria-label="FEN string"
                  aria-invalid={fenError ? true : undefined}
                  aria-describedby={fenError ? 'new-game-fen-error' : undefined}
                />
                <button
                  type="submit"
                  className="new-game-strength-btn new-game-strength-btn-active"
                  disabled={!fenInput.trim()}
                >
                  {fenError ? 'Invalid FEN' : 'Load'}
                </button>
              </form>
              {fenError ? (
                <span id="new-game-fen-error" className="new-game-fen-error" role="alert">
                  {fenError}
                </span>
              ) : null}
              {/* For the position nobody has a FEN for: the endgame in a
                  book, a composed problem, the one a friend described. */}
              <button
                type="button"
                className="new-game-file-btn"
                style={{ marginTop: '0.5rem' }}
                onClick={() => setShowBoardEditor(true)}
                data-testid="open-board-editor-btn"
              >
                Set up the board by hand
              </button>
            </div>
            <div className="new-game-fen-section">
              <p className="new-game-strength-label">Import Move Line</p>
              <form
                className="new-game-line-form"
                onSubmit={(e) => { e.preventDefault(); handleImportMoveLine(moveLineInput, pendingGameMode); }}
              >
                <textarea
                  className={`new-game-line-input ${moveLineError ? 'new-game-fen-input-error' : ''}`}
                  value={moveLineInput}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setMoveLineFileName('');
                    if (isMoveImportTextTooLarge(nextValue)) {
                      setMoveLineInput('');
                      setMoveLineError(`Move line is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.`);
                      return;
                    }
                    setMoveLineInput(nextValue);
                    setMoveLineError(null);
                  }}
                  placeholder="1. 炮二平五 马8进7   ·   1. C2=5 H8+7   ·   1. b2e2 h9g7"
                  aria-label="Move line in coordinates, WXF or Chinese notation"
                  aria-invalid={moveLineError ? true : undefined}
                  aria-describedby={moveLineError ? 'new-game-line-error' : undefined}
                  rows={3}
                  data-testid="uci-line-input"
                />
                <div className="new-game-file-row">
                  <button
                    type="button"
                    className="new-game-file-btn"
                    onClick={handlePickMoveLineFile}
                    data-testid="load-uci-file-btn"
                  >
                    <IconUpload /> Open PGN
                  </button>
                  <input
                    ref={moveLineFileInputRef}
                    className="new-game-file-input"
                    type="file"
                    accept=".pgn,.txt,text/plain,application/x-chess-pgn"
                    onChange={handleMoveLineFileChange}
                    aria-label="Open PGN file"
                    data-testid="uci-line-file-input"
                  />
                  {moveLineFileName ? <span className="new-game-file-name" title={moveLineFileName}>{moveLineFileName}</span> : null}
                </div>
                <div className="new-game-line-actions">
                  {moveLineError ? <span id="new-game-line-error" className="new-game-line-error" role="alert">{moveLineError}</span> : <span />}
                  <button
                    type="submit"
                    className="new-game-strength-btn new-game-strength-btn-active"
                    disabled={!moveLineInput.trim()}
                    data-testid="import-uci-line-btn"
                  >
                    Import
                  </button>
                </div>
              </form>
            </div>
            <div className="new-game-menu-footer">
              <div className="new-game-selection" aria-label={`Selected ${pendingModeLabel}. ${pendingModeMeta.description}`}>
                <span className="new-game-selection-label">Selected</span>
                <strong>{pendingModeLabel}</strong>
              </div>
              <button
                type="button"
                className="new-game-start-btn"
                onClick={startNewGameFromMenu}
              >
                Start Fresh Board
              </button>
            </div>
          </div>
        </>
      )}

      <div className="main-container" data-mobile-tab={isMobile ? mobileAnalysisTab : undefined}>
        {/* ── Left panel: Eval Graph ── */}
        {/* Named so it becomes a region landmark. Its twin on the right is an
            <aside> (complementary) carrying an <h2>, so without a name here the
            graph/library panel was reachable by neither landmark nor heading. */}
        <section className="panel left" aria-label="Graph and library">
          <div
            className="resize-handle resize-handle-right"
            role="separator"
            tabIndex={0}
            onPointerDown={startLeftResize}
            onClick={() => { if (leftWidth === 0) setLeftWidth(DEFAULT_LEFT_PANEL_WIDTH); }}
            onKeyDown={handleLeftResizeKeyDown}
            aria-label={leftPanelOpen ? `Resize left graph and library panel, ${Math.round(leftWidth)} pixels wide` : 'Expand left graph and library panel'}
            aria-orientation="vertical"
            aria-controls="left-panel-content"
            aria-valuemin={0}
            aria-valuemax={PANEL_MAX_WIDTH}
            aria-valuenow={Math.round(leftWidth)}
            title={leftPanelOpen ? 'Drag to resize. Press arrow keys to adjust, Home to collapse, End to restore.' : 'Click, press Enter, or press End to expand the left panel.'}
            data-testid="left-panel-resize-handle"
          >
            <span className="resize-pill" />
          </div>
          <div className="panel-inner" style={{ opacity: (!isMobile && leftWidth === 0) ? 0 : 1 }}>
            <header className="panel-header panel-header-tabs">
              <div className="analysis-tab-strip" role="tablist" aria-label="Graph and library panels" onKeyDown={handleTablistKeyDown}>
                <button
                  type="button"
                  role="tab"
                  id="left-panel-tab-graph"
                  className={`analysis-tab-btn ${leftPanelTab === 'graph' ? 'active' : ''}`}
                  onClick={() => setLeftPanelTab('graph')}
                  aria-selected={leftPanelTab === 'graph'}
                  aria-controls="left-panel-content"
                  data-testid="left-panel-tab-graph"
                >
                  <IconBarChart style={{ marginRight: '0.3rem' }} />Graph
                </button>
                <button
                  type="button"
                  role="tab"
                  id="left-panel-tab-library"
                  className={`analysis-tab-btn ${leftPanelTab === 'library' ? 'active' : ''}`}
                  onClick={() => setLeftPanelTab('library')}
                  aria-selected={leftPanelTab === 'library'}
                  aria-controls="left-panel-content"
                  data-testid="left-panel-tab-library"
                >
                  <IconLibrary style={{ marginRight: '0.3rem' }} />Library
                </button>
              </div>
            </header>
            <div
              className="panel-content"
              role="tabpanel"
              id="left-panel-content"
              aria-labelledby={`left-panel-tab-${leftPanelTab}`}
            >
              {leftPanelTab === 'graph' ? (
                <>
                  {shouldShowWdlBar && <WdlBar wdl={displayWdl} isSearching={isSearching} />}
                  <EvalGraph
                    history={moveHistory}
                    currentMoveIndex={currentMoveIndex}
                    currentEval={displayEvalScore}
                    isSearching={isSearching}
                    activity={analysisActivity}
                    notationStyle={notationStyle}
                    branchCounts={graphBranchCounts}
                    rootBranchCount={rootGraphBranchCount}
                    loadSweepToken={graphLoadSweepToken}
                    onNavigate={jumpToMove}
                  />
                  {openingCandidates.length > 0 ? (
                    <div className="opening-candidates-card">
                      <div className="opening-candidates-head">
                        <span>Book continuations</span>
                        <strong>{openingCandidates.length}</strong>
                      </div>
                      <div className="opening-candidates-list">
                        {openingCandidates.map((candidate) => (
                          <button
                            key={candidate.move}
                            type="button"
                            className="opening-candidate-btn"
                            onClick={() => handlePlayBookMove(candidate.move)}
                            disabled={Boolean(gameResult) || isAiTurn}
                            title={isAiTurn ? 'Wait for the AI move to finish' : candidate.names.join(' · ')}
                            aria-label={`Play book continuation ${formatLineInStyle(board, [candidate.move], notationStyle, 1)}: ${candidate.names[0] ?? candidate.chinese[0]}`}
                            data-testid={`book-candidate-${candidate.move}`}
                          >
                            <strong>{formatLineInStyle(board, [candidate.move], notationStyle, 1)}</strong>
                            <span className="opening-candidate-main">
                              <span>{candidate.names[0] ?? candidate.chinese[0]}</span>
                              {candidate.names[0] && candidate.chinese[0] ? <small>{candidate.chinese[0]}</small> : null}
                            </span>
                            <em>{candidate.count} line{candidate.count === 1 ? '' : 's'}</em>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="opening-candidates-card cloud-book-card" data-testid="cloud-book-card" data-status={cloudBook.status} data-fen={cloudBook.fen}>
                    <div className="opening-candidates-head">
                      <span>Cloud book</span>
                      <strong>
                        {cloudBook.status === 'ok'
                          ? cloudBook.moves.length
                          : cloudBook.status === 'loading'
                            ? '…'
                            : ''}
                      </strong>
                    </div>
                    {!cloudBookEnabled ? (
                      <>
                        <p className="library-explorer-note">
                          What is played here, from the {CLOUD_BOOK_SITE_NAME} database, and its ruling on a repetition. Sends this position -- and, once a position repeats, the moves that led to it -- and nothing else, to {CLOUD_BOOK_SITE_NAME}.
                        </p>
                        <button
                          type="button"
                          className="chip-btn cloud-book-toggle"
                          onClick={() => setCloudBookEnabled(true)}
                          data-testid="cloud-book-enable"
                        >
                          Turn on
                        </button>
                      </>
                    ) : cloudBook.status === 'ok' && cloudBook.moves.length > 0 ? (
                      <div className="opening-candidates-list">
                        {cloudBook.moves.slice(0, cloudBookMoveLimit).map((move) => {
                          const moveText = formatLineInStyle(board, [move.uci], notationStyle, 1);
                          const scoreText = formatCloudBookScore(move.score, sideToMove);
                          const winrateText = move.winrate === null ? '' : `${move.winrate.toFixed(1)}% for ${sideToMoveLabel}`;
                          return (
                            <button
                              key={move.uci}
                              type="button"
                              className={`opening-candidate-btn cloud-book-move cloud-book-rank-${move.rank}`}
                              onClick={() => handlePlayBookMove(move.uci)}
                              disabled={Boolean(gameResult) || isAiTurn}
                              title={isAiTurn ? 'Wait for the AI move to finish' : `${CLOUD_BOOK_SITE_NAME} ${move.note ? `note ${move.note}, ` : ''}score ${scoreText} Red POV${winrateText ? `, win rate ${winrateText}` : ''}`}
                              aria-label={`Play cloud book move ${moveText}, score ${scoreText} Red POV${winrateText ? `, win rate ${winrateText}` : ''}`}
                              data-testid={`cloud-book-move-${move.uci}`}
                            >
                              <strong>{moveText}</strong>
                              <span className="opening-candidate-main">
                                <span>{winrateText || move.note || 'Known move'}</span>
                                {move.note && winrateText ? <small>{move.note}</small> : null}
                              </span>
                              <em>{scoreText}</em>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="library-explorer-note" role="status">
                        {cloudBook.status === 'loading'
                          ? `Asking ${CLOUD_BOOK_SITE_NAME}…`
                          : cloudBook.status === 'error'
                            ? `${CLOUD_BOOK_SITE_NAME} did not answer. It will be asked again on the next position.`
                            : 'Not in the cloud book.'}
                      </p>
                    )}
                    {cloudBookEnabled ? (
                      <button
                        type="button"
                        className="chip-btn cloud-book-toggle"
                        onClick={() => setCloudBookEnabled(false)}
                        title={`Stop sending positions to ${CLOUD_BOOK_SITE_NAME}`}
                        data-testid="cloud-book-disable"
                      >
                        Turn off
                      </button>
                    ) : null}
                  </div>
                  <div className="graph-jump-controls">
                    <button type="button" className="chip-btn graph-jump-btn" onClick={goToFirstMove} disabled={!canGoBack} title="Go to first position" aria-label="Go to first position">
                      <IconSkipBack aria-hidden="true" focusable="false" />
                    </button>
                    <button type="button" className="chip-btn graph-jump-btn" onClick={goToPreviousMove} disabled={!canGoBack} title="Go to previous move" aria-label="Go to previous move">
                      <IconChevronLeft aria-hidden="true" focusable="false" />
                    </button>
                    <button type="button" className="chip-btn graph-jump-btn" onClick={goToNextMove} disabled={!canGoForward} title="Go to next move" aria-label="Go to next move">
                      <IconChevronRight aria-hidden="true" focusable="false" />
                    </button>
                    <button type="button" className="chip-btn graph-jump-btn" onClick={goToLatestMove} disabled={!canGoForward} title="Go to latest move" aria-label="Go to latest move">
                      <IconSkipForward aria-hidden="true" focusable="false" />
                    </button>
                  </div>
                  <p className="panel-copy small">
                    Active ply: <strong>{viewedPly}</strong> / {moveHistory.length}
                  </p>
                  {libraryPositionReport.games > 0 ? (
                    <div className="opening-candidates-card library-explorer-card">
                      <div className="opening-candidates-head">
                        <span>From your library</span>
                        <strong>{libraryPositionReport.games}</strong>
                      </div>
                      {libraryPositionReport.moves.length > 0 ? (
                        <div className="opening-candidates-list">
                          {libraryPositionReport.moves.slice(0, assistMode === 'pro' ? 6 : 4).map((move) => (
                            <button
                              key={move.uci}
                              type="button"
                              className="opening-candidate-btn"
                              onClick={() => handlePlayBookMove(move.uci)}
                              disabled={Boolean(gameResult) || isAiTurn}
                              title={isAiTurn ? 'Wait for the AI move to finish' : `Played in ${move.games} of your saved games`}
                              aria-label={`Play ${formatLineInStyle(board, [move.uci], notationStyle, 1)}, played in ${move.games} of your saved games, record ${formatExplorerRecord(move)}`}
                              data-testid={`library-continuation-${move.uci}`}
                            >
                              <strong>{formatLineInStyle(board, [move.uci], notationStyle, 1)}</strong>
                              <span className="opening-candidate-main">
                                <span>{move.games} {move.games === 1 ? 'game' : 'games'}</span>
                                <small>{formatExplorerRecord(move)}</small>
                              </span>
                              <em>{Math.round((move.games / libraryPositionReport.games) * 100)}%</em>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="library-explorer-note">
                          {libraryPositionReport.games === 1 ? 'One saved game ends here.' : `${libraryPositionReport.games} saved games end here.`}
                        </p>
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                <LazyPanelBoundary>
                {qaForcePanelError ? <QaForcedRenderError /> : (
                <React.Suspense fallback={<div className="library-loading" data-testid="library-loading">Loading library…</div>}>
                  <LazyLibraryPanel
                    savedGames={savedGames}
                    onLoadSavedGame={handleLoadGame}
                    onDeleteSavedGame={deleteGameFromLibrary}
                    onRenameSavedGame={renameGameInLibrary}
                    onLoadHistorical={handleLoadHistoricalGame}
                  />
                </React.Suspense>
                )}
                </LazyPanelBoundary>
              )}
            </div>
          </div>
        </section>

        {/* ── Board stage ── */}
        <section className="board-stage" aria-label="Xiangqi board">
          {!isMobile && (
            <div className="board-stage-header">
              <div className="board-stage-copy">
                <span className="board-stage-kicker">
                  {workspaceMode === 'analysis' ? 'Analysis board' : 'Play board'}
                </span>
                <h1>{currentModeLabel}</h1>
                <p>
                  {detectedOpening
                    ? `${detectedOpening.name} is on the board. ${engineEnabled && redPerspectiveEvalText ? `Live eval ${redPerspectiveEvalText}.` : 'Keep exploring variations and review notes.'}`
                    : workspaceMode === 'analysis'
                      ? `${currentModeMeta.description} Engine lines and review stay synced with the current position.`
                      : currentModeMeta.description}
                </p>
              </div>
              <div className="board-stage-chips">
                <span className={`board-stage-chip board-stage-chip-turn ${sideToMove === 'w' ? 'turn-red' : 'turn-black'}`}>
                  <span className={`turn-dot turn-dot-${sideToMove === 'w' ? 'red' : 'black'}`} />
                  {sideToMoveLabel} to move
                </span>
                <span className="board-stage-chip">Ply {viewedPly} / {moveHistory.length}</span>
                {redPerspectiveEvalText ? (
                  <span
                    className={`board-stage-chip board-stage-chip-eval ${displayEvalClass}`}
                    aria-label={liveEvalLabel}
                    title={liveEvalLabel}
                  >
                    {redPerspectiveEvalText}
                  </span>
                ) : null}
                {detectedOpening ? (
                  <span className="board-stage-chip board-stage-chip-opening">
                    {detectedOpening.chinese} · {detectedOpening.name}
                  </span>
                ) : (
                  <span className="board-stage-chip board-stage-chip-muted">
                    {engineEnabled ? 'Engine live' : 'Engine off'}
                  </span>
                )}
                {aiPlayActive ? (
                  <span className="board-stage-chip board-stage-chip-muted">
                    {paused ? 'AI paused' : `${AI_STRENGTH_LABELS[aiStrength]} · ${aiSpeed === 'step' ? 'step' : aiSpeed}`}
                  </span>
                ) : null}
              </div>
            </div>
          )}
          {isMobile && mobileView === 'board' && (
            <div className="mobile-board-header">
              <div className="mobile-board-turn-info">
                <span className={`turn-dot turn-dot-${sideToMove === 'w' ? 'red' : 'black'}`} />
                <span className="mobile-turn-label">{sideToMove === 'w' ? 'Red' : 'Black'}</span>
                {engineEnabled && displayEvalScore !== null && (
                  <span
                    className={`mobile-eval-chip ${displayEvalClass}`}
                    aria-label={liveEvalLabel}
                    title={liveEvalLabel}
                  >
                    {currentEvalText}
                  </span>
                )}
                {/* The desktop engine status lives in .panel.top and is repeated in
                    .panel.bottom; both panels are display:none on a phone, so a failed
                    engine was completely silent there -- in every mobile view, forever.
                    This slot is free exactly when it matters: a dead engine produces no
                    eval, so the chip above is absent. */}
                {engineNotice ? (
                  <span
                    className={`mobile-engine-notice mobile-engine-notice-${engineNotice.tone}`}
                    role="status"
                    title={engineNotice.text}
                  >
                    {engineNotice.text}
                  </span>
                ) : mobileEngineLoading ? (
                  // The same slot, for the wait rather than the failure. The
                  // engine's weights are 53MB, so on a phone connection this is
                  // a minute or more during which the chip above cannot appear
                  // -- and a board with no evaluation and no explanation reads
                  // as an app whose analysis is simply broken. Desktop has said
                  // "Loading engine" in the top bar all along; both panels that
                  // carry it are display:none here.
                  //
                  // "Loading" rather than "Loading engine" because the longer
                  // string wraps this header onto a second row -- 40px to 66px
                  // at 390px wide -- which moves the board down and then back
                  // up when the engine arrives. The full phrase is on the label
                  // for anything reading it aloud.
                  <span
                    className="mobile-engine-notice"
                    role="status"
                    aria-label={engineDownloadShortText
                      ? `Loading engine, ${engineDownloadShortText} of the weights downloaded`
                      : 'Loading engine'}
                    title={engineDownloadText ? `Loading engine · ${engineDownloadText}` : 'Loading engine'}
                  >
                    {/* The percentage *instead of* the word, not beside it.
                        This slot is the one measured at 40px against 66px:
                        "Loading 24%" wraps the header onto a second row, which
                        moves the board down for the whole download and back up
                        when the engine arrives. What it is saying is on the
                        label and the title. */}
                    {engineDownloadShortText ?? 'Loading'}
                  </span>
                ) : null}
                {detectedOpening && (
                  <span className="mobile-opening-pill" title={detectedOpening.name}>
                    {detectedOpening.name}
                  </span>
                )}
              </div>
              <div className="mobile-board-actions" role="group" aria-label="Board actions">
                <button
                  className="mobile-action-btn"
                  type="button"
                  onClick={toggleNewGameMenu}
                  title="New game"
                  aria-label="Open new game menu"
                  aria-haspopup="dialog"
                  aria-expanded={showNewGameMenu}
                  aria-controls="new-game-menu-dialog"
                >
                  <IconRefresh />
                </button>
                <button
                  className={`mobile-action-btn ${savedToast ? 'mobile-action-btn-active' : ''} ${saveFailedToast ? 'mobile-action-btn-warn' : ''}`}
                  type="button"
                  onClick={handleSaveGame}
                  disabled={!canSaveCurrentPosition}
                  title={saveFailedToast ? 'Save failed' : savedToast ? 'Saved' : 'Save current game'}
                  aria-label={saveFailedToast ? 'Current game save failed' : savedToast ? 'Current game saved' : 'Save current game'}
                  data-testid="mobile-save-game-btn"
                >
                  {saveFailedToast ? <IconX /> : savedToast ? <IconCheck /> : <IconSave />}
                </button>
                <button
                  className="mobile-action-btn"
                  type="button"
                  onClick={openLibraryPanel}
                  title="Game library"
                  aria-label="Open game library"
                  data-testid="mobile-open-library-btn"
                >
                  <IconLibrary />
                </button>
                {aiPlayActive && (
                  <button className={`mobile-action-btn ${paused ? 'mobile-action-btn-warn' : ''}`} type="button" onClick={() => paused ? resume() : pause()} title={paused ? 'Resume AI' : 'Pause AI'} aria-label={paused ? 'Resume AI' : 'Pause AI'}>
                    {paused ? <IconPlay /> : <IconPause />}
                  </button>
                )}
                <button
                  className={`mobile-action-btn ${showMobileBoardActionMenu ? 'mobile-action-btn-active' : ''}`}
                  type="button"
                  onClick={() => setShowMobileBoardActionMenu((open) => !open)}
                  title="More board actions"
                  aria-label="More board actions"
                  aria-haspopup="menu"
                  aria-expanded={showMobileBoardActionMenu}
                  aria-controls="mobile-board-action-menu"
                  data-testid="mobile-more-actions-btn"
                >
                  <IconMore />
                </button>
                <button
                  className="mobile-action-btn"
                  type="button"
                  onClick={toggleSettings}
                  title="Settings"
                  aria-label="Open settings"
                  aria-haspopup="dialog"
                  aria-expanded={showSettings}
                  aria-controls="settings-dialog"
                >
                  <IconSettings />
                </button>
              </div>
              {(importNotice || shareLinkNotice) ? (
                <div
                  className={`mobile-request-notice mobile-request-notice-${shareLinkNotice?.tone ?? 'warning'}`}
                  data-testid="mobile-request-notice"
                  title={importNotice?.label
                    ?? (shareLinkNotice ? `${shareLinkNotice.text}. ${shareLinkNotice.detail}` : undefined)}
                  aria-hidden="true"
                >
                  <span className={`status-dot ${shareLinkNotice?.tone ?? 'warning'}`} />
                  <span>{importNotice?.text ?? shareLinkNotice?.text}</span>
                </div>
              ) : null}
            </div>
          )}
          {isMobile && mobileView === 'board' && showMobileBoardActionMenu ? (
            <>
              <div
                className="mobile-board-action-backdrop"
                onClick={() => setShowMobileBoardActionMenu(false)}
                aria-hidden="true"
              />
              <div
                id="mobile-board-action-menu"
                className="mobile-board-action-menu"
                role="menu"
                aria-label="More board actions"
              >
                {/* The desktop bar this mirrors is hidden at these widths, so
                    without an entry here the only way to it on a phone is the
                    command palette. */}
                {engineEnabled && canPlayFromHere ? (
                  <button
                    className="mobile-action-menu-btn"
                    type="button"
                    onClick={() => { setShowMobileBoardActionMenu(false); playFromHere(); }}
                    role="menuitem"
                    title={`Keep this position and play on as ${sideToMove === 'w' ? 'Red' : 'Black'}`}
                    aria-label={`Play on from this position against the engine as ${sideToMove === 'w' ? 'Red' : 'Black'}`}
                    data-testid="mobile-play-from-here-btn"
                  >
                    <IconPlay />
                    <span>Play from here</span>
                  </button>
                ) : null}
                {/* Copying is the useful half on a phone: an exported file lands
                    in the Files app, while the clipboard is what a game gets
                    pasted into. Desktop has had both; here there was only the
                    download. */}
                {showMobilePgnAction ? (
                  <button
                    className={`mobile-action-menu-btn ${copiedToast ? 'mobile-action-menu-btn-active' : ''} ${exportFailureKey === 'copy-pgn' ? 'mobile-action-menu-btn-warn' : ''}`}
                    type="button"
                    onClick={handleCopyPgn}
                    disabled={!canExportCurrentLine}
                    role="menuitem"
                    title={exportFailureKey === 'copy-pgn' ? 'Could not copy PGN to clipboard' : copiedToast ? 'PGN copied' : 'Copy PGN to clipboard'}
                    aria-label={exportFailureKey === 'copy-pgn' ? 'PGN copy failed' : copiedToast ? 'PGN copied' : 'Copy PGN to clipboard'}
                    data-testid="mobile-copy-pgn-btn"
                  >
                    {exportFailureKey === 'copy-pgn' ? <IconX /> : copiedToast ? <IconCheck /> : <IconCopy />}
                    <span>{exportFailureKey === 'copy-pgn' ? 'Copy failed' : copiedToast ? 'Copied' : 'Copy PGN'}</span>
                  </button>
                ) : null}
                {showMobilePgnAction ? (
                  <button
                    className={`mobile-action-menu-btn ${downloadedPgnToast ? 'mobile-action-menu-btn-active' : ''} ${exportFailureKey === 'download-pgn' ? 'mobile-action-menu-btn-warn' : ''}`}
                    type="button"
                    onClick={handleDownloadPgn}
                    disabled={!canExportCurrentLine}
                    role="menuitem"
                    title={exportFailureKey === 'download-pgn' ? 'PGN export failed' : downloadedPgnToast ? 'PGN downloaded' : 'Download PGN'}
                    aria-label={exportFailureKey === 'download-pgn' ? 'PGN export failed' : downloadedPgnToast ? 'PGN exported' : 'Export PGN'}
                    data-testid="mobile-download-pgn-btn"
                  >
                    {exportFailureKey === 'download-pgn' ? <IconX /> : downloadedPgnToast ? <IconCheck /> : <IconDownload />}
                    <span>{exportFailureKey === 'download-pgn' ? 'Export failed' : downloadedPgnToast ? 'Exported' : 'Export PGN'}</span>
                  </button>
                ) : null}
                {showMobileShareAction ? (
                  <button
                    className={`mobile-action-menu-btn ${copiedShareToast ? 'mobile-action-menu-btn-active' : ''} ${exportFailureKey === 'copy-share' ? 'mobile-action-menu-btn-warn' : ''}`}
                    type="button"
                    onClick={handleCopyShareLink}
                    disabled={!canShareCurrentPosition}
                    role="menuitem"
                    title={exportFailureKey === 'copy-share' ? 'Copy link failed' : copiedShareToast ? 'Link copied' : 'Copy share link'}
                    aria-label={exportFailureKey === 'copy-share' ? 'Share link copy failed' : copiedShareToast ? 'Share link copied' : 'Copy share link'}
                    data-testid="mobile-copy-share-link-btn"
                  >
                    {exportFailureKey === 'copy-share' ? <IconX /> : copiedShareToast ? <IconCheck /> : <IconLink />}
                    <span>{exportFailureKey === 'copy-share' ? 'Copy failed' : copiedShareToast ? 'Copied link' : 'Copy link'}</span>
                  </button>
                ) : null}
                <button
                  className={`mobile-action-menu-btn ${copiedFenToast ? 'mobile-action-menu-btn-active' : ''} ${exportFailureKey === 'copy-fen' ? 'mobile-action-menu-btn-warn' : ''}`}
                  type="button"
                  onClick={handleCopyFen}
                  role="menuitem"
                  title={exportFailureKey === 'copy-fen' ? 'Copy FEN failed' : copiedFenToast ? 'FEN copied' : 'Copy FEN'}
                  aria-label={exportFailureKey === 'copy-fen' ? 'FEN copy failed' : copiedFenToast ? 'FEN copied' : 'Copy current FEN'}
                  data-testid="mobile-copy-fen-btn"
                >
                  {exportFailureKey === 'copy-fen' ? <IconX /> : copiedFenToast ? <IconCheck /> : <IconCopy />}
                  <span>{exportFailureKey === 'copy-fen' ? 'Copy failed' : copiedFenToast ? 'Copied FEN' : 'Copy FEN'}</span>
                </button>
                <button
                  className={`mobile-action-menu-btn ${showArrows ? 'mobile-action-menu-btn-active' : ''}`}
                  type="button"
                  onClick={() => setShowArrows(v => !v)}
                  role="menuitem"
                  title="Toggle arrows and markers"
                  // No aria-label: the visible text already names the action and
                  // carries the state. "Toggle board arrows and markers" replaced
                  // both, so this item announced no state at all -- unlike the
                  // toolbar button, which is icon-led and says so via aria-pressed.
                >
                  <IconArrow />
                  <span>{showArrows ? 'Hide arrows' : 'Show arrows'}</span>
                </button>
                <button
                  className="mobile-action-menu-btn"
                  type="button"
                  onClick={() => setOrientation(o => o === 'red' ? 'black' : 'red')}
                  role="menuitem"
                  title="Flip board"
                  aria-label="Flip board"
                >
                  <IconFlip />
                  <span>Flip board</span>
                </button>
                {/* No shortcut in the label here: this menu only exists on
                    touch, where there is no modifier key to press. */}
                <button
                  className="mobile-action-menu-btn"
                  type="button"
                  onClick={() => {
                    setShowMobileBoardActionMenu(false);
                    setShowCommandPalette(true);
                  }}
                  role="menuitem"
                  title="Commands"
                  aria-label="Open command palette"
                  data-testid="mobile-command-palette-btn"
                >
                  <IconSearch />
                  <span>Commands</span>
                </button>
              </div>
            </>
          ) : null}
          <div className="mobile-board-center">
            <div className="board-workspace">
              <div className="board-wrap">
                {/* Absolutely positioned against .board-wrap, which the
                    aspect-ratio sizing keeps exactly board-shaped, so the bar
                    is board-height without joining the grid that took such
                    care to derive that height. */}
                {showEvalBar ? (
                  <EvalBar
                    evalScore={displayEvalScore}
                    evalText={currentEvalText}
                    orientation={orientation}
                  />
                ) : null}
                {aiPlayActive && (
                  <div
                    className="board-ai-status"
                    role={boardAiStatusText ? 'status' : undefined}
                    aria-live={boardAiStatusText ? 'polite' : undefined}
                    aria-label={boardAiStatusText || undefined}
                  >
                    {/* Without a status to announce, this was just an unlabelled bot
                        icon hovering over the board. Keep the live region mounted
                        so announcements stay stable, but show nothing until there
                        is something to say. */}
                    {boardAiStatusText ? <IconBot /> : null}
                    {aiMoveError ? (
                      <span className="ai-status-paused"><IconPause /> {aiMoveError}</span>
                    ) : paused ? (
                      <span className="ai-status-paused"><IconPause /> AI Paused</span>
                    ) : boardAiStatusText === 'AI thinking' ? (
                      <span className="ai-status-thinking">
                        <span className="thinking-dots">
                          <span /><span /><span />
                        </span>
                        Thinking…
                      </span>
                    ) : boardAiStatusText ? (
                      <span className="ai-status-waiting">{boardAiStatusText}</span>
                    ) : null}
                  </div>
                )}
                <Board
                  board={board}
                  selected={selected}
                  validTargets={validTargets}
                  onSquareClick={handleSquareClick}
                  // Dragging is offered for exactly the pieces a click could
                  // move: the side to play, and only while the board is taking
                  // moves at all. `handleSquareClick` already refuses the other
                  // cases, but refusing them after the piece has been dragged
                  // across the board and dropped is not the same as never
                  // offering the grab cursor.
                  draggableSide={!gameResult && !isAiTurn ? sideToMove : null}
                  orientation={orientation}
                  highlights={showArrows ? userHighlights : []}
                  onToggleHighlight={showArrows ? handleToggleHighlight : undefined}
                  onAddArrow={showArrows ? handleAddUserArrow : undefined}
                  arrows={boardArrows}
                  inCheck={inCheck}
                />
              </div>

              {drill && drillCopy && drillVerdictKind ? (
                <div
                  className={`drill-banner drill-banner-${drillVerdictKind}`}
                  role="status"
                  data-testid="mistake-drill"
                  data-verdict={drillVerdictKind}
                >
                  <div className="drill-banner-copy">
                    <span className="drill-banner-kicker">
                      Learn from mistakes · {Math.min(drill.index + 1, drill.moments.length)} / {drill.moments.length}
                    </span>
                    <strong>{drillCopy.headline}</strong>
                    {drillCopy.detail ? <em>{drillCopy.detail}</em> : null}
                  </div>
                  <div className="drill-banner-actions">
                    {drillVerdictKind === 'finished' ? (
                      <button type="button" className="chip-btn chip-btn-primary" onClick={stopMistakeDrill} data-testid="drill-close-btn">Close</button>
                    ) : (
                      <>
                        {(drillVerdictKind === 'wrong' || drillVerdictKind === 'repeat') ? (
                          <button type="button" className="chip-btn chip-btn-primary" onClick={retryDrillMoment} data-testid="drill-retry-btn">Try again</button>
                        ) : null}
                        {(drillVerdictKind === 'asking' || drillVerdictKind === 'pending' || drillVerdictKind === 'wrong' || drillVerdictKind === 'repeat') ? (
                          <button type="button" className="chip-btn" onClick={showDrillAnswer} data-testid="drill-show-btn">Show answer</button>
                        ) : null}
                        <button
                          type="button"
                          className={`chip-btn ${drillVerdictKind === 'best' || drillVerdictKind === 'good' || drillVerdictKind === 'shown' ? 'chip-btn-primary' : ''}`}
                          onClick={nextDrillMoment}
                          data-testid="drill-next-btn"
                        >
                          {drillVerdictKind === 'asking' || drillVerdictKind === 'pending' ? 'Skip' : drillIsLast ? 'Finish' : 'Next'}
                        </button>
                        <button type="button" className="chip-btn" onClick={stopMistakeDrill} aria-label="Stop learning from mistakes" data-testid="drill-stop-btn">Stop</button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="position-dock">
                <div className="position-stat position-stat-turn">
                  <span>Turn</span>
                  <strong>{sideToMoveLabel}</strong>
                  {/* On a phone the floating board pill would land on top of the
                      mobile header, so the AI's state rides in this line instead
                      of the static mode label it would otherwise repeat. */}
                  <em data-live-state={isMobile && aiPlayActive && !inCheck && boardAiStatusText ? 'ai' : undefined}>
                    {inCheck ? 'Check' : (isMobile && aiPlayActive && boardAiStatusText) || currentModeMeta.shortLabel}
                  </em>
                </div>
                {/* A repeated position is not a draw in xiangqi, and which it is
                    depends on what the repeating moves were doing. The board
                    said nothing at all about it before, so a player shuffling
                    into a perpetual check had no way to know the rules were
                    about to decide the game against them. */}
                {visibleRepetition ? (
                  <div
                    className={`position-stat position-stat-repetition${visibleRepetition.mustVary ? ' position-stat-repetition-binding' : ''}`}
                    role="status"
                    data-testid="repetition-notice"
                    data-verdict={visibleRepetition.verdict}
                  >
                    <span>Repetition</span>
                    <strong>{formatRepetitionHeadline(visibleRepetition)}</strong>
                    <em title={formatRepetitionRule(visibleRepetition)}>
                      {formatRepetitionRule(visibleRepetition)}
                    </em>
                    {cloudRuleText ? (
                      <em className="position-stat-cloud-rule" title={cloudRuleText} data-testid="repetition-cloud-rule">
                        {cloudRuleText}
                      </em>
                    ) : null}
                  </div>
                ) : null}
                {/* The other rule the app will not adjudicate but the engine
                    does. Pikafish draws the game at sixty capture-free moves
                    and discounts its evaluation all the way there, so without
                    this a ground-out ending simply reads flatter than it is
                    with nothing on screen to say why. */}
                {captureFree ? (
                  <div
                    className={`position-stat position-stat-repetition${captureFree.reached ? ' position-stat-repetition-binding' : ''}`}
                    role="status"
                    data-testid="capture-free-notice"
                    data-reached={captureFree.reached ? 'true' : 'false'}
                  >
                    <span>60-move rule</span>
                    <strong>{formatCaptureFreeHeadline(captureFree)}</strong>
                    <em title={formatCaptureFreeRule(captureFree)}>
                      {formatCaptureFreeRule(captureFree)}
                    </em>
                  </div>
                ) : null}
                <div className="position-stat position-stat-selection">
                  <span>{selectedPiece ? selectedSquareText : 'Selection'}</span>
                  <strong>{selectedPieceText}</strong>
                  <em
                    className={moveRuleHint ? 'position-warning' : undefined}
                    title={moveRuleHint ?? legalMoveText}
                  >
                    {moveRuleHint ?? legalMoveText}
                  </em>
                </div>
                <div className="position-stat position-stat-material">
                  <span>Material</span>
                  <strong>{materialText}</strong>
                  <em>Red {formatMaterialValue(materialSummary.redMaterialTenths)} · Black {formatMaterialValue(materialSummary.blackMaterialTenths)}</em>
                </div>
                <div className="capture-trays">
                  <div className="capture-tray">
                    <span>Red took</span>
                    <div className="captured-pieces" role="group" aria-label={formatCapturedTrayLabel('Red', materialSummary.redCaptured)}>
                      {materialSummary.redCaptured.length > 0 ? materialSummary.redCaptured.map(({ piece, count }) => (
                        <span key={piece} className="captured-piece captured-piece-black" title={PIECE_NAMES[piece]}>
                          {PIECE_SYMBOLS[piece]}{count > 1 ? <sup>{count}</sup> : null}
                        </span>
                      )) : <em>None</em>}
                    </div>
                  </div>
                  <div className="capture-tray">
                    <span>Black took</span>
                    <div className="captured-pieces" role="group" aria-label={formatCapturedTrayLabel('Black', materialSummary.blackCaptured)}>
                      {materialSummary.blackCaptured.length > 0 ? materialSummary.blackCaptured.map(({ piece, count }) => (
                        <span key={piece} className="captured-piece captured-piece-red" title={PIECE_NAMES[piece]}>
                          {PIECE_SYMBOLS[piece]}{count > 1 ? <sup>{count}</sup> : null}
                        </span>
                      )) : <em>None</em>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="sr-only" role="status" aria-live="polite">{boardAnnouncement}</div>
            </div>
          </div>
          {isMobile && (
            <div className="mobile-board-nav">
              <button className="mobile-nav-btn" type="button" onClick={goToFirstMove} disabled={!canGoBack} aria-label="Go to first position"><IconSkipBack /></button>
              <button className="mobile-nav-btn" type="button" onClick={goToPreviousMove} disabled={!canGoBack} aria-label="Go to previous move"><IconChevronLeft /></button>
              <span className="mobile-nav-label" aria-label={timelineA11yText}>
                {timelineCompactText}
              </span>
              <button className="mobile-nav-btn" type="button" onClick={goToNextMove} disabled={!canGoForward} aria-label="Go to next move"><IconChevronRight /></button>
              <button className="mobile-nav-btn" type="button" onClick={goToLatestMove} disabled={!canGoForward} aria-label="Go to latest move"><IconSkipForward /></button>
            </div>
          )}
        </section>

        {/* ── Mobile analysis sub-tab strip (analysis view only) ── */}
        {isMobile && (
          <div className="mobile-analysis-tabs" role="tablist" aria-label="Mobile analysis panels" onKeyDown={handleTablistKeyDown}>
            <button
              type="button"
              role="tab"
              id="mobile-analysis-tab-moves"
              className={`mobile-tab-btn ${mobileAnalysisTab === 'moves' ? 'active' : ''}`}
              onClick={() => {
                setAnalysisTab('tree');
                setMobileAnalysisTab('moves');
              }}
              aria-selected={mobileAnalysisTab === 'moves'}
              aria-controls="right-analysis-content"
              data-testid="mobile-analysis-tab-moves"
            >
              <IconTree /> Moves
            </button>
            <button
              type="button"
              role="tab"
              id="mobile-analysis-tab-review"
              className={`mobile-tab-btn ${mobileAnalysisTab === 'review' ? 'active' : ''}`}
              onClick={() => {
                setAnalysisTab('review');
                setMobileAnalysisTab('review');
              }}
              aria-selected={mobileAnalysisTab === 'review'}
              aria-controls="right-analysis-content"
              data-testid="mobile-analysis-tab-review"
            >
              <IconBarChart /> Review
            </button>
            {engineEnabled ? (
              <button
                type="button"
                role="tab"
                id="mobile-analysis-tab-engine"
                className={`mobile-tab-btn ${mobileAnalysisTab === 'engine' ? 'active' : ''}`}
                onClick={() => {
                  setAnalysisTab('engine');
                  setMobileAnalysisTab('engine');
                }}
                aria-selected={mobileAnalysisTab === 'engine'}
                aria-controls="right-analysis-content"
                data-testid="mobile-analysis-tab-engine"
              >
                <IconBot /> Engine
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              id="mobile-analysis-tab-graph"
              className={`mobile-tab-btn ${mobileAnalysisTab === 'graph' ? 'active' : ''}`}
              onClick={() => {
                setLeftPanelTab('graph');
                setMobileAnalysisTab('graph');
              }}
              aria-selected={mobileAnalysisTab === 'graph'}
              aria-controls="left-panel-content"
              data-testid="mobile-analysis-tab-graph"
            >
              <IconBarChart /> Graph
            </button>
            <button
              type="button"
              role="tab"
              id="mobile-analysis-tab-library"
              className={`mobile-tab-btn ${mobileAnalysisTab === 'library' ? 'active' : ''}`}
              onClick={() => {
                setLeftPanelTab('library');
                setMobileAnalysisTab('library');
              }}
              aria-selected={mobileAnalysisTab === 'library'}
              aria-controls="left-panel-content"
              data-testid="mobile-analysis-tab-library"
            >
              <IconLibrary /> Library
            </button>
          </div>
        )}

        {/* ── Right panel: Move tree / Engine ── */}
        <aside className="panel right" aria-labelledby="right-panel-heading">
          <div
            className="resize-handle resize-handle-left"
            role="separator"
            tabIndex={0}
            onPointerDown={startRightResize}
            onClick={() => { if (rightWidth === 0) setRightWidth(DEFAULT_RIGHT_PANEL_WIDTH); }}
            onKeyDown={handleRightResizeKeyDown}
            aria-label={rightPanelOpen ? `Resize right analysis panel, ${Math.round(rightWidth)} pixels wide` : 'Expand right analysis panel'}
            aria-orientation="vertical"
            aria-controls="right-analysis-content"
            aria-valuemin={0}
            aria-valuemax={PANEL_MAX_WIDTH}
            aria-valuenow={Math.round(rightWidth)}
            title={rightPanelOpen ? 'Drag to resize. Press arrow keys to adjust, Home to collapse, End to restore.' : 'Click, press Enter, or press End to expand the right panel.'}
            data-testid="right-panel-resize-handle"
          >
            <span className="resize-pill" />
          </div>
          <div className="panel-inner" style={{ opacity: (!isMobile && rightWidth === 0) ? 0 : 1 }}>
            <header className="panel-header panel-header-tabs">
              <h2 id="right-panel-heading">Analysis</h2>
              <div className="analysis-tab-strip" role="tablist" aria-label="Analysis panels" onKeyDown={handleTablistKeyDown}>
                <button
                  type="button"
                  role="tab"
                  id="analysis-tab-tree-tab"
                  className={`analysis-tab-btn ${analysisTab === 'tree' ? 'active' : ''}`}
                  onClick={() => {
                    setAnalysisTab('tree');
                    setMobileAnalysisTab('moves');
                  }}
                  title="Game tree"
                  aria-label="Open game tree"
                  aria-selected={analysisTab === 'tree'}
                  aria-controls="right-analysis-content"
                  data-testid="analysis-tab-tree"
                >
                  <IconTree style={{ marginRight: '0.3rem' }} />Tree
                </button>
                <button
                  type="button"
                  role="tab"
                  id="analysis-tab-review-tab"
                  className={`analysis-tab-btn ${analysisTab === 'review' ? 'active' : ''}`}
                  onClick={() => {
                    setAnalysisTab('review');
                    setMobileAnalysisTab('review');
                  }}
                  aria-selected={analysisTab === 'review'}
                  aria-controls="right-analysis-content"
                  data-testid="analysis-tab-review"
                >
                  <IconBarChart style={{ marginRight: '0.3rem' }} />Review
                </button>
                {engineEnabled ? (
                  <button
                    type="button"
                    role="tab"
                    id="analysis-tab-engine-tab"
                    className={`analysis-tab-btn ${analysisTab === 'engine' ? 'active' : ''}`}
                    onClick={() => {
                      setAnalysisTab('engine');
                      setMobileAnalysisTab('engine');
                    }}
                    aria-selected={analysisTab === 'engine'}
                    aria-controls="right-analysis-content"
                    data-testid="analysis-tab-engine"
                  >
                    <IconBot style={{ marginRight: '0.3rem' }} />Engine
                  </button>
                ) : null}
              </div>
            </header>
            <div
              className="panel-content"
              role="tabpanel"
              id="right-analysis-content"
              aria-labelledby={`analysis-tab-${analysisTab}-tab`}
            >
              {analysisTab === 'tree' ? (
                <>
                  {/* One tab stop with arrow keys inside it, the way the board
                      works and for the same reason -- except this list grows
                      with the game. Measured on a 30-ply game before the
                      change: 91 tab stops on the page, 83 of them before the
                      bottom command bar, half of those breadcrumb chips. A real
                      100-ply game put a hundred of them between the toolbar and
                      "Save". */}
                  <div
                    className="tree-breadcrumb"
                    ref={treeBreadcrumbRef}
                    role="toolbar"
                    aria-label="Current line, one chip per move"
                    aria-orientation="horizontal"
                    aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                  >
                    {breadcrumbNodeIds.map((nodeId, index) => {
                      const label = nodeLabel(nodeId, rootNodeId, treeNodes, notationStyle, rootFen);
                      const title = nodeTitle(nodeId, rootNodeId, treeNodes);
                      return (
                        <button
                          key={nodeId}
                          type="button"
                          className={`tree-breadcrumb-chip ${nodeId === currentNodeId ? 'tree-breadcrumb-chip-active' : ''}`}
                          onClick={() => jumpToNode(nodeId)}
                          onFocus={() => setRovingBreadcrumbIndex(index)}
                          onKeyDown={(event) => handleBreadcrumbKeyDown(event, index)}
                          tabIndex={index === breadcrumbTabStopIndex ? 0 : -1}
                          data-breadcrumb-index={index}
                          title={title}
                          aria-label={title}
                          aria-current={nodeId === currentNodeId ? 'true' : undefined}
                        >
                          {label}
                          {index < breadcrumbNodeIds.length - 1 ? <span className="tree-breadcrumb-sep">/</span> : null}
                        </button>
                      );
                    })}
                  </div>
                  <MoveListTree
                    treeNodes={treeNodes}
                    rootNodeId={rootNodeId}
                    rootFen={rootFen}
                    currentNodeId={currentNodeId}
                    currentMoveIndex={currentMoveIndex}
                    activeLineNodeIds={activeLineNodeIds}
                    notationStyle={notationStyle}
                    onNavigateNode={jumpToNode}
                    onDeleteNode={handleDeleteNode}
                  />
                  {/* The thinking, beside the moves. Everything attached to a
                      move here was written by the engine -- an evaluation, a
                      best move, a review note it overwrites on every re-run --
                      so a study built on this board carried the line and none of
                      the reasoning for it. The note is the reader's, kept in a
                      separate field for exactly that reason. */}
                  <div className="move-comment">
                    <label className="move-comment-label" htmlFor="move-comment-input">
                      <span>Note</span>
                      <em>{moveCommentTarget ?? 'Step to a move to write one'}</em>
                    </label>
                    <textarea
                      id="move-comment-input"
                      className="move-comment-input"
                      data-testid="move-comment-input"
                      value={moveCommentDraft}
                      onChange={(event) => handleMoveCommentChange(event.target.value)}
                      onBlur={commitMoveComment}
                      disabled={!moveCommentTarget}
                      maxLength={MAX_MOVE_COMMENT_LENGTH}
                      rows={2}
                      spellCheck
                      placeholder={moveCommentTarget ? 'Why this move' : ''}
                      aria-label={moveCommentTarget ? `Note on ${moveCommentTarget}` : 'Note on the current move'}
                    />
                  </div>
                  {canCopyRecord ? (
                    <div className="tree-actions">
                      {/* The record as a person reads it, in the notation the
                          list above is written in. Copy PGN in the bottom bar
                          is the same moves for another program. */}
                      <button
                        type="button"
                        className={`chip-btn ${exportFailureKey === 'copy-record' ? 'chip-btn-warning' : ''}`}
                        onClick={handleCopyRecord}
                        title={exportFailureKey === 'copy-record' ? 'Could not copy the record' : `Copy the moves up to here as a numbered ${NOTATION_STYLE_LABELS[notationStyle]} record`}
                        aria-label={exportFailureKey === 'copy-record' ? 'Record copy failed' : copiedRecordToast ? 'Record copied' : `Copy record in ${NOTATION_STYLE_LABELS[notationStyle]}`}
                        data-testid="copy-record-btn"
                      >
                        {exportFailureKey === 'copy-record' ? <><IconX /> Copy failed</> : copiedRecordToast ? <><IconCheck /> Copied</> : <><IconCopy /> Copy record</>}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : analysisTab === 'review' ? (
                <ReviewPanel
                  status={reviewStatus}
                  progress={reviewProgress}
                  summary={reviewSummary}
                  narrativeTags={reviewNarrativeTags}
                  phaseAccuracy={reviewPhaseAccuracy}
                  phaseByMoveIndex={reviewPhaseByMoveIndex}
                  currentNodeId={currentNodeId}
                  canStart={canStartReview}
                  startLabel={reviewStartLabel}
                  startTitle={reviewStartTitle}
                  onStart={startGameReview}
                  onCancel={handleCancelReview}
                  onClear={clearCompletedReview}
                  onNavigateNode={jumpToNode}
                  onPlayBestMove={handlePlayReviewBestMove}
                  onPracticeMoment={handlePracticeReviewMoment}
                  onStartDrill={startMistakeDrill}
                  drillAvailable={canStartDrill}
                  formatMoveText={formatReviewMoveText}
                  formatLineText={formatReviewLineText}
                />
              ) : (
                <>
                  <div className="engine-dashboard" role="group" aria-label="Engine diagnostics">
                    <div className="engine-stat" title={engineCoreDetail} aria-label={engineCoreDetail}>
                      <span>Core</span>
                      <strong>{engineVariant}</strong>
                      <em>{engineBootConfig.threads}T · {engineBootConfig.hashMB}MB</em>
                    </div>
                    <div className="engine-stat">
                      <span>Profile</span>
                      <strong>{analysisEngineMode}</strong>
                      <em>{engineBootConfig.tier}{engineBootConfig.saferBoot ? ' · safe boot' : ''}</em>
                    </div>
                    <div
                      className={`engine-stat${analysisIsStalled ? ' engine-stat-stalled' : ''}`}
                      title={analysisIsStalled ? describeAnalysisActivity(analysisActivity) : engineSearchDetail}
                      aria-label={analysisIsStalled ? describeAnalysisActivity(analysisActivity) : engineSearchDetail}
                    >
                      <span>Search</span>
                      {/* Depth from a search that has been stopped is stale, and
                          reading it beside a board that is not moving is what
                          made a backgrounded tab look broken. */}
                      <strong>{analysisIsStalled
                        ? formatAnalysisActivity(analysisActivity)
                        : formatEngineDepthLabel(searchStats, liveAnalysisPolicy.primary.depth, isSearchQueued, isSearching, isReady)}</strong>
                      <em>{analysisIsStalled
                        ? 'tab in background'
                        : formatEngineTelemetry(searchStats, liveAnalysisPolicy.primary.depth, liveAnalysisPolicy.primary.moveTimeMs, isSearchQueued, isSearching)}</em>
                    </div>
                    <div className="engine-stat">
                      <span>Detail</span>
                      <strong>{`MultiPV ${analysisMultiPv}`}</strong>
                      <em>{analysisWdlEnabled ? 'WDL on' : 'WDL off'}</em>
                    </div>
                  </div>
                  <div className="engine-pv-controls" role="group" aria-label="Engine principal variation lines">
                    <span>PV Lines</span>
                    <div className="engine-pv-buttons">
                      {PV_LINE_OPTIONS.map((count) => (
                        <button
                          key={count}
                          type="button"
                          className={`engine-pv-btn ${enginePvLineCount === count ? 'engine-pv-btn-active' : ''}`}
                          onClick={() => setEnginePvLineCount(count)}
                          aria-pressed={enginePvLineCount === count}
                          aria-label={PV_LINE_CONTROL_COPY[count].ariaLabel}
                          title={PV_LINE_CONTROL_COPY[count].title}
                          data-testid={`engine-pv-lines-${count}`}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="engine-pv-controls engine-runtime-controls" role="group" aria-label="Engine runtime controls">
                    <span>Runtime</span>
                    <div className="engine-runtime-buttons">
                      {/* The one thing live analysis cannot do: stop on this
                          position and go as deep as the machine can. Bounded,
                          so it settles on its own; stoppable, so a long wait is
                          never forced on anyone. */}
                      <button
                        type="button"
                        className={`engine-cache-btn ${deepDiveActive ? 'engine-pv-btn-active' : ''}`}
                        onClick={deepDiveActive ? stopSearch : runDeepDive}
                        disabled={!deepDiveActive && !canDeepDive}
                        title={deepDiveActive
                          ? 'Stop the deep search and keep what it has found (D)'
                          : deepSearchMode === 'infinite'
                            ? 'Search this position until stopped, including while this tab is in the background (D)'
                            : `Search this position to depth ${deepDiveBudget.depth} for up to ${Math.round(deepDiveBudget.moveTimeMs / 1000)}s, and keep going if this tab goes to the background (D)`}
                        aria-keyshortcuts="D"
                        aria-label={deepDiveActive
                          ? 'Stop the deep search'
                          : `Deep search this position, ${deepSearchLimitText}`}
                        data-testid="deep-dive-btn"
                      >
                        {deepDiveActive
                          ? <><IconPause aria-hidden="true" focusable="false" /> Stop</>
                          : <><IconSearch aria-hidden="true" focusable="false" /> Go Deep</>}
                      </button>
                      {/* The other way a deep search can end: never, until the
                          reader says so. Pressed, Go Deep sends `go infinite`
                          and the depth climbs until Stop or a new position.
                          A toggle beside the button rather than a setting,
                          because it is decided per position, not per session. */}
                      <button
                        type="button"
                        className={`engine-cache-btn engine-infinite-btn ${deepSearchMode === 'infinite' ? 'engine-pv-btn-active' : ''}`}
                        onClick={() => setDeepSearchMode((mode) => (mode === 'infinite' ? 'bounded' : 'infinite'))}
                        aria-pressed={deepSearchMode === 'infinite'}
                        title={deepSearchMode === 'infinite'
                          ? `Deep search runs until stopped. Press to limit it to ${Math.round(deepDiveBudget.moveTimeMs / 1000)}s.`
                          : `Deep search stops after ${Math.round(deepDiveBudget.moveTimeMs / 1000)}s. Press to let it run until stopped.`}
                        aria-label="Let a deep search run until stopped"
                        data-testid="deep-infinite-toggle"
                      >
                        ∞
                      </button>
                      {/* Give the opponent the move and read the reply. The
                          button says why it is unavailable rather than sitting
                          disabled with no account of itself -- being in check is
                          the common reason and it is not obvious that it is one. */}
                      <button
                        type="button"
                        className={`engine-cache-btn ${threatActive ? 'engine-pv-btn-active' : ''}`}
                        onClick={threatActive ? stopThreat : runThreatSearch}
                        disabled={!threatActive && !canShowThreat}
                        title={threatActive
                          ? 'Back to analysing the position as it stands (X)'
                          : !threatFen
                            ? `${sideToMoveLabel} is in check, so there is no position to pass from`
                            : `Let ${sideToMove === 'w' ? 'Black' : 'Red'} move first and show what they are threatening (X)`}
                        aria-keyshortcuts="X"
                        aria-label={threatActive
                          ? 'Stop showing the threat and analyse the position as it stands'
                          : 'Show the threat: let the opponent move first'}
                        data-testid="show-threat-btn"
                      >
                        <IconTarget aria-hidden="true" focusable="false" /> {threatActive ? 'Threat on' : 'Threat'}
                      </button>
                      <button
                        type="button"
                        className="engine-cache-btn"
                        onClick={handleRestartEngine}
                        disabled={!engineRequired}
                        title="Restart the engine worker"
                        aria-label="Restart engine"
                        data-testid="restart-engine-btn"
                      >
                        <IconRefresh aria-hidden="true" focusable="false" /> Restart
                      </button>
                      <button
                        type="button"
                        className={`engine-cache-btn ${engineHashFeedback ? 'engine-pv-btn-active' : ''}`}
                        onClick={handleClearEngineHash}
                        disabled={!isReady}
                        title={engineHashFeedback === 'queued' ? 'Engine hash clear is queued after the current search' : isSearching || isSearchQueued ? 'Queue a transposition-table clear after the current search' : 'Clear the engine hash table'}
                        aria-label={engineHashFeedback === 'queued' ? 'Engine hash clear queued' : engineHashFeedback === 'cleared' ? 'Engine hash cleared' : 'Clear engine hash table'}
                        data-testid="clear-engine-hash-btn"
                      >
                        {engineHashFeedback === 'queued' ? <><IconRefresh aria-hidden="true" focusable="false" /> Queued</> : engineHashFeedback === 'cleared' ? <><IconCheck aria-hidden="true" focusable="false" /> Cleared</> : 'Clear Hash'}
                      </button>
                    </div>
                  </div>
                  {/* The threat replaces the candidate list rather than sitting
                      beside it, because the two are evaluations of different
                      positions and a reader comparing them side by side would be
                      comparing nothing. The card says whose move it is showing. */}
                  {threatActive ? (
                    <div className="pv-lines-container">
                      <div className="pv-line premium-card threat-card" data-testid="threat-card">
                        <div className="pv-line-heading">
                          <span className="pv-line-rank">
                            If {sideToMove === 'w' ? 'Black' : 'Red'} moved now
                          </span>
                          {/* Red POV like every other evaluation here, and said
                              so, because this one is a score for a position the
                              reader is not looking at -- an unlabelled number
                              beside "If Black moved now" reads as Black's. The
                              side passed to the formatter is the *opponent*,
                              since that is who is to move in the searched
                              position. */}
                          {threatPv ? (
                            <span
                              className="pv-line-standing"
                              title={`Red POV score ${formatRedPovEngineScore(threatPv, sideToMove === 'w' ? 'b' : 'w')}`}
                            >
                              {formatRedPovEngineScore(threatPv, sideToMove === 'w' ? 'b' : 'w')} Red POV
                            </span>
                          ) : null}
                        </div>
                        <div className="pv-line-moves" data-testid="threat-line">
                          {threatPv
                            ? formatLineInStyle(
                                parseFenBoard((threatFen ?? currentFen).split(' ')[0]),
                                threatPv.moves,
                                notationStyle,
                                6,
                              )
                            : 'Searching…'}
                        </div>
                        <div className="pv-empty">
                          A passed move: this position is not one the game can reach.
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="pv-lines-container">
                    {currentAnalysisPvLines.length === 0 ? (
                      <div className="pv-empty">No PV available yet.</div>
                    ) : currentAnalysisPvLines.map((pv, i) => {
                      const bestRawScore = currentAnalysisPvLines[0]?.score ?? pv.score;
                      const lineStanding = describePvStanding(bestRawScore, pv.score, i);
                      const normalizedScore = normalizeEvalForSide(pv.score, sideToMove);
                      // One decimal, like every other evaluation in the app.
                      // At zero this badge could not tell a half-pawn from
                      // level -- everything between -0.99 and +0.99 rendered as
                      // "+0" or "-0", which is most of an opening and most of a
                      // middlegame, and "-0" reads as a typo rather than as a
                      // number. The screen-reader label had already been built
                      // at one decimal all along, so the informative form
                      // existed and was simply not the one on screen.
                      const pvScoreText = formatRedPovEngineScore(pv, sideToMove, 1);
                      const pvScoreLabel = `Red POV score ${pvScoreText}`;
                      const pvScoreClass = normalizedScore > 0 ? 'positive' : normalizedScore < 0 ? 'negative' : '';
                      const firstMove = pv.moves[0];
                      const depthLabel = pv.depth ? `depth ${pv.depth}` : 'depth pending';
                      const pvLineText = pv.moves.length ? formatLineInStyle(board, pv.moves, notationStyle, 7) : 'No moves yet';
                      const pvLineLabel = pv.moves.length ? `moves ${pvLineText}` : 'no moves yet';
                      const firstMoveText = firstMove ? formatLineInStyle(board, [firstMove], notationStyle, 1) : '';
                      // The clipboard gets the raw moves whatever the reader is
                      // looking at, so the tooltip shows those rather than
                      // promising "raw UCI" beside a line written in WXF.
                      const pvRawLine = pv.moves.join(' ');
                      const lineActionContext = `engine line ${i + 1}, ${depthLabel}, ${pvLineLabel}`;
                      // Red's chances, like every other number on this card:
                      // the engine's wdl is for the side to move.
                      const lineWdl = pv.wdl ? normalizeWdlForSide(pv.wdl, sideToMove) : null;
                      const lineWdlText = lineWdl
                        ? `Red ${Math.round(lineWdl.win / 10)}% · draw ${Math.round(lineWdl.draw / 10)}% · Black ${Math.round(lineWdl.loss / 10)}%`
                        : null;
                      const playPvLabel = firstMove
                        ? `Play ${firstMoveText} from engine line ${i + 1}`
                        : `Play engine line ${i + 1} first move unavailable`;
                      const copyPvLabel = exportFailureKey === `copy-pv-${i}`
                        ? `Engine line ${i + 1} copy failed: ${pvLineText}`
                        : copiedPvIndex === i
                          ? `Engine line ${i + 1} copied: ${pvLineText}`
                          : `Copy engine line ${i + 1}: ${pvLineText}`;
                      return (
                        <div
                          key={i}
                          className={`pv-line premium-card ${spotlightPvIndex === i ? 'pv-line-spotlight' : ''}`}
                          role="group"
                          tabIndex={0}
                          aria-label={`Engine line ${i + 1}, ${lineStanding}, ${pvScoreLabel}, ${depthLabel}${lineWdlText ? `, ${lineWdlText}` : ''}, ${pvLineLabel}`}
                          onMouseEnter={() => setSpotlightPvIndex(i)}
                          onMouseLeave={() => setSpotlightPvIndex(null)}
                          onFocus={() => setSpotlightPvIndex(i)}
                          onBlur={(event) => {
                            const nextFocus = event.relatedTarget;
                            if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) return;
                            setSpotlightPvIndex(null);
                          }}
                          data-testid={`engine-pv-line-${i}`}
                          data-spotlight={spotlightPvIndex === i ? 'true' : undefined}
                        >
                          <div
                            className={['pv-score', pvScoreClass].filter(Boolean).join(' ')}
                            aria-label={pvScoreLabel}
                            title={pvScoreLabel}
                            data-testid={`engine-pv-score-${i}`}
                          >
                            <strong>{pvScoreText}</strong>
                            <span>Red POV</span>
                          </div>
                          <div className="pv-moves">
                            <div className="pv-line-heading">
                              <span className="pv-line-rank">Line {i + 1}</span>
                              <span className={`pv-line-standing ${i === 0 ? 'pv-line-standing-best' : ''}`}>
                                {lineStanding}
                              </span>
                            </div>
                            <span className="turnNum">
                              Depth {pv.depth}
                              {lineWdlText ? <span className="pv-line-wdl" title={lineWdlText} data-testid={`engine-pv-wdl-${i}`}> · {lineWdlText}</span> : null}
                            </span>
                            <span className="move">{formatLineInStyle(board, pv.moves, notationStyle, 7)}</span>
                          </div>
                          <div className="pv-line-actions" role="group" aria-label={`Actions for ${lineActionContext}`}>
                            <button
                              type="button"
                              className="pv-action-btn"
                              onClick={() => handlePlayPvMove(firstMove)}
                              disabled={!firstMove || Boolean(gameResult)}
                              title={firstMove ? `Play ${firstMoveText} from this engine line` : 'No move to play from this engine line'}
                              aria-label={playPvLabel}
                              data-testid={`play-engine-pv-${i}`}
                            >
                              <IconPlay />
                              <span>Play</span>
                            </button>
                            <button
                              type="button"
                              className={`pv-action-btn ${copiedPvIndex === i ? 'pv-action-btn-active' : ''} ${exportFailureKey === `copy-pv-${i}` ? 'pv-action-btn-warning' : ''}`}
                              onClick={() => handleCopyPvLine(i, pv.moves)}
                              disabled={pv.moves.length === 0}
                              title={exportFailureKey === `copy-pv-${i}` ? `Copy failed for ${pvLineText}` : `Copy this engine line as raw UCI moves: ${pvRawLine}`}
                              aria-label={copyPvLabel}
                              data-testid={`copy-engine-pv-${i}`}
                            >
                              {exportFailureKey === `copy-pv-${i}` ? <IconX /> : copiedPvIndex === i ? <IconCheck /> : <IconCopy />}
                              <span>{exportFailureKey === `copy-pv-${i}` ? 'Failed' : copiedPvIndex === i ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                  {assistMode === 'pro' ? (
                    <div
                      className="engine-output-terminal mt-4"
                      ref={engineOutputRef}
                      role="log"
                      aria-label={engineOutputTerminalLabel}
                      aria-live="off"
                      aria-relevant="additions text"
                      title={engineOutputTerminalLabel}
                      data-testid="engine-output-terminal"
                    >
                      {outputLines.slice(-20).map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                      {outputLines.length === 0 && <div>Waiting for engine output...</div>}
                    </div>
                  ) : (
                    <div className="engine-coach-summary">
                      <div className="engine-coach-item">
                        <span>Best</span>
                        <strong>{coachBestMoveText}</strong>
                      </div>
                      <div className="engine-coach-item">
                        <span>Depth</span>
                        <strong>{topAnalysisPv?.depth ? `D${topAnalysisPv.depth}` : isSearchQueued ? 'Queued' : isSearching ? 'Pending' : `D${liveAnalysisPolicy.primary.depth}`}</strong>
                      </div>
                      <div className="engine-coach-item engine-coach-line">
                        <span>Line</span>
                        <strong>{coachLineText}</strong>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ── Bottom bar ── */}
      <section className={`panel bottom ${bottomPanelOpen ? '' : 'hidden'}`}>
        <button
          type="button"
          className="resize-handle resize-handle-top"
          onClick={() => setBottomPanelOpen(o => !o)}
          title={bottomPanelOpen ? 'Collapse bottom command bar' : 'Expand bottom command bar'}
          aria-label={bottomPanelOpen ? 'Collapse bottom command bar' : 'Expand bottom command bar'}
          aria-expanded={bottomPanelOpen}
          data-testid="bottom-bar-toggle-handle"
        >
          <span className="resize-pill horizontal" />
        </button>
        <div className="panel-inner">
          {engineEnabled ? <div className={`analyzing-bar ${isSearching || isSearchQueued ? 'active' : ''}`} /> : null}
          <div className="panel-content bottom-main">
            <div className="game-controls">
              <button
                className="gc-btn"
                type="button"
                onClick={toggleNewGameMenu}
                aria-haspopup="dialog"
                aria-expanded={showNewGameMenu}
                aria-controls="new-game-menu-dialog"
              >
                <IconRefresh /> New Game
              </button>
              <button
                className={`gc-btn ${saveFailedToast ? 'gc-btn-warning' : ''}`}
                onClick={handleSaveGame}
                disabled={!canSaveCurrentPosition}
                title={saveFailedToast ? 'Could not save to local storage' : 'Save current game or custom position to library'}
                data-testid="save-game-btn"
              >
                {saveFailedToast ? <><IconX /> Save Failed</> : savedToast ? <><IconCheck /> Saved</> : <><IconSave /> Save</>}
              </button>
              <button
                className={`gc-btn ${exportFailureKey === 'copy-pgn' ? 'gc-btn-warning' : ''}`}
                onClick={handleCopyPgn}
                disabled={!canExportCurrentLine}
                title={exportFailureKey === 'copy-pgn' ? 'Could not copy PGN to clipboard' : 'Copy PGN to clipboard'}
                aria-label={exportFailureKey === 'copy-pgn' ? 'PGN copy failed' : copiedToast ? 'PGN copied' : 'Copy PGN to clipboard'}
                data-testid="copy-pgn-btn"
              >
                {exportFailureKey === 'copy-pgn' ? <><IconX /> Copy Failed</> : copiedToast ? <><IconCheck /> Copied</> : 'Copy PGN'}
              </button>
              <button
                className={`gc-btn ${exportFailureKey === 'download-pgn' ? 'gc-btn-warning' : ''}`}
                onClick={handleDownloadPgn}
                disabled={!canExportCurrentLine}
                title={exportFailureKey === 'download-pgn' ? 'Could not export PGN file' : 'Download current line as a PGN file'}
                aria-label={exportFailureKey === 'download-pgn' ? 'PGN export failed' : downloadedPgnToast ? 'PGN exported' : 'Export PGN'}
                data-testid="download-pgn-btn"
              >
                {exportFailureKey === 'download-pgn' ? <><IconX /> Export Failed</> : downloadedPgnToast ? <><IconCheck /> Exported</> : <><IconDownload /> Export PGN</>}
              </button>
              <button
                className={`gc-btn ${exportFailureKey === 'copy-share' ? 'gc-btn-warning' : ''}`}
                onClick={handleCopyShareLink}
                disabled={!canShareCurrentPosition}
                title={exportFailureKey === 'copy-share' ? 'Could not copy share link' : 'Copy a link to this position'}
                aria-label={exportFailureKey === 'copy-share' ? 'Share link copy failed' : copiedShareToast ? 'Share link copied' : 'Copy a link to this position'}
                data-testid="copy-share-link-btn"
              >
                {exportFailureKey === 'copy-share' ? <><IconX /> Copy Failed</> : copiedShareToast ? <><IconCheck /> Copied</> : <><IconLink /> Copy Link</>}
              </button>
              {/* Next to Review Game on purpose: the review is what tells you a
                  move was a mistake, and this is what lets you try the position
                  again. Analysis workspace only -- in Play you are already
                  playing the position. */}
              {engineEnabled && canPlayFromHere && (
                <button
                  type="button"
                  className="gc-btn"
                  onClick={playFromHere}
                  title={`Keep this position and play on against the engine as ${sideToMove === 'w' ? 'Red' : 'Black'}`}
                  aria-label={`Play on from this position against the engine as ${sideToMove === 'w' ? 'Red' : 'Black'}`}
                  data-testid="play-from-here-btn"
                >
                  <IconPlay aria-hidden="true" focusable="false" /> Play From Here
                </button>
              )}
              {aiPlayActive && (
                <button
                  type="button"
                  className={`gc-btn ${hintMove ? 'gc-btn-active' : ''}`}
                  onClick={runHint}
                  disabled={!canHint}
                  title={canHint ? 'Ask the engine what it would play for you (H)' : isAiTurn ? 'Wait for your turn' : hintPending ? 'Thinking of a hint' : 'No hint right now'}
                  aria-keyshortcuts="H"
                  data-testid="hint-btn"
                >
                  <IconSpark aria-hidden="true" focusable="false" /> Hint
                </button>
              )}
              {engineEnabled && moveHistory.length > 0 && reviewStatus === 'idle' && (
                <button
                  type="button"
                  className="gc-btn"
                  onClick={startGameReview}
                  title={reviewStartTitle}
                  // Enabled, the visible text is the name; overriding it would stop
                  // "Review Game" matching by voice. Disabled, say why instead.
                  aria-label={canStartReview ? undefined : `Game review unavailable: ${reviewStartTitle}`}
                  disabled={!canStartReview}
                  data-testid="start-review-bottom-btn"
                >
                  {canStartReview ? 'Review Game' : reviewStartLabel}
                </button>
              )}
              {reviewStatus === 'running' && (
                <span className="review-progress">
                  Reviewing… {Math.round(reviewProgress * 100)}%
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={handleCancelReview}
                    title="Cancel running game review"
                    aria-label="Cancel running game review"
                    data-testid="cancel-review-bottom-btn"
                  >
                    Cancel
                  </button>
                </span>
              )}
              {reviewStatus === 'done' && reviewSummary && (
                <span
                  className="review-summary"
                  aria-label={completedReviewSummaryLabel}
                  title={completedReviewSummaryLabel}
                  data-testid="bottom-review-summary"
                >
                  <strong>{reviewSummary.accuracy}%</strong> accuracy
                  {typeof reviewSummary.averageCentipawnLoss === 'number' ? (
                    <span
                      className="review-summary-loss"
                      aria-label={`Average centipawn loss ${formatAverageCentipawnLoss(reviewSummary.averageCentipawnLoss)}`}
                      title={`Average centipawn loss ${formatAverageCentipawnLoss(reviewSummary.averageCentipawnLoss)}`}
                      data-testid="bottom-review-average-loss"
                    >
                      Avg loss {formatAverageCentipawnLoss(reviewSummary.averageCentipawnLoss)}
                    </span>
                  ) : null}
                  {typeof reviewSummary.redAccuracy === 'number' ? (
                    <span
                      className="review-summary-side review-summary-side-red"
                      aria-label={`Red accuracy ${reviewSummary.redAccuracy}%`}
                      title={`Red accuracy ${reviewSummary.redAccuracy}%`}
                      data-testid="bottom-review-red-accuracy"
                    >
                      Red {reviewSummary.redAccuracy}%
                    </span>
                  ) : null}
                  {typeof reviewSummary.blackAccuracy === 'number' ? (
                    <span
                      className="review-summary-side review-summary-side-black"
                      aria-label={`Black accuracy ${reviewSummary.blackAccuracy}%`}
                      title={`Black accuracy ${reviewSummary.blackAccuracy}%`}
                      data-testid="bottom-review-black-accuracy"
                    >
                      Black {reviewSummary.blackAccuracy}%
                    </span>
                  ) : null}
                  <span className="review-summary-issue quality-blunder">
                    {formatReviewCount(reviewSummary.blunderCount, 'blunder')}
                  </span>
                  <span className="review-summary-issue quality-mistake">
                    {formatReviewCount(reviewSummary.mistakeCount, 'mistake')}
                  </span>
                  <span className="review-summary-issue quality-inaccuracy">
                    {formatReviewCount(reviewSummary.inaccuracyCount, 'inaccuracy', 'inaccuracies')}
                  </span>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setAnalysisTab('review');
                      setMobileAnalysisTab('review');
                    }}
                    title="Open completed game review"
                    aria-label="Open completed game review"
                    data-testid="view-completed-review-btn"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={clearCompletedReview}
                    title="Clear completed game review"
                    aria-label="Clear completed game review"
                    data-testid="clear-review-bottom-btn"
                  >
                    <IconX />
                  </button>
                </span>
              )}
              <span className="game-mode-badge">
                {isAiMode && <IconBot />}
                {currentModeLabel}
              </span>
              {detectedOpening && (
                <span className="opening-badge" title={detectedOpening.name}>
                  {detectedOpening.chinese}
                  <span className="opening-badge-name">{detectedOpening.name}</span>
                </span>
              )}
            </div>

            <WatchControls
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onFirst={goToFirstMove}
              onPrev={goToPreviousMove}
              onNext={goToNextMove}
              onLast={goToLatestMove}
              gameMode={aiPlayActive ? gameMode : 'PvP'}
              paused={paused}
              onPause={pause}
              onResume={resume}
              onStep={step}
              aiSpeed={aiSpeed}
              onSpeedChange={handleSpeedChange}
              currentMoveIndex={currentMoveIndex}
              totalMoves={moveHistory.length}
              onScrub={jumpToMove}
              shortcutsEnabled={!showSettings && !showNewGameMenu && !visibleGameResult && !showBoardEditor}
            />
          </div>

          <div className="bottom-status-row">
            {engineEnabled ? (
              <div className="bottom-engine-info">
                {bottomEngineStatus}
                {inCheck ? <span className="check-badge">CHECK</span> : null}
              </div>
            ) : (
              <div className="bottom-engine-info" data-testid="play-status">
                {hintText ?? 'Play mode'}
                {inCheck ? <span className="check-badge">CHECK</span> : null}
              </div>
            )}
            <div className="bottombar-fen-group">
              <div className="bottombar-fen" title={currentFen}>FEN: {currentFen}</div>
              <button
                type="button"
                className={`bottombar-fen-copy ${exportFailureKey === 'copy-fen' ? 'bottombar-fen-copy-warning' : ''}`}
                onClick={handleCopyFen}
                aria-label={exportFailureKey === 'copy-fen' ? 'FEN copy failed' : copiedFenToast ? 'FEN copied' : 'Copy current FEN'}
                title={exportFailureKey === 'copy-fen' ? 'Could not copy FEN' : 'Copy current FEN'}
                data-testid="copy-fen-btn"
              >
                {exportFailureKey === 'copy-fen' ? <><IconX /> Failed</> : copiedFenToast ? <><IconCheck /> Copied</> : <><IconCopy /> Copy</>}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Persistent bottom tab bar (mobile only) ── */}
      {isMobile && (
        <nav className="mobile-tab-bar" aria-label="Mobile view">
          <button
            className={`mobile-tab-bar-btn ${mobileView === 'board' ? 'active' : ''}`}
            onClick={() => setMobileView('board')}
            aria-current={mobileView === 'board' ? 'page' : undefined}
            data-testid="mobile-view-board"
          >
            <IconPawn style={{ fontSize: '1.1rem' }} />
            Board
          </button>
          <button
            className={`mobile-tab-bar-btn ${mobileView === 'analysis' ? 'active' : ''}`}
            onClick={() => setMobileView('analysis')}
            aria-current={mobileView === 'analysis' ? 'page' : undefined}
            data-testid="mobile-view-analysis"
          >
            <IconBarChart />
            Analysis
          </button>
        </nav>
      )}

      <CommandPaletteModal
        open={showCommandPalette}
        commands={paletteCommands}
        onClose={() => setShowCommandPalette(false)}
      />

      {visibleGameResult && (
        <GameOverModal
          result={visibleGameResult}
          reason={visibleGameOverReason}
          onNewGame={() => { setGameResult(null); resetGame(); }}
          onReview={dismissGameOverForReview}
        />
      )}

      {deleteUndo ? (
        <div className="undo-toast" role="status" data-testid="delete-undo-toast">
          <span>Removed {deleteUndo.removed === 1 ? '1 move' : `${deleteUndo.removed} moves`}</span>
          <button type="button" className="undo-toast-btn" onClick={handleUndoDelete} data-testid="delete-undo-btn">Undo</button>
          <button type="button" className="undo-toast-dismiss" onClick={dismissDeleteUndo} aria-label="Dismiss">
            <IconX />
          </button>
        </div>
      ) : null}

      {showBoardEditor && (
        <BoardEditor
          initialBoard={board}
          initialSide={sideToMove}
          onCancel={() => setShowBoardEditor(false)}
          onApply={handleApplyEditedPosition}
        />
      )}

      {autoSaveRecovery && (
        <AutoSaveRecoveryModal
          savedAt={autoSaveRecovery.savedAt}
          moveCount={autoSaveRecovery.game.moves.length}
          incomingLink={incomingLink}
          onRestore={restoreAutoSavedGame}
          onDismiss={dismissAutoSaveRecovery}
        />
      )}
    </main>
  );
}

export default App;
