import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Board } from './components/Board/Board';
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
  IconSkipForward, IconMore
} from './components/icons';
import { useEngine, type EngineSearchStats, type PvLine, type WdlStats } from './hooks/useEngine';
import { useXiangqi, type GameResult, type MoveTreeNode } from './hooks/useXiangqi';
import { START_FEN, hasAnyLegalMove, pieceSide, squareToUci, uciToSquare, validatePieceMove, type Side } from './utils/xiangqi';
import { WdlBar } from './components/Panels/WdlBar';
import { playMoveSound, playCaptureSound, playCheckSound, unlockSoundEffects } from './utils/sounds';
import { getOpeningCandidates, matchOpening } from './utils/openings';
import { useGameLibrary } from './hooks/useGameLibrary';
import type { SavedGame, SavedMoveTreeNode } from './utils/gameLibrary';
import { decodeSavedMoveTreeParam, encodeSavedMoveTreeParam } from './utils/shareTree';
import type { HistoricalGame } from './utils/historicalGames';
import { useGameReview } from './hooks/useGameReview';
import { GameOverModal } from './components/GameOverModal';
import { exportPgn, exportPgnTree, copyToClipboard, downloadTextFile } from './utils/gameExport';
import { formatMoveRecordLabel, formatMoveRecordTitle, formatUciLine } from './utils/moveNotation';
import {
  extractFenTag,
  extractUciMoveLine,
  extractUciMoveTree,
  isMoveImportTextTooLarge,
  MAX_MOVE_IMPORT_TEXT_LENGTH,
  MAX_MOVE_IMPORT_UCI_MOVES,
} from './utils/moveImport';
import {
  detectDeviceTier,
  resolveEngineBootConfig,
  resolveLiveAnalysisPolicy,
  resolveReviewPolicy,
} from './utils/analysisProfile';
import {
  classifyMoveQualityForEval,
  computeReviewArtifacts,
  describeReviewEngineSummary,
  formatAverageCentipawnLoss,
  getEvalLossForMove,
  formatReviewCount,
  getReviewSideForRecord,
  makeReviewLineSignature,
  makeReviewLineSignatureFromMoves,
  remapReviewSummaryToLine,
  type ReviewEngineSummary,
  type ReviewMoveQuality,
} from './utils/review';
import {
  AI_STRENGTH_LABELS,
  WORKER_SAFE_MAX_DEPTH,
  chooseAiMoveFromPv,
  describeAiStrength,
  getAiSearchConfig,
  isAiStrength,
  type AiStrength,
} from './utils/aiOpponent';

const LazyLibraryPanel = React.lazy(() =>
  import('./components/Library/LibraryPanel').then((module) => ({ default: module.LibraryPanel }))
);

export type GameMode = 'PvP' | 'PvAI-Black' | 'PvAI-Red' | 'AIvAI';
type WorkspaceMode = 'play' | 'analysis';
type AssistMode = 'coach' | 'pro';
type AnalysisEngineMode = 'stable' | 'optimized';
type PvLineCount = 1 | 3 | 5;
type EngineNotice = { tone: 'warning' | 'danger'; text: string } | null;
type EngineHashFeedback = 'queued' | 'cleared' | null;
type ShareLinkNotice = { tone: 'warning'; text: string; positionKey?: string } | null;
type ExportFailureKey = 'copy-pgn' | 'download-pgn' | 'copy-share' | 'copy-fen' | `copy-pv-${number}`;
type BoardSquare = { file: number; rank: number };
type BoardArrow = {
  from: BoardSquare;
  to: BoardSquare;
  color: string;
  kind?: 'last' | 'engine' | 'engine-focus' | 'book' | 'user';
  opacity?: number;
  strokeWidth?: number;
};

const GAME_MODES: Array<{ mode: GameMode; label: string; shortLabel: string; description: string }> = [
  { mode: 'PvP', label: 'Local board', shortLabel: 'Local', description: 'Two players, one board, no engine moves.' },
  { mode: 'PvAI-Black', label: 'You play Red', shortLabel: 'Red vs AI', description: 'Red moves first while the engine replies as Black.' },
  { mode: 'PvAI-Red', label: 'You play Black', shortLabel: 'Black vs AI', description: 'The engine starts as Red, then you defend as Black.' },
  { mode: 'AIvAI', label: 'AI exhibition', shortLabel: 'AI vs AI', description: 'Both sides are engine-driven for watching and review.' },
];

type PieceCode = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P' | 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p';
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
const THIRD_PARTY_NOTICES_HREF = `${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`;
const FILE_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
const PANEL_MIN_WIDTH = 60;
const PANEL_MAX_WIDTH = 600;
const PANEL_KEYBOARD_STEP = 40;
const DEFAULT_LEFT_PANEL_WIDTH = 320;
const DEFAULT_RIGHT_PANEL_WIDTH = 320;
const INITIAL_PIECE_COUNTS: Record<PieceCode, number> = {
  K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5,
  k: 1, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5,
};
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
const PIECE_MOVE_HINTS: Record<PieceCode, string> = {
  K: 'General: palace steps; open-file capture',
  A: 'Advisor: diagonal inside palace',
  B: 'Elephant: 2-point diagonal; no river',
  N: 'Horse: L move; leg can block',
  R: 'Chariot: straight lines, no blockers',
  C: 'Cannon: straight; capture over 1 screen',
  P: 'Soldier: forward; sideways after crossing river',
  k: 'General: palace steps; open-file capture',
  a: 'Advisor: diagonal inside palace',
  b: 'Elephant: 2-point diagonal; no river',
  n: 'Horse: L move; leg can block',
  r: 'Chariot: straight lines, no blockers',
  c: 'Cannon: straight; capture over 1 screen',
  p: 'Soldier: forward; sideways after crossing river',
};
const PREFERENCES_STORAGE_KEY = 'xiangqi-app-preferences';
const MAX_PREFERENCES_JSON_LENGTH = 4096;
const PIECE_VALUES_TENTHS: Record<PieceCode, number> = {
  K: 0, A: 20, B: 20, N: 40, R: 90, C: 45, P: 10,
  k: 0, a: 20, b: 20, n: 40, r: 90, c: 45, p: 10,
};
const CAPTURED_BY_RED: PieceCode[] = ['r', 'n', 'c', 'a', 'b', 'p'];
const CAPTURED_BY_BLACK: PieceCode[] = ['R', 'N', 'C', 'A', 'B', 'P'];
const START_POSITION_FEN = `${START_FEN} w - - 0 1`;

function makePgnDownloadFilename(opening?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = String(opening || 'game')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'game';
  return `web-xiangqi-${date}-${slug}.pgn`;
}

function isGameMode(value: unknown): value is GameMode {
  return value === 'PvP' || value === 'PvAI-Black' || value === 'PvAI-Red' || value === 'AIvAI';
}

function isAiGameModeValue(mode: GameMode) {
  return mode !== 'PvP';
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

function serializeSavedMoveTree(
  treeNodes: Record<string, MoveTreeNode>,
  parentId: string,
  seen = new Set<string>()
): SavedMoveTreeNode[] {
  const parent = treeNodes[parentId];
  if (!parent || seen.has(parentId)) return [];

  const nextSeen = new Set(seen);
  nextSeen.add(parentId);
  return parent.childrenIds
    .map((childId): SavedMoveTreeNode | null => {
      const child = treeNodes[childId];
      const uci = child?.record?.uci;
      if (!child || !uci) return null;
      const children = serializeSavedMoveTree(treeNodes, childId, nextSeen);
      return children.length > 0 ? { uci, children } : { uci };
    })
    .filter((node): node is SavedMoveTreeNode => Boolean(node));
}

type ReviewPhase = 'base' | 'revisit';

type StoredPreferences = {
  assistMode?: AssistMode;
  orientation?: BoardOrientation;
  showArrows?: boolean;
  soundEnabled?: boolean;
  searchDepth?: number;
  analysisEngineMode?: AnalysisEngineMode;
  enginePvLineCount?: PvLineCount;
  aiStrength?: AiStrength;
  aiSpeed?: AiSpeed;
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

function nodeLabel(nodeId: string, rootNodeId: string, treeNodes: ReturnType<typeof useXiangqi>['treeNodes']) {
  if (nodeId === rootNodeId) return 'Start';
  const record = treeNodes[nodeId]?.record;
  if (!record) return 'Node';
  return `${record.ply}. ${formatMoveRecordLabel(record)}`;
}

function nodeTitle(nodeId: string, rootNodeId: string, treeNodes: ReturnType<typeof useXiangqi>['treeNodes']) {
  if (nodeId === rootNodeId) return 'Start position';
  const record = treeNodes[nodeId]?.record;
  if (!record) return 'Move node';
  return `Ply ${record.ply}: ${formatMoveRecordTitle(record)}`;
}

function detectCoarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(pointer: coarse)').matches;
}

function detectSimdSupport() {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
      10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
  } catch (_) {
    return false;
  }
}

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
      analysisEngineMode: isAnalysisEngineMode(record.analysisEngineMode) ? record.analysisEngineMode : undefined,
      enginePvLineCount: isPvLineCount(record.enginePvLineCount) ? record.enginePvLineCount : undefined,
      aiStrength: isAiStrength(record.aiStrength) ? record.aiStrength : undefined,
      aiSpeed: isAiSpeed(record.aiSpeed) ? record.aiSpeed : undefined,
    };
  } catch {
    return {};
  }
}

function readStoredPreferences(): StoredPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
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

function makeAnalysisTag(phase: 'primary' | 'deepen', requestKey: string) {
  return `${ANALYSIS_TAG_PREFIX}|${phase}|${requestKey}`;
}

function parseAnalysisTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${ANALYSIS_TAG_PREFIX}|`)) return null;
  const [, phase, ...rest] = tag.split('|');
  if ((phase !== 'primary' && phase !== 'deepen') || rest.length === 0) return null;
  return { phase, requestKey: rest.join('|') };
}

function makeReviewTag(phase: ReviewPhase, nodeId: string) {
  return `${REVIEW_TAG_PREFIX}|${phase}|${nodeId}`;
}

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

function formatEvalGap(centipawns: number) {
  const normalized = Math.max(0, Math.round(centipawns));
  return `${(normalized / 100).toFixed(1)} behind`;
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

function isPieceCode(value: string): value is PieceCode {
  return value in PIECE_SYMBOLS;
}

function formatSquare(square: BoardSquare | null) {
  if (!square) return '';
  return `${FILE_LABELS[square.file]}${square.rank}`;
}

function formatMaterialValue(valueTenths: number) {
  const value = valueTenths / 10;
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatMoveRuleHint(reason?: string) {
  switch (reason) {
    case 'horse leg blocked':
      return 'Horse leg is blocked.';
    case 'elephant eye blocked':
      return 'Elephant eye is blocked.';
    case 'cannon capture needs one screen':
      return 'Cannon captures need exactly one screen.';
    case 'cannon moves orthogonally':
      return 'Cannon moves in straight lines.';
    case 'cannon path blocked':
      return 'Cannon path is blocked.';
    case 'rook moves orthogonally':
      return 'Chariot moves in straight lines.';
    case 'rook path blocked':
      return 'Chariot path is blocked.';
    case 'horse moves in an L':
      return 'Horse moves one point straight, then one point diagonal.';
    case 'advisor moves 1 diagonally':
      return 'Advisor moves one point diagonally inside the palace.';
    case 'advisor must stay in palace':
      return 'Advisor must stay inside the palace.';
    case 'general moves 1 orthogonally':
      return 'General moves one point orthogonally inside the palace.';
    case 'general must stay in palace':
      return 'General must stay inside the palace.';
    case 'generals cannot face each other':
      return 'Generals cannot face each other.';
    case 'move must change square':
      return 'Choose a different destination square.';
    case 'move leaves general in check':
      return 'That leaves your general in check.';
    case 'elephant moves 2 diagonally':
      return 'Elephant moves two points diagonally.';
    case 'elephant cannot cross river':
      return 'Elephant cannot cross the river.';
    case 'pawn move is illegal':
      return 'Soldiers move forward, then sideways after crossing the river.';
    case 'not your piece':
      return 'Move the side whose turn it is.';
    case 'cannot capture your own piece':
      return 'Choose an empty square or an opposing piece.';
    default:
      if (!reason) return 'That move is not legal in this position.';
      return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
  }
}

function makeEnginePositionCommand(rootFen: string, moves: string[]) {
  const rootParts = rootFen.trim().split(/\s+/);
  const isDefaultStart = rootParts[0] === START_FEN && rootParts[1] === 'w';
  const baseCommand = isDefaultStart ? 'position startpos' : `position fen ${rootFen}`;
  return moves.length > 0 ? `${baseCommand} moves ${moves.join(' ')}` : baseCommand;
}

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

function clampPanelWidth(width: number) {
  const nextWidth = Math.round(width);
  if (nextWidth < PANEL_MIN_WIDTH) return 0;
  return Math.min(nextWidth, PANEL_MAX_WIDTH);
}

function App() {
  const storedPreferences = useMemo(() => readStoredPreferences(), []);
  const defaultSearchDepth = typeof window !== 'undefined' && window.innerWidth <= 900 ? 6 : 8;
  const initialSoundEnabled = storedPreferences.soundEnabled ?? true;
  const initialAiSpeed = storedPreferences.aiSpeed ?? 'normal';
  const [gameMode, setGameMode] = useState<GameMode>('PvP');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('analysis');
  const [assistMode, setAssistMode] = useState<AssistMode>(storedPreferences.assistMode ?? 'coach');
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(320);
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
  const [showNewGameMenu, setShowNewGameMenu] = useState(false);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const newGameDialogRef = useRef<HTMLDivElement | null>(null);
  const treeBreadcrumbRef = useRef<HTMLDivElement | null>(null);
  const [pendingGameMode, setPendingGameMode] = useState<GameMode>('PvP');
  const [aiStrength, setAiStrength] = useState<AiStrength>(storedPreferences.aiStrength ?? 5);
  const [leftPanelTab, setLeftPanelTab] = useState<'graph' | 'library'>('graph');
  const [graphLoadSweepToken, setGraphLoadSweepToken] = useState(0);
  const [orientation, setOrientation] = useState<BoardOrientation>(storedPreferences.orientation ?? 'red');
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
  const [enginePvLineCount, setEnginePvLineCount] = useState<PvLineCount>(storedPreferences.enginePvLineCount ?? 3);
  const [engineRestartToken, setEngineRestartToken] = useState(0);
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
    setEnginePvLineCount(preferences.enginePvLineCount ?? 3);
    setAiStrength(preferences.aiStrength ?? 5);
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
      analysisEngineMode,
      enginePvLineCount,
      aiStrength,
      aiSpeed,
    });
  }, [
    aiSpeed,
    aiStrength,
    analysisEngineMode,
    assistMode,
    enginePvLineCount,
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
    setNodeReviewDataBulk,
    clearAllReviewData,
    getNodeFen,
    jumpToMove,
    jumpToNode,
  } = useXiangqi();

  const viewportWidth = viewportSize.width;
  const viewportHeight = viewportSize.height;
  const isMobile = viewportWidth <= 900;
  const safeSearchDepth = Math.min(searchDepth, WORKER_SAFE_MAX_DEPTH);
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
  const analysisStageRef = useRef<'idle' | 'primary-pending' | 'primary-complete' | 'deepen-pending' | 'settled'>('idle');
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

  const deviceProfile = useMemo(() => detectDeviceTier({
    viewportWidth,
    viewportHeight,
    hardwareConcurrency: typeof navigator === 'undefined' ? undefined : Number(navigator.hardwareConcurrency),
    deviceMemoryGB: typeof navigator === 'undefined' ? undefined : Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0),
    coarsePointer: detectCoarsePointer(),
  }), [viewportWidth, viewportHeight]);

  const baseEngineBootConfig = useMemo(
    () => resolveEngineBootConfig(deviceProfile, { allowSIMD: detectSimdSupport() }),
    [deviceProfile]
  );

  const engineBootConfig = useMemo(() => {
    if (engineSafetyBootLevel < 1) return baseEngineBootConfig;
    return resolveEngineBootConfig(deviceProfile, {
      allowSIMD: baseEngineBootConfig.allowSIMD,
      saferBoot: true,
    });
  }, [baseEngineBootConfig, deviceProfile, engineSafetyBootLevel]);

  const engineDetailEnabled = engineEnabled && analysisTab === 'engine' && !isAiTurn && reviewStatus !== 'running';
  const analysisMultiPv = engineDetailEnabled ? enginePvLineCount : 1;
  const analysisWdlEnabled = engineDetailEnabled;
  const liveAnalysisPolicy = useMemo(() => resolveLiveAnalysisPolicy({
    tier: engineBootConfig.tier,
    mode: analysisEngineMode,
    searchDepth: safeSearchDepth,
    detailEnabled: engineDetailEnabled,
  }), [analysisEngineMode, engineBootConfig.tier, engineDetailEnabled, safeSearchDepth]);

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
          if (childNodeId) setNodeBestMove(childNodeId, uci);
        }

        if (reviewTag.phase === 'base' && reviewPolicy.revisit) {
          const record = treeNodes[reviewTag.nodeId]?.record;
          const parentId = treeNodes[reviewTag.nodeId]?.parentId ?? null;
          const parentEval = parentId ? getEffectiveNodeEval(parentId) : undefined;
          if (record && parentId && typeof parentEval === 'number') {
            const side = getReviewSideForRecord(record, Math.max(0, record.ply - 1));
            const swing = getEvalLossForMove(parentEval, normalizedScore, side);
            if (swing >= reviewPolicy.revisitThreshold) {
              const previousSwing = controller.criticalDecisionSwings.get(parentId) ?? 0;
              if (swing > previousSwing) {
                controller.criticalDecisionSwings.set(parentId, swing);
              }
            }
          }
        }

        controller.completed += 1;
        updateReviewProgress(controller.completed, controller.total);
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
    () => getAiSearchConfig(aiStrength, safeSearchDepth),
    [aiStrength, safeSearchDepth]
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
  }, [breadcrumbNodeIds.length, currentNodeId]);

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

  useEffect(() => {
    if (reviewStatus !== 'done' || !reviewSummary) return;
    if (reviewSummary.lineSignature === currentLineSignature) return;
    clearCompletedReview();
  }, [clearCompletedReview, currentLineSignature, reviewStatus, reviewSummary]);

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
      } else if (!event.shiftKey && current === last) {
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
    if (!engineEnabled || !isReady || isAiTurn || reviewControllerRef.current.active || !isPageVisible) {
      activeAnalysisRequestRef.current = '';
      analysisStageRef.current = 'idle';
      clearAnalysisDeepenTimer();
      clearQueuedSearch();
      clearPvLines();
      clearWdl();
      if (isSearching && !applyBestMoveRef.current) {
        stopSearch();
      }
      return;
    }

    if (activeAnalysisRequestRef.current !== analysisRequestKey) {
      activeAnalysisRequestRef.current = analysisRequestKey;
      analysisStageRef.current = 'idle';
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
    isPageVisible,
    isAiTurn,
    isReady,
    isSearching,
    liveAnalysisPolicy.debounceMs,
    liveAnalysisPolicy.primary.goCmd,
    queueSearch,
    stopSearch,
  ]);

  useEffect(() => {
    if (analysisStageRef.current !== 'primary-complete') return;
    const deepenPolicy = liveAnalysisPolicy.deepen;
    if (
      !deepenPolicy ||
      !engineEnabled ||
      !isReady ||
      isAiTurn ||
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
        `go depth ${aiSearchDepth}`,
        0,
        makeAiTag(currentPositionCommand, aiSearchDepth, aiStrength),
      );
    }, delayMs);

    return () => clearTimeout(timer);
  }, [aiSearchConfig.depth, aiSpeed, aiStrength, currentPositionCommand, gameResult, isAiTurn, isPageVisible, isReady, isSearchQueued, isSearching, paused, queueSearch, reviewStatus]);

  // Review engine drive: when review is running and engine is idle, fire next search
  useEffect(() => {
    const controller = reviewControllerRef.current;
    if (!controller.active) return;
    if (isSearching || isSearchQueued) return;
    if (!isReady) return;
    if (controller.currentNodeId) return;

    if (controller.phase === 'base' && controller.baseQueue.length === 0) {
      if (reviewPolicy.revisit && controller.revisitQueue.length === 0) {
        controller.revisitQueue = Array.from(controller.criticalDecisionSwings.entries())
          .sort((left, right) => right[1] - left[1])
          .slice(0, reviewPolicy.revisitLimit)
          .map(([nodeId]) => nodeId);

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
    const fen = getNodeFen(nodeId);
    const goCmd = controller.phase === 'base' ? reviewPolicy.base.goCmd : (reviewRevisitGoCmd ?? reviewPolicy.base.goCmd);
    queueSearch(`position fen ${fen}`, goCmd, 0, makeReviewTag(controller.phase, nodeId));
  }, [finalizeReview, getNodeFen, isReady, isSearchQueued, isSearching, queueSearch, reviewPolicy.base.goCmd, reviewPolicy.revisit, reviewPolicy.revisitLimit, reviewRevisitGoCmd, reviewStatus, updateReviewProgress]);

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
    resetGame();
  }, [resetGame]);

  const openLibraryPanel = useCallback(() => {
    setShowMobileBoardActionMenu(false);
    setLeftWidth((width) => width === 0 ? DEFAULT_LEFT_PANEL_WIDTH : width);
    setLeftPanelTab('library');
    setMobileAnalysisTab('library');
    setMobileView('analysis');
  }, []);

  const adjustLeftPanelWidth = useCallback((delta: number) => {
    setLeftWidth((width) => clampPanelWidth((width > 0 ? width : DEFAULT_LEFT_PANEL_WIDTH) + delta));
  }, []);

  const adjustRightPanelWidth = useCallback((delta: number) => {
    setRightWidth((width) => clampPanelWidth((width > 0 ? width : DEFAULT_RIGHT_PANEL_WIDTH) + delta));
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
    ? formatUciLine([topAnalysisPv.moves[0]], 1)
    : isSearchQueued || isSearching
      ? 'Waiting for engine'
      : 'No engine move yet';
  const coachLineText = topAnalysisPv?.moves.length
    ? formatUciLine(topAnalysisPv.moves, 5)
    : isSearchQueued || isSearching
      ? 'Waiting for engine line'
      : 'No engine line yet';
  const liveEvalScore = currentAnalysisPvLines[0]?.score ?? null;
  const displayEvalScore = useMemo(
    () => typeof liveEvalScore === 'number' ? normalizeEvalForSide(liveEvalScore, sideToMove) : null,
    [liveEvalScore, sideToMove]
  );
  const displayWdl = useMemo(
    () => normalizeWdlForSide(wdl, sideToMove),
    [sideToMove, wdl]
  );
  const shouldShowWdlBar = engineEnabled && (engineDetailEnabled || displayWdl !== null);
  const currentEvalText = topAnalysisPv
    ? formatRedPovEngineScore(topAnalysisPv, sideToMove)
    : null;
  const redPerspectiveEvalText = currentEvalText ? `Red POV ${currentEvalText}` : null;
  const liveEvalLabel = currentEvalText ? `Live engine evaluation, ${redPerspectiveEvalText}` : undefined;
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

  const materialSummary = useMemo(() => {
    const currentCounts = Object.keys(INITIAL_PIECE_COUNTS).reduce((acc, key) => {
      acc[key as PieceCode] = 0;
      return acc;
    }, {} as Record<PieceCode, number>);

    board.forEach((row) => {
      row.forEach((piece) => {
        if (piece && isPieceCode(piece)) {
          currentCounts[piece] += 1;
        }
      });
    });

    const makeCaptured = (pieces: PieceCode[]) => pieces
      .map((piece) => ({
        piece,
        count: Math.max(0, INITIAL_PIECE_COUNTS[piece] - currentCounts[piece]),
      }))
      .filter((item) => item.count > 0);

    const redCaptured = makeCaptured(CAPTURED_BY_RED);
    const blackCaptured = makeCaptured(CAPTURED_BY_BLACK);
    const redMaterialTenths = redCaptured.reduce(
      (sum, item) => sum + PIECE_VALUES_TENTHS[item.piece] * item.count,
      0
    );
    const blackMaterialTenths = blackCaptured.reduce(
      (sum, item) => sum + PIECE_VALUES_TENTHS[item.piece] * item.count,
      0
    );
    const deltaTenths = redMaterialTenths - blackMaterialTenths;

    return {
      redCaptured,
      blackCaptured,
      redMaterialTenths,
      blackMaterialTenths,
      deltaTenths,
    };
  }, [board]);

  const materialText = materialSummary.deltaTenths > 0
    ? `Red +${formatMaterialValue(materialSummary.deltaTenths)}`
    : materialSummary.deltaTenths < 0
      ? `Black +${formatMaterialValue(Math.abs(materialSummary.deltaTenths))}`
      : 'Material even';
  const canSaveCurrentPosition = moveHistory.length > 0 || rootFen !== START_POSITION_FEN || hasMoveTreeMoves;
  const canExportCurrentLine = (currentMoveIndex >= 0 && moveHistory.length > 0) || hasMoveTreeMoves;
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
        : '');
  const bottomEngineStatus = !isReady
    ? engineNotice?.text ?? 'Loading engine'
    : isSearchQueued
      ? 'Queued'
      : isSearching
        ? 'Analyzing'
        : 'Idle';
  const topEngineStatusText = engineNotice?.text ?? (isReady ? 'Engine ready' : 'Loading engine');
  const topEngineStatusLabel = isReady
    ? `${topEngineStatusText}, runtime ${engineVariant}`
    : topEngineStatusText;
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
    const parentEval  = parentId ? treeNodes[parentId]?.record?.evalScore : 0;
    if (!record || typeof currentEval !== 'number' || typeof parentEval !== 'number') return '#94a3b8';
    const side = getReviewSideForRecord(record, record.ply - 1);
    const delta = getEvalLossForMove(parentEval, currentEval, side);
    return getQualityArrowColor(classifyMoveQualityForEval(delta, parentEval, currentEval, side));
  }, [currentNodeId, treeNodes]);

  // Opening recognition
  const detectedOpening = useMemo(() => {
    const uciMoves = moveHistory.slice(0, currentMoveIndex + 1).map(r => r.uci);
    return matchOpening(uciMoves);
  }, [moveHistory, currentMoveIndex]);
  const openingCandidates = useMemo(() => {
    if (rootFen !== START_POSITION_FEN) return [];
    const uciMoves = moveHistory.slice(0, currentMoveIndex + 1).map(r => r.uci);
    return getOpeningCandidates(uciMoves, assistMode === 'pro' ? 6 : 4);
  }, [assistMode, currentMoveIndex, moveHistory, rootFen]);

  // Game library
  const { games: savedGames, save: saveGameToLibrary, remove: deleteGameFromLibrary, rename: renameGameInLibrary } = useGameLibrary();

  const [copiedToast, setCopiedToast] = useState(false);
  const [copiedFenToast, setCopiedFenToast] = useState(false);
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
      makePgnDownloadFilename(detectedOpening?.name),
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
    const moveTree = hasMoveTreeMoves && (hasStudyBranches || currentLineMoves.length === 0)
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
      ? { tone: 'warning', text: 'Variations omitted', positionKey: shareNoticePositionKey }
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
  }, [canShareCurrentPosition, clearExportFailure, currentLineMoves, gameMode, hasMoveTreeMoves, hasStudyBranches, rootFen, rootNodeId, shareNoticePositionKey, showExportFailure, treeNodes]);

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
    setFenInput('');
    clearFenError();
    closeNewGameMenu();
  }, [clearFenError, closeNewGameMenu, gameMode, handleCancelReview, loadFen, resetReview, stopAnalysis]);

  const handleImportMoveLine = useCallback((text: string, nextGameMode: GameMode = pendingGameMode) => {
    if (isMoveImportTextTooLarge(text)) {
      setMoveLineError(`Move line is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.`);
      return;
    }

    const importedLine = extractUciMoveTree(text);
    const moves = importedLine.moves;
    if (importedLine.tooLarge || moves.length > MAX_MOVE_IMPORT_UCI_MOVES) {
      setMoveLineError(`Move line is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.`);
      return;
    }
    if (moves.length === 0) {
      setMoveLineError('No UCI moves found');
      return;
    }

    const startFen = fenInput.trim() || extractFenTag(text) || undefined;
    const validation = validateMoveSequence(moves, startFen);
    if (!validation.ok) {
      setMoveLineError(
        validation.move
          ? `Move ${validation.failedIndex + 1} ${validation.move}: ${validation.reason}`
          : validation.reason
      );
      return;
    }
    if (importedLine.hasVariations) {
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
    if (importedLine.hasVariations) {
      loadMoveTree(importedLine.moveTree, moves, startFen);
    } else {
      loadMoves(moves, startFen);
    }
    setFenInput('');
    clearFenError();
    setMoveLineInput('');
    setMoveLineFileName('');
    setMoveLineError(null);
    setGraphLoadSweepToken((token) => token + 1);
    closeNewGameMenu();
  }, [clearFenError, closeNewGameMenu, fenInput, handleCancelReview, loadMoveTree, loadMoves, pendingGameMode, resetReview, stopAnalysis, validateMoveSequence, validateMoveTree]);

  useEffect(() => {
    if (shareLinkLoadedRef.current || typeof window === 'undefined') return;
    shareLinkLoadedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const rawFen = params.get('fen')?.trim() || undefined;
    const rawMoves = params.get('moves') || '';
    const rawTree = params.get('tree');
    const sharedMoveTree = decodeSavedMoveTreeParam(rawTree);
    const rawMode = params.get('mode');
    if (isMoveImportTextTooLarge(rawMoves)) {
      setShareLinkNotice({ tone: 'warning', text: 'Shared link not loaded' });
      logDiagnosticWarning('Ignored oversized shared Xiangqi line.');
      return;
    }
    const moves = extractUciMoveLine(rawMoves);
    const mode = isGameMode(rawMode) ? rawMode : 'PvP';
    if (moves.length > MAX_MOVE_IMPORT_UCI_MOVES) {
      setShareLinkNotice({ tone: 'warning', text: 'Shared link not loaded' });
      logDiagnosticWarning('Ignored oversized shared Xiangqi line.');
      return;
    }
    if (!rawFen && moves.length === 0 && !sharedMoveTree?.length) {
      if (rawTree || rawMoves.trim()) {
        setShareLinkNotice({ tone: 'warning', text: 'Shared link not loaded' });
      }
      return;
    }

    const validation = validateMoveSequence(moves, rawFen);
    if (!validation.ok) {
      setShareLinkNotice({ tone: 'warning', text: 'Shared link not loaded' });
      logDiagnosticWarning('Ignored invalid shared Xiangqi link:', validation);
      return;
    }

    const treeValidation = sharedMoveTree?.length ? validateMoveTree(sharedMoveTree, rawFen) : null;
    const sharedTreeContainsLine = sharedMoveTree?.length ? moveTreeContainsLine(sharedMoveTree, moves) : false;
    const canLoadSharedTree = sharedMoveTree?.length ? treeValidation?.ok === true && sharedTreeContainsLine : false;
    if (sharedMoveTree?.length && treeValidation && !treeValidation.ok && moves.length === 0 && !rawFen) {
      setShareLinkNotice({ tone: 'warning', text: 'Shared link not loaded' });
      logDiagnosticWarning('Ignored invalid shared Xiangqi variation tree:', treeValidation);
      return;
    }

    setShareLinkNotice(rawTree && !canLoadSharedTree ? { tone: 'warning', text: 'Shared variations not loaded' } : null);
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
      annotations: moveHistory.map((record, moveIndex) => ({
        moveIndex,
        evalScore: record.evalScore,
        bestMove: record.bestMove,
        quality: record.quality,
        swing: record.swing,
        winPercentLoss: record.winPercentLoss,
        reviewNote: record.reviewNote,
      })),
    };
  }, [moveHistory, reviewStatus, reviewSummary]);

  const handleSaveGame = useCallback(() => {
    const saveNodeIds = reviewStatus === 'done' && reviewSummary
      ? activeLineNodeIds
      : activeLineNodeIds.slice(0, currentMoveIndex + 1);
    const moves = saveNodeIds
      .map(id => treeNodes[id]?.record?.uci)
      .filter((uci): uci is string => Boolean(uci));
    const moveTree = hasMoveTreeMoves && (hasStudyBranches || moves.length === 0)
      ? serializeSavedMoveTree(treeNodes, rootNodeId)
      : undefined;
    const saved = saveGameToLibrary(gameMode, moves, {
      opening: detectedOpening?.name,
      finalEval: displayEvalScore ?? undefined,
      startFen: rootFen !== START_POSITION_FEN ? rootFen : undefined,
      result: gameResult === 'red-wins' ? 'red' : gameResult === 'black-wins' ? 'black' : gameResult === 'draw' ? 'draw' : 'ongoing',
      moveTree,
      review: reviewStatus === 'done' && reviewSummary
        ? {
            ...savedReviewSnapshot!,
            summary: {
              ...reviewSummary,
              lineSignature: makeReviewLineSignatureFromMoves(moves),
            },
          }
        : undefined,
    });

    if (savedToastTimerRef.current !== null) {
      window.clearTimeout(savedToastTimerRef.current);
    }
    setSavedToast(Boolean(saved));
    setSaveFailedToast(!saved);
    savedToastTimerRef.current = window.setTimeout(() => {
      savedToastTimerRef.current = null;
      setSavedToast(false);
      setSaveFailedToast(false);
    }, 1800);
  }, [activeLineNodeIds, currentMoveIndex, detectedOpening, displayEvalScore, gameMode, gameResult, hasMoveTreeMoves, hasStudyBranches, reviewStatus, reviewSummary, rootFen, rootNodeId, saveGameToLibrary, savedReviewSnapshot, treeNodes]);

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
              quality: annotation.quality,
              swing: annotation.swing,
              winPercentLoss: annotation.winPercentLoss,
              reviewNote: annotation.reviewNote,
            };
          })
          .filter((annotation): annotation is NonNullable<typeof annotation> => Boolean(annotation))
      );
      hydrateReview(remapReviewSummaryToLine({
        ...game.review.summary,
        lineSignature: makeReviewLineSignatureFromMoves(game.moves),
      }, loadedNodeIds));
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
  }, [assistMode, lastMoveFrom, lastMoveTo, lastMoveArrowColor, currentAnalysisPvLines, engineEnabled, openingCandidates, showArrows, spotlightPvIndex, spotlightPvLine, userArrows]);

  return (
    <main
      className="app-shell"
      data-mobile-view={isMobile ? mobileView : undefined}
      data-assist-mode={assistMode}
    >
      <h1 className="sr-only">Web Xiangqi</h1>

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
                role="status"
                data-testid="share-link-warning"
              >
                <span className={`status-dot ${shareLinkNotice.tone}`} />
                <span>{shareLinkNotice.text}</span>
              </div>
            ) : null}

            <span className="toolbar-divider desktop-only" />

            {/* Action buttons */}
            <div className="top-action-buttons">
              <button
                type="button"
                className="top-action-btn"
                onClick={() => setOrientation(o => o === 'red' ? 'black' : 'red')}
                title="Flip board"
                aria-label="Flip board orientation"
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

            {/* Mobile panel toggles */}
            <div className="mobile-actions">
              <button
                type="button"
                onClick={() => setLeftWidth(w => w > 0 ? 0 : DEFAULT_LEFT_PANEL_WIDTH)}
                title="Toggle graph panel"
                aria-label="Toggle graph panel"
              >
                <IconBarChart />
              </button>
              <button
                type="button"
                onClick={() => setRightWidth(w => w > 0 ? 0 : DEFAULT_RIGHT_PANEL_WIDTH)}
                title="Toggle tree panel"
                aria-label="Toggle move tree panel"
              >
                <IconTree />
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
                <option value="PvP">Local Multiplayer</option>
                <option value="PvAI-Black">Play Red vs AI</option>
                <option value="PvAI-Red">Play Black vs AI</option>
                <option value="AIvAI">Watch AI vs AI</option>
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
            </div>

            <div className="settings-group">
              <label htmlFor="settings-search-depth">
                Search Depth (AI / Live Analysis Cap) — {searchDepth}
                {searchDepth > safeSearchDepth ? ` (worker cap ${safeSearchDepth})` : ''}
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
                  {([1, 2, 3, 4, 5] as AiStrength[]).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className={`new-game-strength-btn ${aiStrength === lvl ? 'new-game-strength-btn-active' : ''}`}
                      onClick={() => setAiStrength(lvl)}
                      title={describeAiStrength(lvl)}
                      aria-label={describeAiStrength(lvl)}
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
                  placeholder="1. b2e2 h9g7 b0c2"
                  aria-label="UCI move line"
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
                <em>{pendingModeMeta.description}</em>
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
        <section className="panel left">
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
              <div className="analysis-tab-strip" role="tablist" aria-label="Graph and library panels">
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
                            aria-label={`Play book continuation ${formatUciLine([candidate.move], 1)}: ${candidate.names[0] ?? candidate.chinese[0]}`}
                            data-testid={`book-candidate-${candidate.move}`}
                          >
                            <strong>{formatUciLine([candidate.move], 1)}</strong>
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
                </>
              ) : (
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
                  aria-label="Toggle board arrows and markers"
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
              </div>
            </>
          ) : null}
          <div className="mobile-board-center">
            <div className="board-workspace">
              <div className="board-wrap">
                {aiPlayActive && (
                  <div
                    className="board-ai-status"
                    role={boardAiStatusText ? 'status' : undefined}
                    aria-live={boardAiStatusText ? 'polite' : undefined}
                    aria-label={boardAiStatusText || undefined}
                  >
                    <IconBot />
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
                    ) : null}
                  </div>
                )}
                <Board
                  board={board}
                  selected={selected}
                  validTargets={validTargets}
                  onSquareClick={handleSquareClick}
                  orientation={orientation}
                  highlights={showArrows ? userHighlights : []}
                  onToggleHighlight={showArrows ? handleToggleHighlight : undefined}
                  onAddArrow={showArrows ? handleAddUserArrow : undefined}
                  arrows={boardArrows}
                />
                {inCheck && (
                  <div className="check-overlay">
                    <span className="check-badge">CHECK</span>
                  </div>
                )}
              </div>

              <div className="position-dock" aria-live="polite">
                <div className="position-stat position-stat-turn">
                  <span>Turn</span>
                  <strong>{sideToMoveLabel}</strong>
                  <em>{inCheck ? 'Check' : currentModeMeta.shortLabel}</em>
                </div>
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
                    <div className="captured-pieces" aria-label="Pieces captured by Red">
                      {materialSummary.redCaptured.length > 0 ? materialSummary.redCaptured.map(({ piece, count }) => (
                        <span key={piece} className="captured-piece captured-piece-black" title={PIECE_NAMES[piece]}>
                          {PIECE_SYMBOLS[piece]}{count > 1 ? <sup>{count}</sup> : null}
                        </span>
                      )) : <em>None</em>}
                    </div>
                  </div>
                  <div className="capture-tray">
                    <span>Black took</span>
                    <div className="captured-pieces" aria-label="Pieces captured by Black">
                      {materialSummary.blackCaptured.length > 0 ? materialSummary.blackCaptured.map(({ piece, count }) => (
                        <span key={piece} className="captured-piece captured-piece-red" title={PIECE_NAMES[piece]}>
                          {PIECE_SYMBOLS[piece]}{count > 1 ? <sup>{count}</sup> : null}
                        </span>
                      )) : <em>None</em>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {isMobile && (
            <div className="mobile-board-nav">
              <button className="mobile-nav-btn" type="button" onClick={goToFirstMove} disabled={!canGoBack} aria-label="Go to first move"><IconSkipBack /></button>
              <button className="mobile-nav-btn" type="button" onClick={goToPreviousMove} disabled={!canGoBack} aria-label="Go to previous move"><IconChevronLeft /></button>
              <span className="mobile-nav-label">
                {currentMoveIndex < 0 ? 'Start' : `${currentMoveIndex + 1} / ${moveHistory.length}`}
              </span>
              <button className="mobile-nav-btn" type="button" onClick={goToNextMove} disabled={!canGoForward} aria-label="Go to next move"><IconChevronRight /></button>
              <button className="mobile-nav-btn" type="button" onClick={goToLatestMove} disabled={!canGoForward} aria-label="Go to latest move"><IconSkipForward /></button>
            </div>
          )}
        </section>

        {/* ── Mobile analysis sub-tab strip (analysis view only) ── */}
        {isMobile && (
          <div className="mobile-analysis-tabs" role="tablist" aria-label="Mobile analysis panels">
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
        <aside className="panel right">
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
              <h2>Analysis</h2>
              <div className="analysis-tab-strip" role="tablist" aria-label="Analysis panels">
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
                  <div className="tree-breadcrumb" ref={treeBreadcrumbRef}>
                    {breadcrumbNodeIds.map((nodeId, index) => {
                      const label = nodeLabel(nodeId, rootNodeId, treeNodes);
                      const title = nodeTitle(nodeId, rootNodeId, treeNodes);
                      return (
                        <button
                          key={nodeId}
                          type="button"
                          className={`tree-breadcrumb-chip ${nodeId === currentNodeId ? 'tree-breadcrumb-chip-active' : ''}`}
                          onClick={() => jumpToNode(nodeId)}
                          title={title}
                          aria-label={title}
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
                    onNavigateNode={jumpToNode}
                  />
                </>
              ) : analysisTab === 'review' ? (
                <ReviewPanel
                  status={reviewStatus}
                  progress={reviewProgress}
                  summary={reviewSummary}
                  currentNodeId={currentNodeId}
                  canStart={canStartReview}
                  startLabel={reviewStartLabel}
                  startTitle={reviewStartTitle}
                  onStart={startGameReview}
                  onCancel={handleCancelReview}
                  onClear={clearCompletedReview}
                  onNavigateNode={jumpToNode}
                  onPlayBestMove={handlePlayReviewBestMove}
                />
              ) : (
                <>
                  <div className="engine-dashboard" aria-label="Engine diagnostics">
                    <div className="engine-stat">
                      <span>Core</span>
                      <strong>{engineVariant}</strong>
                      <em>{engineBootConfig.threads}T · {engineBootConfig.hashMB}MB</em>
                    </div>
                    <div className="engine-stat">
                      <span>Profile</span>
                      <strong>{analysisEngineMode}</strong>
                      <em>{engineBootConfig.tier}{engineBootConfig.saferBoot ? ' · safe boot' : ''}</em>
                    </div>
                    <div className="engine-stat" title={engineSearchDetail} aria-label={engineSearchDetail}>
                      <span>Search</span>
                      <strong>{formatEngineDepthLabel(searchStats, liveAnalysisPolicy.primary.depth, isSearchQueued, isSearching, isReady)}</strong>
                      <em>{formatEngineTelemetry(searchStats, liveAnalysisPolicy.primary.depth, liveAnalysisPolicy.primary.moveTimeMs, isSearchQueued, isSearching)}</em>
                    </div>
                    <div className="engine-stat">
                      <span>Detail</span>
                      <strong>{`MultiPV ${analysisMultiPv}`}</strong>
                      <em>{analysisWdlEnabled ? 'WDL on' : 'WDL off'}</em>
                    </div>
                  </div>
                  <div className="engine-pv-controls" aria-label="Engine principal variation lines">
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
                  <div className="engine-pv-controls engine-runtime-controls" aria-label="Engine runtime controls">
                    <span>Runtime</span>
                    <div className="engine-runtime-buttons">
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
                  <div className="pv-lines-container">
                    {currentAnalysisPvLines.length === 0 ? (
                      <div className="text-muted small">No PV available yet.</div>
                    ) : currentAnalysisPvLines.map((pv, i) => {
                      const bestRawScore = currentAnalysisPvLines[0]?.score ?? pv.score;
                      const lineStanding = i === 0 ? 'Best' : formatEvalGap(bestRawScore - pv.score);
                      const normalizedScore = normalizeEvalForSide(pv.score, sideToMove);
                      const pvScoreText = formatRedPovEngineScore(pv, sideToMove, 0);
                      const pvScoreLabel = `Red POV score ${formatRedPovEngineScore(pv, sideToMove, 1)}`;
                      const pvScoreClass = normalizedScore > 0 ? 'positive' : normalizedScore < 0 ? 'negative' : '';
                      const firstMove = pv.moves[0];
                      const depthLabel = pv.depth ? `depth ${pv.depth}` : 'depth pending';
                      const pvLineText = pv.moves.length ? formatUciLine(pv.moves, 7) : 'No moves yet';
                      const pvLineLabel = pv.moves.length ? `moves ${pvLineText}` : 'no moves yet';
                      const firstMoveText = firstMove ? formatUciLine([firstMove], 1) : '';
                      const lineActionContext = `engine line ${i + 1}, ${depthLabel}, ${pvLineLabel}`;
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
                          aria-label={`Engine line ${i + 1}, ${lineStanding}, ${pvScoreLabel}, ${depthLabel}, ${pvLineLabel}`}
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
                            <span className="turnNum">Depth {pv.depth}</span>
                            <span className="move">{formatUciLine(pv.moves, 7)}</span>
                          </div>
                          <div className="pv-line-actions" aria-label={`Actions for ${lineActionContext}`}>
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
                              title={exportFailureKey === `copy-pv-${i}` ? `Copy failed for ${pvLineText}` : `Copy this engine line as raw UCI moves: ${pvLineText}`}
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
                  {assistMode === 'pro' ? (
                    <div
                      className="engine-output-terminal mt-4"
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
              {engineEnabled && moveHistory.length > 0 && reviewStatus === 'idle' && (
                <button
                  type="button"
                  className="gc-btn"
                  onClick={startGameReview}
                  title={reviewStartTitle}
                  aria-label={canStartReview ? 'Start game review' : `Game review unavailable: ${reviewStartTitle}`}
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
              shortcutsEnabled={!showSettings && !showNewGameMenu && !visibleGameResult}
            />
          </div>

          <div className="bottom-status-row">
            {engineEnabled ? (
              <div className="bottom-engine-info">
                {bottomEngineStatus}
                {inCheck ? <span className="check-badge">CHECK</span> : null}
              </div>
            ) : (
              <div className="bottom-engine-info">
                {inCheck ? <span className="check-badge">CHECK</span> : 'Play mode'}
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

      {visibleGameResult && (
        <GameOverModal
          result={visibleGameResult}
          reason={visibleGameOverReason}
          onNewGame={() => { setGameResult(null); resetGame(); }}
          onReview={dismissGameOverForReview}
        />
      )}
    </main>
  );
}

export default App;
