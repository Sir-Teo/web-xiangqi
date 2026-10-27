import { isComposingKey } from './utils/keyboard';
import { downloadRecoveryGame } from './utils/recoveryDownload';
import { studyContent } from './utils/studyContent';
import { AnalysisBoardContext } from './components/AnalysisBoardContext';
import { EngineOutput, EngineSearchTelemetry } from './components/EngineTelemetry';
import { librarySource, resolveLibrarySource } from './utils/librarySource';
import { isWorthAutoSaving } from './utils/autoSave';
import { currentDraftId, readAutoSaveDraftRaw, readAutoSaveProblems, clearAutoSaveDraft, readAutoSaveDrafts, writeAutoSaveDraft, type RecoveryDraft } from './utils/autoSaveDrafts';
import { normalizeRecordedResult, RESULT_TAG } from './utils/recordedResult';
import { evaluationKindOverride, formatEvaluationText, type EvaluationScoreKind } from './utils/engineEvalReading';
import { captureStudyAnalysis, sameStudyAnalysis } from './utils/studyAnalysis';
import { StudyAnalysisCard } from './components/StudyAnalysisCard';
import { GameMetadataEditor } from './components/GameMetadataEditor';
import { StudyNotes, type StudyNotesViewState } from './components/StudyNotes';
import { ImportedGlyphs } from './components/ImportedGlyphs';
import { collectStudyNotes } from './utils/studyNotes';
import { StudyPracticeDialog } from './components/StudyPracticeDialog';
import { normalizeGameMetadata } from './utils/gameMetadata';
import { LibraryMatches } from './components/Library/LibraryMatches';
import type { LibrarySearchFocusRequest, LibraryViewState } from './components/Library/LibraryPanel';
import { readStorage, writeStorage } from './utils/storage';
import { BeginnerGuide } from './components/BeginnerGuide';
import { DeferredRuleLessons as RuleLessons, DeferredBoardEditor as BoardEditor } from './components/DeferredDialogs';
import { hasMoveTreeLine } from './utils/appendMoveTreeLine';
import { BEGINNER_GUIDE_STORAGE_KEY } from './utils/storageKeys';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Board } from './components/Board/Board';
import { EvalBar } from './components/Board/EvalBar';
import type { BoardOrientation } from './components/Board/Board';
import { DeferredEvalGraph as EvalGraph, DeferredCandidatePanel as CandidatePanel } from './components/DeferredAnalysisPanels';
import { DeferredReviewPanel } from './components/Panels/DeferredReviewPanel';
import { WatchControls } from './components/Controls/WatchControls';
import type { AiSpeed } from './components/Controls/WatchControls';
import { StudyMainLineControls } from './components/Controls/StudyMainLineControls';
import { getStudyMainLine } from './utils/studyMainLine';
import { BreadcrumbChip } from './components/Controls/BreadcrumbChip';
import { MoveListTree } from './components/Controls/MoveListTree';
import { MoveLineStrip } from './components/Controls/MoveLineStrip';
import {
  IconSettings, IconRefresh, IconFlip, IconBarChart, IconTree,
  IconBot, IconX, IconPause, IconPlay, IconSave, IconLibrary, IconArrow,
  IconPawn, IconCheck, IconCopy, IconLink, IconDownload, IconUpload, IconSkipBack, IconChevronLeft, IconChevronRight,
  IconSkipForward, IconMore, IconSearch, IconTarget, IconSpark
} from './components/icons';
import { useEngine } from './hooks/useEngine';
import { useEngineErrorRecovery } from './hooks/useEngineErrorRecovery';
import { useUndoTimeout } from './hooks/useUndoTimeout';
import { candidateGoCommand, makeCandidateTag, parseCandidateTag, type CandidateSearch } from './utils/candidateSearch';
import { formatEngineDownload, formatEngineDownloadShort } from './utils/engineAssetProgress';
import { useXiangqi, type GameResult, type MoveRecord, type MoveTreeSnapshot } from './hooks/useXiangqi';
import { START_FEN, START_POSITION_FEN, hasAnyLegalMove, parseFenBoard, pieceSide, squareToUci, uciToSquare, validateMoveStr, validatePieceMove, type BoardState, type Side } from './utils/xiangqi';
import { describeFenProblem, readFenBoard } from './utils/positionSetup';
import { WdlBar } from './components/Panels/WdlBar';
import { playMoveSound, playCaptureSound, playCheckSound, prepareSoundEffects, suspendSoundEffects, unlockSoundEffects } from './utils/sounds';
import { formatMoveRuleHint } from './utils/moveRuleHints';
import { PIECE_NAMES, formatCapturedTrayLabel, formatMaterialValue, isPieceCode, summarizeMaterial, type PieceCode } from './utils/material';
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
import { formatExplorerRecord } from './utils/positionExplorer';
import { savedGameLine } from './utils/savedGameLine';
import { useLibraryExplorer } from './hooks/useLibraryExplorer';
import { useGameLibrary } from './hooks/useGameLibrary';
import { createSavedGameId, MAX_SAVED_TREE_NODES, type SavedGame } from './utils/gameLibrary';
import { narrativeTags } from './utils/narrativeTags';
import {
  type AutoSavedGame,
  type AutoSaveInput,
} from './utils/autoSave';
import { decodeSavedMoveTreeParam } from './utils/shareTree';
import {
  makeAiTag,
  makeAnalysisTag,
  makeEnginePositionCommand,
  makeHintTag,
  makeReviewTag,
  makeThreatTag,
  parseAiTag,
  parseAnalysisTag,
  parseHintTag,
  parseReviewTag,
  parseThreatTag,
  type ReviewPhase,
} from './utils/engineTags';
import { buildShareUrl, moveTreeContainsLine, readShareParams } from './utils/shareUrl';
import {
  formatRedPovEngineScore,
  normalizeEvalForFen,
  normalizeEvalForSide,
  normalizeScoreBoundForSide,
  normalizeWdlForSide,
} from './utils/engineScore';

import type { HistoricalGame } from './utils/historicalGames';
import { useGameReview } from './hooks/useGameReview';
import { GameOverModal } from './components/GameOverModal';
import { AutoSaveRecoveryModal } from './components/AutoSaveRecoveryModal';
import { exportPgn, exportPgnTree, copyToClipboard, downloadTextFile } from './utils/gameExport';
import { formatMoveRecordTitle, formatUciMove } from './utils/moveNotation';
import { MAX_MOVE_COMMENT_LENGTH, normalizeMoveComment } from './utils/moveComment';
import { formatBreadcrumbLabel } from './utils/moveBreadcrumb';
import { passMoveFen } from './utils/threatPosition';
import { isDrillSuccess, judgeCompletedDrillAttempt, judgeDrillAttempt, orderDrillMoments, type DrillVerdict } from './utils/mistakeDrill';
import type { XqfRecord } from './utils/xqf';
import { PIECE_STYLES, PIECE_STYLE_DESCRIPTIONS, PIECE_STYLE_LABELS, type PieceStyle } from './utils/pieceStyle';
import { describePvStanding } from './utils/pvStanding';
import { formatRecordText } from './utils/recordText';
import { useCloudBook } from './hooks/useCloudBook';
import { useCloudRule } from './hooks/useCloudRule';
import { useCloudPv } from './hooks/useCloudPv';
import { CLOUD_BOOK_SITE_NAME, formatCloudBookScore } from './utils/cloudBook';
import {
  NOTATION_STYLES,
  NOTATION_STYLE_DESCRIPTIONS,
  NOTATION_STYLE_LABELS,
  boardBeforeRecord,
  formatLineInStyle,
  formatLineTokensInStyle,
  formatMoveInStyle,
  type XiangqiNotationStyle,
} from './utils/xiangqiNotation';
import { getMovePhaseForRecord, plyOffsetFromRootFen } from './utils/gamePhase';
import { LazyPanelBoundary } from './components/LazyPanelBoundary';
import { QaForcedRenderError } from './components/QaForcedRenderError';
import { PREFERENCES_STORAGE_KEY } from './utils/storageKeys';
import {
  clearStoredPreferences,
  normalizeStoredPreferencesValue,
  readStoredPreferences,
  writeStoredPreferences,
  type AnalysisEngineMode,
  type AssistMode,
  type DeepSearchMode,
  type PvLineCount,
  type StoredPreferences,
} from './utils/preferences';
import { createBoardArrowSelector, type BoardArrow, type BoardSquare } from './utils/boardArrows';
import { readDirectImport } from './utils/directImport';
import { getDialogFocusableElements, keepTabWithin } from './utils/focusTrap';
import {
  createRepetitionAnalyzer,
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
import { DeferredCommandPalette as CommandPaletteModal } from './components/DeferredDialogs';
import type { Command } from './utils/commandPalette';
import { COMMAND_PALETTE_ARIA_KEYSHORTCUTS, commandPaletteShortcutLabel } from './utils/commandPalette';
import {
  extractUciMoveLine,
  hasTooManyUciMoves,
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
  formatReviewProgressDetail,
  formatReviewQualityWithArticle,
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
  type AiStrength,
} from './utils/aiOpponent';

const LazyLibraryPanel = React.lazy(() =>
  import('./components/Library/LibraryPanel').then((module) => ({ default: module.LibraryPanel }))
);

/**
 * The one breakpoint the app has. Written here and read by `matchMedia` so the
 * markup switches on the same condition the stylesheets' mobile queries do;
 * two copies of a breakpoint is two layouts that can be on screen at once.
 *
 * Width alone left the largest phones out when held sideways: 915x412,
 * 926x428 and 932x430 are all past 900, so they got the three-panel desktop
 * in a 430px-tall window, with a third of the board under the bottom bar. A
 * short touch screen up to 960px is a phone on its side, and gets the phone
 * layout; each `(max-width: 900px)` query in the CSS carries the same second
 * condition, and each `(min-width: 901px)` one excludes it.
 */
const MOBILE_LAYOUT_QUERY = '(max-width: 900px), (max-width: 960px) and (max-height: 500px) and (pointer: coarse)';
const NO_OPENING_CANDIDATES: readonly { move: string }[] = [];

export type GameMode = 'PvP' | 'PvAI-Black' | 'PvAI-Red' | 'AIvAI';
type WorkspaceMode = 'play' | 'analysis';
type EngineNotice = { tone: 'warning' | 'danger'; text: string } | null;
type EngineHashFeedback = 'queued' | 'cleared' | null;
type ShareLinkNotice = { tone: 'warning'; text: string; detail: string; positionKey?: string } | null;
type ExportFailureKey = 'copy-pgn' | 'download-pgn' | 'copy-share' | 'copy-fen' | 'copy-record' | `copy-pv-${number}`;

function clearToastTimer(timer: { current: number | null }) {
  if (timer.current !== null) window.clearTimeout(timer.current);
  timer.current = null;
}

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
const THIRD_PARTY_NOTICES_HREF = `${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`;
/** index.html's own title, which the tab returns to between prompts. */
const DOCUMENT_TITLE = 'Web Xiangqi | Pikafish Analysis Board';
const FILE_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
const DEFAULT_LEFT_PANEL_WIDTH = DEFAULT_PANEL_WIDTH;
const DEFAULT_RIGHT_PANEL_WIDTH = DEFAULT_PANEL_WIDTH;
/**
 * Palette labels for the notations, spelled out rather than reusing the
 * settings pills. A pill sits under a heading that says "Move Notation" and
 * beside its two siblings, so "UCI" and "\u4e2d\u6587" are clear enough there. A
 * palette row has none of that: "Write moves in \u4e2d\u6587" is opaque to a
 * reader who does not read Chinese -- which is exactly the reader deciding
 * whether they want it -- and the ranking never surfaced it for "chinese",
 * because that word appeared only in the hint, which put it behind two
 * commands that merely mention Chinese in passing.
 */
const NOTATION_PALETTE_LABELS: Record<XiangqiNotationStyle, string> = {
  uci: 'Write moves in coordinates (UCI)',
  wxf: 'Write moves in WXF letters',
  chinese: 'Write moves in Chinese (\u4e2d\u6587)',
};

/**
 * Words a reader might reach for beyond those labels. A style's description
 * doubles as a haystack while it is not in use, but the in-use one says so
 * instead, and a command should not become harder to find by being the one you
 * are already on.
 */
const NOTATION_STYLE_KEYWORDS: Record<XiangqiNotationStyle, string[]> = {
  uci: ['coordinates', 'engine', 'h2e2', 'uci', 'algebraic'],
  wxf: ['letters', 'wxf', 'federation', 'english', 'c2=5'],
  chinese: ['chinese', 'characters', 'hanzi', '\u4e2d\u6587', '\u70ae\u4e8c\u5e73\u4e94'],
};

const PIECE_SYMBOLS: Record<PieceCode, string> = {
  K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵',
  k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒',
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




function isGameMode(value: unknown): value is GameMode {
  return value === 'PvP' || value === 'PvAI-Black' || value === 'PvAI-Red' || value === 'AIvAI';
}

function isAiGameModeValue(mode: GameMode) {
  return mode !== 'PvP';
}

/**
 * The workspace a newly started game belongs in, or null to leave it alone.
 *
 * An AI game needs the Play workspace and takes it. A local game does not --
 * and this is the half that was missing: starting one after an AI game left
 * the reader in Play with the analysis engine off, no eval bar, no Engine tab
 * and nothing on screen tying that to the AI game they had just left. Every
 * other way of opening a game says which workspace it wants; the New Game
 * menu said so for three of its four options.
 *
 * It gives back only what the app took. A Play workspace the reader chose for
 * themselves -- two people at one board, with the engine quiet, which is what
 * the pill is for -- is left where they put it, because nothing here moved it.
 */
function workspaceForNewGame(nextMode: GameMode, previousMode: GameMode): WorkspaceMode | null {
  if (isAiGameModeValue(nextMode)) return 'play';
  return isAiGameModeValue(previousMode) ? 'analysis' : null;
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

type ReviewController = {
  active: boolean;
  phase: ReviewPhase;
  baseQueue: string[];
  revisitQueue: string[];
  provisionalEvals: Map<string, number>;
  provisionalKinds: Map<string, EvaluationScoreKind | undefined>;
  criticalDecisionSwings: Map<string, number>;
  recommendations: Map<string, Pick<MoveRecord, 'bestMove' | 'bestLine'>>;
  completed: number;
  total: number;
  currentNodeId: string | null;
};

function createReviewController(): ReviewController {
  return {
    active: false,
    phase: 'base',
    baseQueue: [],
    revisitQueue: [],
    provisionalEvals: new Map(),
    provisionalKinds: new Map(),
    criticalDecisionSwings: new Map(),
    recommendations: new Map(),
    completed: 0,
    total: 0,
    currentNodeId: null,
  };
}

function nodeLabel(
  nodeId: string,
  rootNodeId: string,
  treeNodes: ReturnType<typeof useXiangqi>['treeNodes'],
  notationStyle: XiangqiNotationStyle,
  rootFen: string
) {
  return formatBreadcrumbLabel(treeNodes[nodeId]?.record, rootFen, notationStyle, nodeId === rootNodeId);
}

// detectCoarsePointer, detectDeviceScreen and detectSimdSupport now live in
// utils/analysisProfile, beside the tier they feed. They were here while
// useEngine kept a second copy of the same judgement that read the window
// instead of the machine; one of the two had to be the only one.

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

/** Enough to be right about the obvious and quick enough to feel like an answer. */
const HINT_GO_CMD = 'go depth 14 movetime 900';

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


/** Long enough that a fast sequence of moves writes once, not per move. */
const AUTO_SAVE_DEBOUNCE_MS = 600;

function savedResultToGameResult(result: SavedGame['result']): GameResult {
  if (result === 'red') return 'red-wins';
  if (result === 'black') return 'black-wins';
  if (result === 'draw') return 'draw';
  return null;
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
  const [guideDismissed, setGuideDismissed] = useState(() => readStorage(BEGINNER_GUIDE_STORAGE_KEY) === 'true');
  const [gameMode, setGameMode] = useState<GameMode>('PvP');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('analysis');
  const [engineRequested, setEngineRequested] = useState(false);
  const startEngineAnalysis = useCallback(() => {
    setEngineRequested(true);
    setWorkspaceMode('analysis');
  }, []);
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
  const [showRuleLessons, setShowRuleLessons] = useState(false);
  const [practiceStudy, setPracticeStudy] = useState<SavedGame | null>(null);
  const [libraryWritePending, setLibraryWritePending] = useState(false);
  const libraryWritePendingRef = useRef(false);
  const [loadedSavedStudy, setLoadedSavedStudy] = useState<SavedGame | null>(null);
  const [lastSaveWasUpdate, setLastSaveWasUpdate] = useState(false);
  /**
   * The mode a position built by hand should start in, decided when the editor
   * opens rather than read off a dialog's visibility when it closes. It used to
   * be `showNewGameMenu ? pendingGameMode : gameMode`, which made the New Game
   * menu's *being open* the carrier of the reader's choice -- so the menu had
   * to stay open behind the editor, and two `aria-modal` dialogs were on screen
   * at once. A screen reader told to ignore everything outside one dialog has
   * no answer for two, and one Tab out of the editor landed on the close button
   * of the menu hidden behind it. Null means the editor was opened from the
   * palette, where the current game's mode is the right answer.
   */
  const [editorGameMode, setEditorGameMode] = useState<GameMode | null>(null);
  /**
   * The board the editor opens on, when it is not the board on screen.
   *
   * Set only by the "fix this position" route out of a refused FEN. The editor
   * otherwise starts from the current position, which is what someone reaching
   * for it from a game wants.
   */
  const [editorSeed, setEditorSeed] = useState<{ board: BoardState; sideToMove: Side } | null>(null);
  const mobileMoreActionsButtonRef = useRef<HTMLButtonElement | null>(null);

  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const newGameDialogRef = useRef<HTMLDivElement | null>(null);
  const treeBreadcrumbRef = useRef<HTMLDivElement | null>(null);
  const [pendingGameMode, setPendingGameMode] = useState<GameMode>('PvP');
  const [aiStrength, setAiStrength] = useState<AiStrength>(storedPreferences.aiStrength ?? 2);
  const [leftPanelTab, setLeftPanelTab] = useState<'graph' | 'library'>('graph');
  // Keep search choices and revealed pages while the library unmounts. A ref
  // avoids rerendering the board on each keystroke; a fresh page starts clear.
  const libraryViewState = useRef<LibraryViewState | undefined>(undefined);
  const rememberLibraryViewState = useCallback((filters: LibraryViewState) => { libraryViewState.current = filters; }, []);
  const [librarySearchRequest, setLibrarySearchRequest] = useState<LibrarySearchFocusRequest>();
  const handleLibrarySearchFocused = useCallback((request: LibrarySearchFocusRequest) => {
    setLibrarySearchRequest(current => current === request ? undefined : current);
  }, []);
  const [graphLoadSweepToken, setGraphLoadSweepToken] = useState(0);
  const [orientation, setOrientation] = useState<BoardOrientation>(storedPreferences.orientation ?? 'red');
  // WXF is the default because it is the notation both a Chinese record and an
  // English one can be read against, and it needs no font the board does not
  // already load. UCI stays available: it is what the engine says and what a
  // share link carries.
  const [notationStyle, setNotationStyle] = useState<XiangqiNotationStyle>(
    storedPreferences.notationStyle ?? 'wxf'
  );
  // Characters by default: they are the game. Letters are offered for the
  // reader who cannot yet tell 仕 from 士, and they are the WXF letters the
  // move list already uses, so the board teaches the notation.
  const [uiDensity, setUiDensity] = useState<'comfortable' | 'compact'>(storedPreferences.uiDensity ?? 'compact');
  const [pieceStyle, setPieceStyle] = useState<PieceStyle>(storedPreferences.pieceStyle ?? 'traditional');
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
    // Build the audio device while the main thread is free, so the gesture
    // above is left with resume() rather than ~125ms of device startup on the
    // reader's first tap. See prepareSoundEffects.
    const cancelPrepare = prepareSoundEffects();
    return () => {
      cancelPrepare();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      // Sound is off (or the page is going away). Cancelling the prime is not
      // enough once it has run: the device stays open until it is suspended.
      suspendSoundEffects();
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
  const [candidatePickerOpen, setCandidatePickerOpen] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState<CandidateSearch | null>(null);
  const candidateRunRef = useRef(0);
  const candidateActiveKeyRef = useRef('');
  const candidateRequestKeyRef = useRef('');
  const candidateButtonRef = useRef<HTMLButtonElement>(null);
  /**
   * The move the engine would play for the human, when they asked. Cleared on
   * every position change, so a hint is only ever drawn where it was asked.
   */
  const [hintMove, setHintMove] = useState<string | null>(null);
  const [hintPending, setHintPending] = useState(false);
  const [hintUnavailable, setHintUnavailable] = useState(false);
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
    setUiDensity(preferences.uiDensity ?? 'compact');
    setAssistMode(preferences.assistMode ?? 'coach');
    setOrientation(preferences.orientation ?? 'red');
    setShowArrows(preferences.showArrows ?? true);
    updateSoundEnabled(preferences.soundEnabled ?? true);
    setSearchDepth(preferences.searchDepth ?? defaultSearchDepth);
    setAnalysisEngineMode(preferences.analysisEngineMode ?? 'optimized');
    setEngineHashMB(preferences.engineHashMB);
    setEngineThreads(preferences.engineThreads);
    setEnginePvLineCount(preferences.enginePvLineCount ?? 3);
    setAiStrength(preferences.aiStrength ?? 2);
    setNotationStyle(preferences.notationStyle ?? 'wxf');
    setPieceStyle(preferences.pieceStyle ?? 'traditional');
    setDeepSearchMode(preferences.deepSearchMode ?? 'bounded');
    setCloudBookEnabled(preferences.cloudBookEnabled ?? false);
    handleSpeedChange(preferences.aiSpeed ?? 'normal');
  }, [defaultSearchDepth, handleSpeedChange, updateSoundEnabled]);

  const resetPreferences = useCallback(() => {
    clearStoredPreferences();
    setGuideDismissed(false);
    writeStorage(BEGINNER_GUIDE_STORAGE_KEY, 'false');
    applyPreferences({});
  }, [applyPreferences]);

  useEffect(() => {
    writeStoredPreferences({
      uiDensity,
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
      pieceStyle,
      deepSearchMode,
      cloudBookEnabled,
    });
  }, [
    uiDensity,
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
    pieceStyle,
    searchDepth,
    showArrows,
    soundEnabled,
  ]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key === BEGINNER_GUIDE_STORAGE_KEY) {
        setGuideDismissed(event.newValue === 'true');
        return;
      }
      if (event.key === null) setGuideDismissed(false);
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
    gameIdentity,
    gameMetadata,
    setGameMetadata,
    moveCapacityError,
    dismissMoveCapacityError,
    treeNodes,
    moveStructure,
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
    applyUciLineAtNode,
    keepUciLineAtNode,
    setCurrentNodeEval,
    restoreRecordedResult,
    setNodeComment,
    setNodeGlyphs,
    setNodeComments,
    setNodeReviewDataBulk,
    clearReviewData,
    getNodeFen,
    getNodeMoves,
    jumpToMove,
    jumpToNode,
    deleteNode,
    pinActiveStudyLine,
    unpinMainLine,
    openStudyMainLine,
    captureTreeSnapshot,
    restoreDeletedSubtree,
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
      .map((nodeId) => moveStructure[nodeId]?.record?.uci)
      .filter((uci): uci is string => Boolean(uci));
  }, [activeLineNodeIds, currentMoveIndex, moveStructure]);
  const hasMoveTreeMoves = useMemo(() => (
    Boolean(moveStructure[rootNodeId]?.childrenIds.some((childId) => moveStructure[childId]?.record))
  ), [rootNodeId, moveStructure]);
  const hasStudyBranches = useMemo(() => (
    Object.values(moveStructure).some((node) => node.childrenIds.length > 1)
  ), [moveStructure]);
  /**
   * A straight line is stored as a list of moves, which is compact and cannot
   * carry anything else. A note is attached to a move, so a game holding one
   * has to be stored as a tree even when it has no variations -- otherwise the
   * note is written, shown, and silently dropped by the next save. Saved
   * analysis has the same requirement even when the line has no written note.
   */
  const hasAnnotatedStudyMoves = useMemo(() => (
    Object.values(treeNodes).some((node) => Boolean(node.record?.nags?.length || node.record?.recordedResult || node.record?.comment || node.record?.analysis || node.record?.persistEvaluation))
  ), [treeNodes]);
  const currentPositionCommand = useMemo(() => {
    return makeEnginePositionCommand(rootFen, currentLineMoves);
  }, [currentLineMoves, rootFen]);
  const isAiMode = gameMode !== 'PvP';
  const engineEnabled = workspaceMode === 'analysis' && engineRequested;
  const aiPlayActive = workspaceMode === 'play' && isAiMode;
  const isAiTurn =
    aiPlayActive &&
    (gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w'));
  const engineRequired = engineEnabled || aiPlayActive;
  const studyControlsDisabled = isAiTurn && !paused;

  const {
    status: reviewStatus,
    progress: reviewProgress,
    completedSteps: reviewCompletedSteps,
    totalSteps: reviewTotalSteps,
    summary: reviewSummary,
    error: reviewError,
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
  const drillJudgeRef = useRef<(evalScore: number | null, hasExactEvaluation: boolean) => void>(() => {});
  const analysisStageRef = useRef<'idle' | 'primary-pending' | 'primary-complete' | 'deepen-pending' | 'deep-pending' | 'deep-complete' | 'settled'>('idle');
  const analysisDeepenTimerRef = useRef<number | null>(null);
  const activeAnalysisRequestRef = useRef('');
  const currentAnalysisRequestKeyRef = useRef('');
  const hasCurrentDeepResult = useCallback(() => analysisStageRef.current === 'deep-complete'
    && activeAnalysisRequestRef.current === currentAnalysisRequestKeyRef.current, []);
  const currentMultiPvRef = useRef(1);
  const currentShowWdlRef = useRef(false);
  const reviewControllerRef = useRef<ReviewController>(createReviewController());
  const reviewLineSignatureRef = useRef('');
  const engineRecoveryTimestampsRef = useRef<number[]>([]);

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
  const candidateActive = candidateSearch?.requestKey === analysisRequestKey;
  const retainCandidateInBackground = Boolean(candidateActive && (candidateSearch?.completed || candidateSearch?.backgroundAllowed));

  const clearAnalysisDeepenTimer = useCallback(() => {
    if (analysisDeepenTimerRef.current !== null) {
      window.clearTimeout(analysisDeepenTimerRef.current);
      analysisDeepenTimerRef.current = null;
    }
  }, []);

  const resetReviewController = useCallback(() => {
    reviewControllerRef.current = createReviewController();
  }, []);

  const getEffectiveNodeEval = useCallback((nodeId: string | null) => {
    if (!nodeId) return undefined;
    const provisional = reviewControllerRef.current.provisionalEvals.get(nodeId);
    if (typeof provisional === 'number') {
      return provisional;
    }
    return treeNodes[nodeId]?.record?.evalScore;
  }, [treeNodes]);

  const finalizeReview = useCallback(() => {
    const controller = reviewControllerRef.current;
    // Keep all in-flight results private until the entire line is reviewed.
    // Cancel/error must not leave mixed-depth scores or erase study annotations.
    const reviewedTree = { ...treeNodes };
    for (const nodeId of activeLineNodeIds) {
      const node = treeNodes[nodeId];
      if (node?.record) reviewedTree[nodeId] = { ...node, record: {
        ...node.record,
        evalScoreKind: controller.provisionalKinds.get(nodeId),
        bestMove: controller.recommendations.get(nodeId)?.bestMove,
        bestLine: controller.recommendations.get(nodeId)?.bestLine,
      } };
    }
    const reviewedAt = Date.now();
    const { summary, annotations } = computeReviewArtifacts(
      activeLineNodeIds,
      reviewedTree,
      controller.provisionalEvals,
      reviewedAt,
      reviewEngineSummary,
      controller.provisionalKinds,
    );
    setNodeReviewDataBulk(annotations, { replaceRecommendations: true });
    resetReviewController();
    completeReview(summary);
    setReviewedLineNodeIds(activeLineNodeIds);
    setAnalysisTab('review');
    setMobileAnalysisTab('review');
  }, [activeLineNodeIds, completeReview, resetReviewController, reviewEngineSummary, setNodeReviewDataBulk, treeNodes]);

  const handleEngineWorkerError = useCallback((message: string) => {
    const now = Date.now();
    engineRecoveryTimestampsRef.current = [
      ...engineRecoveryTimestampsRef.current.filter((timestamp) => now - timestamp < 15000),
      now,
    ];

    applyBestMoveRef.current = false;
    activeAnalysisRequestRef.current = '';
    analysisStageRef.current = 'idle';
    clearAnalysisDeepenTimer();

    if (reviewControllerRef.current.active) {
      resetReviewController();
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
  }, [cancelReview, clearAnalysisDeepenTimer, resetReviewController, restartEngine, workspaceMode]);

  const engineBootKey = `${engineRestartToken}:${engineBootConfig.variant}:${engineBootConfig.allowSIMD}:${engineBootConfig.threads}:${engineBootConfig.hashMB}`;
  useEffect(() => {
    // A replacement worker cannot finish the review search its predecessor
    // owned. Drop provisional work before the new engine starts; otherwise
    // currentNodeId keeps the review waiting forever for the terminated search.
    if (!reviewControllerRef.current.active) return;
    reviewLineSignatureRef.current = '';
    resetReviewController();
    cancelReview('Review stopped because the engine restarted. Existing scores were kept. Try reviewing again.');
  }, [engineBootKey, cancelReview, resetReviewController]);

  const reportEngineWorkerError = useEngineErrorRecovery(
    handleEngineWorkerError,
    engineRequired,
    engineBootKey,
  );

  const {
    isReady,
    readySessionId,
    engineName,
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
    telemetry,
    pvLines,
    getLatestPvLines,
    assetProgress,
  } = useEngine({
    enabled: engineRequired,
    restartToken: engineRestartToken,
    variant: engineBootConfig.variant,
    allowSIMD: engineBootConfig.allowSIMD,
    threads: engineBootConfig.threads,
    hashMB: engineBootConfig.hashMB,
    captureInfoLines: assistMode === 'pro' && analysisTab === 'engine',
    onWorkerError: reportEngineWorkerError,
    onBestMove: (uci, score, searchTag, completedPvLines, hasEvaluation, hasExactEvaluation, scoreKind) => {
      const reviewTag = parseReviewTag(searchTag);
      if (reviewTag && reviewControllerRef.current.active) {
        const controller = reviewControllerRef.current;
        if (controller.currentNodeId !== reviewTag.nodeId) {
          return;
        }
        // Grade only the retained exact reading. The latest PV can be a
        // deeper bound even when the search already supplied an exact score.
        if (!hasExactEvaluation) {
          resetReviewController();
          cancelReview(`Review stopped: the engine returned ${hasEvaluation ? 'only a score bound' : 'no evaluation'}. Existing scores were kept. Try reviewing again.`);
          return;
        }

        controller.currentNodeId = null;
        const normalizedScore = normalizeEvalForFen(score, getNodeFen(reviewTag.nodeId));
        controller.provisionalEvals.set(reviewTag.nodeId, normalizedScore);
        controller.provisionalKinds.set(reviewTag.nodeId, scoreKind);

        // Store engine's recommended move for the child node that was actually played
        // so the coach UI can show "Engine suggests X" when a move was a mistake/blunder
        if (uci) {
          const childNodeId = treeNodes[reviewTag.nodeId]?.childrenIds
            .find(cid => activeLineNodeIds.includes(cid));
          // The principal variation arrives with `bestmove` and starts with it,
          // so the line the engine would have played on costs nothing extra to
          // keep -- and without it the review can say which move was better and
          // never what it was for.
          if (childNodeId) controller.recommendations.set(childNodeId, { bestMove: uci, bestLine: completedPvLines[0]?.moves });
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
        if (hintTag.positionCommand !== currentPositionCommand || !aiPlayActive || isAiTurn || gameResult) return;
        // A completed search can have no move, or a move that cannot be played
        // on this board. Explain that result instead of silently removing the
        // thinking message or recommending an illegal move.
        const validHint = Boolean(uci) && validateMoveStr(uci, board, sideToMove).ok;
        setHintMove(validHint ? uci : null);
        setHintUnavailable(!validHint);
        return;
      }

      const aiTag = parseAiTag(searchTag);
      if (aiTag) {
        const shouldApplyAiMove =
          applyBestMoveRef.current &&
          !pausedRef.current &&
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

      const candidateTag = parseCandidateTag(searchTag);
      if (candidateTag) {
        if (candidateTag === candidateActiveKeyRef.current && candidateRequestKeyRef.current === currentAnalysisRequestKeyRef.current) {
          setCandidateSearch(previous => previous?.key === candidateTag ? { ...previous, completed: true } : previous);
          setDeepDiveActive(false);
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

      if (hasExactEvaluation && currentMoveIndex >= 0 && reviewStatus !== 'done') {
        setCurrentNodeEval(normalizeEvalForSide(score, sideToMove), scoreKind);
      }
      drillJudgeRef.current(hasEvaluation ? normalizeEvalForSide(score, sideToMove) : null, hasExactEvaluation);

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
        analysisStageRef.current = analysisTag.phase === 'deep' ? 'deep-complete' : 'settled';
      }
    },
  });

  useEffect(() => {
    if (!readySessionId) return;
    // The replacement starts with UCI defaults even if React never rendered
    // isReady=false. Invalidate old analysis before options/search effects run.
    currentMultiPvRef.current = 1;
    currentShowWdlRef.current = false;
    activeAnalysisRequestRef.current = '';
    analysisStageRef.current = 'idle';
    setDeepDiveActive(false);
  }, [readySessionId, setDeepDiveActive]);

  useEffect(() => {
    if (!isReady) return;
    setEngineNotice(engineSafetyBootLevel > 0
      ? { tone: 'warning', text: 'Safe engine mode' }
      : null
    );
  }, [engineSafetyBootLevel, isReady, readySessionId]);

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
    () => makeReviewLineSignature(activeLineNodeIds, moveStructure),
    [activeLineNodeIds, moveStructure]
  );
  const shareNoticePositionKey = useMemo(
    () => `${rootFen}::${currentLineSignature}`,
    [currentLineSignature, rootFen]
  );

  const rightPanelOpen = rightWidth > 0;
  const moveTreeVisible = isMobile
    ? mobileView === 'analysis' && mobileAnalysisTab === 'moves'
    : rightPanelOpen;
  const breadcrumbVisible = moveTreeVisible && analysisTab === 'tree';
  // The hook already maintains this ordered path. Reuse it instead of walking
  // parents and prepending every node; hidden panels need no breadcrumb list.
  const breadcrumbNodeIds = useMemo(() => breadcrumbVisible
    ? [rootNodeId, ...activeLineNodeIds.slice(0, currentMoveIndex + 1)]
    : [], [activeLineNodeIds, breadcrumbVisible, currentMoveIndex, rootNodeId]);

  useEffect(() => {
    const container = treeBreadcrumbRef.current;
    const active = container?.querySelector('.tree-breadcrumb-chip-active') as HTMLElement | null;
    if (!container || !active) return;

    const centerActive = (resized = false) => {
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
      const behavior: ScrollBehavior = resized || prefersReducedMotion || !activeFullyVisible || distance > container.clientWidth
        ? 'auto'
        : 'smooth';
      if (distance > 1) container.scrollTo({ left: targetLeft, behavior });
    };
    centerActive();
    // Reopening initially sees a collapsed panel width. Recenter as it grows,
    // and when enlarged text changes the active chip's dimensions.
    const observer = new ResizeObserver(() => centerActive(true));
    observer.observe(container);
    observer.observe(active);
    return () => observer.disconnect();
  }, [breadcrumbNodeIds.length, currentNodeId, breadcrumbVisible]);

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
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isComposingKey(event.nativeEvent)) return;
    const strip = treeBreadcrumbRef.current;
    const next = rovingIndexForKey(event.key, strip?.childElementCount ?? 0, index);
    if (next === null) return;
    event.preventDefault();
    setRovingBreadcrumbIndex(next);
    const target = strip?.querySelector<HTMLButtonElement>(`[data-breadcrumb-index="${next}"]`);
    target?.focus();
  }, []);

  const graphBranchCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    activeLineNodeIds.forEach((nodeId, idx) => {
      const children = moveStructure[nodeId]?.childrenIds.length ?? 0;
      if (children > 1) {
        counts[idx] = children;
      }
    });
    return counts;
  }, [activeLineNodeIds, moveStructure]);

  const rootGraphBranchCount = moveStructure[rootNodeId]?.childrenIds.length ?? 0;
  const leftPanelOpen = leftWidth > 0;
  // Match the responsive panel visibility so a hidden chart does not keep
  // rebuilding its SVG or observing layout on every live engine score.
  const graphVisible = isMobile
    ? mobileView === 'analysis' && mobileAnalysisTab === 'graph'
    : leftPanelOpen;
  const cloudPanelVisible = isPageVisible && graphVisible && leftPanelTab === 'graph';

  // Sync panel width state → CSS custom property (used for smooth drag via direct DOM updates)
  //
  // Layout effects, not ordinary ones: `.panel.left` falls back to `320px`
  // until the property exists, and `.panel` transitions its width. An ordinary
  // effect runs after the first paint, so the panel was painted at 320px and
  // then animated to the width it should have opened at -- a 220ms slide on
  // every load, and a 320px one under 1280px where the graph panel now opens
  // collapsed. A layout effect runs before that paint, so the first frame is
  // already right and there is nothing to animate away from.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--left-panel-w', leftWidth + 'px');
  }, [leftWidth]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--right-panel-w', rightWidth + 'px');
  }, [rightWidth]);

  // ...and the transition itself is for a reader dragging a panel, not for the
  // first paint. `.panel.left` falls back to 320px until the property above
  // exists, and the panels mount inside a lazy boundary, so the width the
  // window actually calls for arrived as a 220ms slide on every load -- 320px
  // to 0 under 1280px, where the graph panel opens collapsed, and 320 to 266 on
  // the other side at 1024. Measured with a `transitionstart` listener: both
  // panels animated their width ~790ms into the load. Turn the transition on a
  // frame after the first paint, once the real widths are on screen.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.documentElement.setAttribute('data-panels-ready', '');
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const stopAnalysis = useCallback(() => {
    applyBestMoveRef.current = false;
    activeAnalysisRequestRef.current = '';
    analysisStageRef.current = 'idle';
    clearAnalysisDeepenTimer();
    clearQueuedSearch();
    stopSearch();
  }, [clearAnalysisDeepenTimer, clearQueuedSearch, stopSearch]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    stepPendingRef.current = false;
    setPaused(true);
    // UCI stop can return a playable bestmove. Revoke permission before
    // stopping the opponent so that response cannot move the paused board.
    if (isAiTurn) stopAnalysis();
  }, [isAiTurn, stopAnalysis]);

  const handleCancelReview = useCallback(() => {
    reviewLineSignatureRef.current = '';
    reviewControllerRef.current.active = false;
    reviewControllerRef.current.currentNodeId = null;
    resetReviewController();
    cancelReview();
    clearQueuedSearch();
    stopSearch();
  }, [cancelReview, clearQueuedSearch, resetReviewController, stopSearch]);

  const clearCompletedReview = useCallback(() => {
    reviewLineSignatureRef.current = '';
    reviewControllerRef.current.active = false;
    reviewControllerRef.current.currentNodeId = null;
    resetReviewController();
    clearReviewData(reviewedLineNodeIds);
    resetReview();
  }, [clearReviewData, resetReview, resetReviewController, reviewedLineNodeIds]);

  const checkpointBeforeReplaceRef = useRef<() => boolean>(() => true);

  const resetGame = useCallback(() => {
    if (!checkpointBeforeReplaceRef.current()) return;
    setLoadedSavedStudy(null);
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
  const reviewMatchesActiveLine = Boolean(reviewSummary) && reviewSummary?.lineSignature === currentLineSignature;
  /**
   * A finished review that a save will not carry.
   *
   * `currentGameSnapshot` attaches the review only while the board is on the
   * line it describes -- a review of one line stored beside the moves of
   * another would be read back onto the wrong moves. The moves themselves do
   * survive, in the serialized tree. Worth saying rather than leaving the
   * reader to discover it when they load the game back and the figures are
   * gone.
   */
  const savingWouldDropTheReview = reviewStatus === 'done' && Boolean(reviewSummary) && !reviewMatchesActiveLine;
  /**
   * The records the review's figures are read off. The active line while the
   * board is on it, and the reviewed line itself once the reader has stepped
   * into a variation -- the accuracy by phase, the narrative and the saved
   * annotations all describe the game that was reviewed, not the sideline.
   */
  const reviewedHistory = useMemo(() => {
    if (!reviewSummary || reviewMatchesActiveLine) return moveHistory;
    return reviewedLineNodeIds
      .map((nodeId) => treeNodes[nodeId]?.record)
      .filter((record): record is MoveRecord => Boolean(record));
  }, [moveHistory, reviewMatchesActiveLine, reviewSummary, reviewedLineNodeIds, treeNodes]);

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
      if (isComposingKey(event)) return;
      // Command/Control+K, the near-universal palette binding and the only
      // chord this app claims. Handled before anything else so it works from a
      // text field too, which is where a reader often is when they reach for it.
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (event.repeat) return;
        // A second modal would sit behind the editor/settings while stealing
        // keyboard input. Finish the current dialog before opening commands.
        const activeDialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        if (activeDialog && !activeDialog.closest('[data-command-palette]')) return;
        setShowCommandPalette((open) => !open);
        return;
      }
      if (event.key === 'Escape' && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
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
      if (!visible && (deepDiveActiveRef.current || hasCurrentDeepResult())) return;
      // A review is started by hand for the same reason, and it used to be
      // the odd one out: hiding the tab stopped the search it was on -- so
      // that one node was graded shallow -- while the nodes after it were
      // searched in full, in the background, because nothing paused the
      // pass itself. Either the whole review pauses or none of it does, and
      // a reader who started a thirty-second review and switched tabs
      // expects it finished, not one move worse.
      if (!visible && reviewControllerRef.current.active) return;
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
  }, [clearAnalysisDeepenTimer, clearQueuedSearch, hasCurrentDeepResult, stopSearch]);

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
    let initialFocusPlaced = false;
    const focusInitial = () => {
      if (initialFocusPlaced) return;
      if (activeDialog.contains(document.activeElement)) { initialFocusPlaced = true; return; }
      const firstFocusable = getDialogFocusableElements(activeDialog)[0];
      (firstFocusable ?? activeDialog).focus({ preventScroll: true });
      // Retry only a focus attempt that failed, for example while the page's
      // inert state settles. A later disabled action can legitimately blur to
      // body; an initial-focus retry must not take over that interaction.
      initialFocusPlaced = activeDialog.contains(document.activeElement);
    };

    focusInitial();
    const frame = window.requestAnimationFrame(focusInitial);
    const retryTimer = window.setTimeout(focusInitial, 80);
    const onDialogKeyDown = (event: KeyboardEvent) => keepTabWithin(activeDialog, event);

    document.addEventListener('keydown', onDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retryTimer);
      document.removeEventListener('keydown', onDialogKeyDown);
      // Never `body`: inerting the page behind a dialog blurs the launcher, so
      // this can have captured `body`, and focusing it would undo the give-back
      // the inert effect already did.
      if (previouslyFocused && previouslyFocused !== document.body && document.contains(previouslyFocused)) {
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
        : candidateActive ? candidateSearch!.moves.length : analysisMultiPv;
    const showWdl = engineDetailEnabled && analysisWdlEnabled && !candidateActive;

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
  }, [aiSearchConfig.multiPv, analysisMultiPv, analysisWdlEnabled, candidateActive, candidateSearch, clearPvLines, clearWdl, engineDetailEnabled, engineRequired, isAiTurn, isReady, readySessionId, reviewStatus, setOption, trimPvLines]);

  // Analysis engine effect
  useEffect(() => {
    // Before the teardown below, which is what would otherwise stop the deep
    // search this effect re-runs for: hiding the tab flips `isPageVisible`, and
    // the teardown clears the stage the search is holding. Coming back finds
    // the stage still `deep-pending` and queues nothing, which is the same
    // thing that happens when the tab was never hidden at all.
    // Completed manual analysis is still useful when returning to this exact
    // request. Engine shutdown, review, and navigation invalidate it normally.
    const retainDeepResult = engineEnabled && isReady && !isAiTurn
      && !reviewControllerRef.current.active && hasCurrentDeepResult();
    if (!isPageVisible && (deepDiveActiveRef.current || retainCandidateInBackground || retainDeepResult)) return;
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
    if (threatActive || candidateActive) return;

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
    candidateActive,
    retainCandidateInBackground,
    hasCurrentDeepResult,
    readySessionId,
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
      threatActive || candidateActive ||
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
    candidateActive,
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
  }, [aiSearchConfig, aiSpeed, aiStrength, currentPositionCommand, gameResult, isAiTurn, isPageVisible, isReady, readySessionId, isSearchQueued, isSearching, paused, queueSearch, reviewStatus]);

  // Completed steps also drive this effect: an instant bestmove can batch
  // searching -> idle into one render, leaving both engine flags unchanged.
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
  }, [finalizeReview, getNodeMoves, isReady, readySessionId, isSearchQueued, isSearching, queueSearch, reviewPolicy.base.goCmd, reviewPolicy.revisit, reviewPolicy.revisitLimit, reviewRevisitGoCmd, reviewCompletedSteps, reviewStatus, rootFen, updateReviewProgress]);

  const startGameReview = useCallback(() => {
    if (applyBestMoveRef.current) return;
    if (!engineEnabled || !isReady || reviewControllerRef.current.active) return;
    if (isAiMode) {
      stepPendingRef.current = false;
      pausedRef.current = true;
      setPaused(true);
    }
    stopAnalysis();
    resetReviewController();
    clearPvLines();
    clearWdl();
    currentMultiPvRef.current = 1;
    currentShowWdlRef.current = false;
    setOption('MultiPV', 1);
    setOption('UCI_ShowWDL', false);
    setAnalysisTab('review');
    setMobileAnalysisTab('review');
    setMobileView('analysis');
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
  }, [activeLineNodeIds, applyBestMoveRef, clearPvLines, clearWdl, completeReview, currentLineSignature, engineEnabled, isAiMode, isReady, resetReviewController, reviewEngineSummary, rootNodeId, setOption, startReview, stopAnalysis, treeNodes]);

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
      } else if (!selected && Boolean(board[rank]?.[file]) && pieceSide(board[rank]?.[file] || '') !== sideToMove) {
        /**
         * Picking up the other side's piece, which the board cannot do and
         * used to answer with nothing at all.
         *
         * Every other refusal on this board says why: a piece that cannot
         * reach a square, a move that leaves the general in check, a general
         * facing its opposite. This one -- the commonest mistake a beginner
         * makes, and the one that looks most like the board being broken --
         * selected nothing, drew nothing and said nothing. The sentence is
         * already written for the case where a piece *is* selected; it just
         * never reached the case where none is.
         *
         * An empty square is still silent. Tapping the board where there is
         * nothing is not a mistake and does not need answering.
         */
        //
        // Coach mode answers the question behind the tap as well. A learner
        // reaching for the other side's horse wants to know what a horse does,
        // and the hint line already says exactly that for a piece of their own
        // -- same table, same `·`, so the two taps teach the same way. Pro mode
        // gets the bare sentence; it did not ask to be taught.
        //
        // The reason comes first and the lesson second, which is the opposite
        // of the order the line uses for a piece of your own. This line is
        // `-webkit-line-clamp: 2`, and at 320px with 200% text two lines hold
        // about fifty characters -- so whichever half is second is the half a
        // reader with large text does not get. The answer to "why did nothing
        // happen" is not the half to lose.
        const reached = board[rank]?.[file] || '';
        const lesson = assistMode === 'coach' && isPieceCode(reached) ? ` · ${PIECE_MOVE_HINTS[reached]}` : '';
        showMoveRuleHint(`${formatMoveRuleHint('not your piece')}${lesson}`);
      } else if (
        !selected ||
        (selected.file === file && selected.rank === rank) ||
        pieceSide(board[rank]?.[file] || '') === sideToMove
      ) {
        clearMoveRuleHint();
      }
    }
  }, [assistMode, board, clearBoardMarkers, clearMoveRuleHint, gameResult, isAiTurn, onSquareClick, selected, showMoveRuleHint, sideToMove, validTargets]);

  const handleCancelBoardSelection = useCallback(() => {
    if (!selected) return;
    onSquareClick(selected.file, selected.rank);
    clearMoveRuleHint();
  }, [clearMoveRuleHint, onSquareClick, selected]);

  const applyMode = useCallback((mode: GameMode) => {
    const nextWorkspace = workspaceForNewGame(mode, gameMode);
    if (nextWorkspace) setWorkspaceMode(nextWorkspace);
    setGameMode(mode);
    const facing = orientationForHuman(mode);
    if (facing) setOrientation(facing);
    resetGame();
  }, [gameMode, resetGame]);

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
    if (!checkpointBeforeReplaceRef.current()) return;
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    setPaused(false);
    // The mode names the *engine's* side, so the human gets the other one.
    setGameMode(sideToMove === 'w' ? 'PvAI-Black' : 'PvAI-Red');
    setOrientation(sideToMove === 'w' ? 'red' : 'black');
    setWorkspaceMode('play');
    setLoadedSavedStudy(null);
    loadMoves(currentLineMoves, rootFen, undefined, treeNodes[rootNodeId]?.comment);
    setGameMetadata(gameMetadata);
    setGraphLoadSweepToken((token) => token + 1);
    setMobileView('board');
  }, [currentLineMoves, gameMetadata, setGameMetadata, handleCancelReview, loadMoves, resetReview, rootFen, rootNodeId, treeNodes, sideToMove, stopAnalysis]);

  const showBeginnerGuide = !guideDismissed && assistMode === 'coach' && gameMode === 'PvP'
    && moveHistory.length === 0 && rootFen === START_POSITION_FEN;


  const openGraphPanel = useCallback(() => {
    setShowMobileBoardActionMenu(false);
    setLeftWidth((width) => width === 0 ? initialPanelWidth(DEFAULT_LEFT_PANEL_WIDTH) : width);
    setLeftPanelTab('graph');
    setMobileAnalysisTab('graph');
    setMobileView('analysis');
  }, []);

  const openLibraryPanel = useCallback(() => {
    setShowMobileBoardActionMenu(false);
    setLeftWidth((width) => width === 0 ? initialPanelWidth(DEFAULT_LEFT_PANEL_WIDTH) : width);
    setLeftPanelTab('library');
    setMobileAnalysisTab('library');
    setMobileView('analysis');
  }, []);

  useEffect(() => {
    if (leftPanelTab !== 'library' || (isMobile && (mobileView !== 'analysis' || mobileAnalysisTab !== 'library'))) {
      setLibrarySearchRequest(undefined);
    }
  }, [leftPanelTab, isMobile, mobileView, mobileAnalysisTab]);

  const openAnalysisPanel = useCallback((tab: 'tree' | 'review' | 'engine') => {
    setShowMobileBoardActionMenu(false);
    setRightWidth(width => width === 0 ? initialPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH) : width);
    setAnalysisTab(tab);
    setMobileAnalysisTab(tab === 'tree' ? 'moves' : tab);
    setMobileView('analysis');
  }, []);

  const adjustLeftPanelWidth = useCallback((delta: number) => {
    setLeftWidth((width) => stepPanelWidth(width, delta, initialPanelWidth(DEFAULT_LEFT_PANEL_WIDTH)));
  }, []);

  const adjustRightPanelWidth = useCallback((delta: number) => {
    setRightWidth((width) => stepPanelWidth(width, delta, initialPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH)));
  }, []);

  // The tab strips announce role="tablist"; arrow, Home and End keys are part of
  // that contract. Activating on focus is fine here — switching a panel is cheap
  // and reversible. Claiming the key also keeps it from reaching the global move
  // shortcuts while a tab has focus.
  const handleTablistKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isComposingKey(event.nativeEvent)) return;
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
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isComposingKey(event.nativeEvent)) return;
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
      setLeftWidth(initialPanelWidth(DEFAULT_LEFT_PANEL_WIDTH));
    }
  }, [adjustLeftPanelWidth]);

  const handleRightResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isComposingKey(event.nativeEvent)) return;
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
      setRightWidth(initialPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH));
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
  const candidatePvLines = useMemo(() => {
    if (!engineEnabled || !candidateActive || !candidateSearch) return [];
    return pvLines.filter(pv => parseCandidateTag(pv.searchTag) === candidateSearch.key && candidateSearch.moves.includes(pv.moves[0]));
  }, [candidateActive, candidateSearch, engineEnabled, pvLines]);
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
  const topAnalysisPv = currentAnalysisPvLines[0] ?? null;
  const canPlayBestMove = engineEnabled && !isAiTurn && !gameResult && Boolean(topAnalysisPv?.moves[0]);
  const analysisForLine = useCallback((moves: string[]) => {
    const lines = candidateActive ? candidatePvLines : currentAnalysisPvLines;
    const rendered = lines.find(line => line.moves.length === moves.length && line.moves.every((move, i) => move === moves[i]));
    if (!rendered) return undefined;
    const pv = getLatestPvLines().find(line => line.searchTag === rendered.searchTag && line.moves.length === moves.length && line.moves.every((move, i) => move === moves[i])) ?? rendered;
    return captureStudyAnalysis(pv, sideToMove, currentPositionCommand, {
      name: engineName || 'Pikafish (version not reported)', variant: engineVariant,
      threads: engineVariant.startsWith('single') ? 1 : engineBootConfig.threads, hashMB: engineBootConfig.hashMB,
    }, candidateActive ? candidateSearch!.moves.length : analysisMultiPv, candidateActive ? candidateSearch!.moves : undefined);
  }, [getLatestPvLines, analysisMultiPv, candidateActive, candidatePvLines, candidateSearch, currentAnalysisPvLines, currentPositionCommand,
    engineBootConfig.hashMB, engineBootConfig.threads, engineName, engineVariant, sideToMove]);
  const isAnalysisLineKept = useCallback((moves: string[]) => {
    if (!hasMoveTreeLine(treeNodes, currentNodeId, moves)) return false;
    const first = treeNodes[currentNodeId]?.childrenIds.find(id => treeNodes[id]?.record?.uci === moves[0]);
    return sameStudyAnalysis(first ? treeNodes[first]?.record?.analysis : undefined, analysisForLine(moves));
  }, [analysisForLine, currentNodeId, treeNodes]);
  const canKeepBestLine = isReady && canPlayBestMove && reviewStatus !== 'running' && !isAnalysisLineKept(topAnalysisPv?.moves ?? []);
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
  const displayEvalScoreKind = liveEvalScore === null ? undefined
    : evaluationKindOverride(liveEvalScore, currentAnalysisPvLines[0]?.scoreStr.includes('M') ? 'mate' : 'cp');
  // Use the same position-tagged PV as the evaluation. An old search may emit
  // WDL after navigation has cleared the bar, and an untagged reading would
  // assign its chances to the new side. This also keeps WDL consistent when an
  // exact PV is retained over a later bounded score.
  const displayWdl = useMemo(
    () => (threatActive || candidateActive ? null : normalizeWdlForSide(topAnalysisPv?.wdl ?? null, sideToMove)),
    [candidateActive, sideToMove, threatActive, topAnalysisPv]
  );
  const shouldShowWdlBar = engineEnabled && !candidateActive && (engineDetailEnabled || displayWdl !== null);
  const currentEvalText = topAnalysisPv
    ? formatRedPovEngineScore(topAnalysisPv, sideToMove)
    : null;
  const redPerspectiveEvalText = currentEvalText ? `Red POV ${currentEvalText}` : null;
  const displayEvalBound = normalizeScoreBoundForSide(topAnalysisPv?.bound, sideToMove);
  const displayEvalBoundText = topAnalysisPv?.bounded
    ? `${displayEvalBound === 'lower' ? 'Lower bound' : displayEvalBound === 'upper' ? 'Upper bound' : 'Bound'}, not an exact score`
    : undefined;
  // The bar and the phone's chip read the live line, and there is not always
  // one: a mated position has none (the engine answers `score mate 0` with no
  // pv, and a moveless line is dropped), and a finished review leaves the
  // engine idle. Either way the bar sat at a dimmed 50/50 reading "—" beside
  // a graph and a Current card that already had this position's score. With
  // no live line, fall back to that stored reading -- the same one they show.
  // Not while comparing candidates or showing a threat: those pause the
  // position's reading on purpose, and "—" is what says so.
  const currentNodeRecord = treeNodes[currentNodeId]?.record;
  const storedEvalScore = !topAnalysisPv && !candidateActive && !threatActive
    && typeof currentNodeRecord?.evalScore === 'number'
    ? currentNodeRecord.evalScore : null;
  const evalBarScore = displayEvalScore ?? storedEvalScore;
  const evalBarText = currentEvalText
    ?? (storedEvalScore === null ? null : formatEvaluationText(storedEvalScore, 1, currentNodeRecord?.evalScoreKind));
  const liveEvalLabel = currentEvalText
    ? `Live engine evaluation, ${redPerspectiveEvalText}${displayEvalBoundText ? `, ${displayEvalBoundText}` : ''}`
    : evalBarText ? `Engine evaluation, Red POV ${evalBarText}` : undefined;
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
  // AI play needs the same engine download while live analysis stays off.
  const mobileEngineLoading = engineRequired && !isReady && (!engineEnabled || displayEvalScore === null);

  const displayEvalClass = evalBarScore === null
    ? ''
    : evalBarScore > 0
      ? 'eval-positive'
      : evalBarScore < 0
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
  const rootBoardSnapshot = useMemo(() => {
    try {
      return parseFenBoard(rootFen.split(/\s+/)[0]);
    } catch {
      return parseFenBoard(START_FEN);
    }
  }, [rootFen]);
  const materialSummary = useMemo(
    () => summarizeMaterial(board, rootBoardSnapshot),
    [board, rootBoardSnapshot]
  );

  const materialText = materialSummary.deltaTenths > 0
    ? `Red +${formatMaterialValue(materialSummary.deltaTenths)}`
    : materialSummary.deltaTenths < 0
      ? `Black +${formatMaterialValue(Math.abs(materialSummary.deltaTenths))}`
      // The card is already labelled Material; repeating the word here made the
      // level case read differently from "Red +1.4" for no reason.
      : 'Even';
  const rootComment = treeNodes[rootNodeId]?.comment;
  const rootResult = treeNodes[rootNodeId]?.recordedResult;
  const selectedRecordedResult = treeNodes[currentNodeId]?.record?.recordedResult ?? (currentNodeId === rootNodeId ? rootResult : undefined);
  const lineRecordedResult = activeLineNodeIds.length ? treeNodes[activeLineNodeIds.at(-1)!]?.record?.recordedResult : rootResult;
  const mainLinePinned = treeNodes[rootNodeId]?.mainLinePinned;
  const studyMainLineNodeIds = useMemo(() => mainLinePinned ? getStudyMainLine(moveStructure, rootNodeId) : [], [mainLinePinned, moveStructure, rootNodeId]);
  const viewingStudyMainLine = Boolean(mainLinePinned) && activeLineNodeIds.length === studyMainLineNodeIds.length
    && activeLineNodeIds.every((id, index) => id === studyMainLineNodeIds[index]);
  const canPinStudyMainLine = hasMoveTreeMoves && !studyControlsDisabled && !viewingStudyMainLine;
  const hasGameMetadata = Boolean(normalizeGameMetadata(gameMetadata));
  const canSaveCurrentPosition = !libraryWritePending && (moveHistory.length > 0 || rootFen !== START_POSITION_FEN || hasMoveTreeMoves || Boolean(rootComment || rootResult) || hasGameMetadata);
  const canShareCurrentPosition = (currentMoveIndex >= 0 && moveHistory.length > 0) || hasMoveTreeMoves || Boolean(rootComment || rootResult) || rootFen !== START_POSITION_FEN;
  const canExportCurrentLine = canShareCurrentPosition || hasGameMetadata;
  // A finished game has nothing to play on from, and the starting position is
  // already what "New game" gives you.
  const canPlayFromHere = !gameResult && (currentMoveIndex >= 0 || rootFen !== START_POSITION_FEN);


  const gameOverKey = gameResult ? `${gameResult}:${currentFen}:${moveHistory.length}` : null;
  const [dismissedGameOverKey, setDismissedGameOverKey] = useState<string | null>(null);
  const visibleGameResult = gameResult && gameOverKey !== dismissedGameOverKey ? gameResult : null;
  // The tab's title was fixed, so a game against the engine left in a
  // background tab never said the engine had replied, or that the game had
  // ended. Lead with what wants the reader back; the name stays after it.
  useEffect(() => {
    const prefix = gameResult === 'draw' ? 'Draw'
      : gameResult === 'red-wins' ? 'Red wins'
        : gameResult === 'black-wins' ? 'Black wins'
          : aiPlayActive && gameMode !== 'AIvAI' && !isAiTurn ? 'Your move'
            : null;
    document.title = prefix ? `${prefix} · ${DOCUMENT_TITLE}` : DOCUMENT_TITLE;
  }, [aiPlayActive, gameMode, gameResult, isAiTurn]);
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
    reviewRunning: reviewStatus === 'running',
    isSearchQueued,
    isSearching,
  });
  const analysisIsStalled = isAnalysisActivityStalled(analysisActivity);
  // A boot failure has a message of its own and it is more specific than
  // "Loading engine", so it still wins that slot.
  const bottomEngineStatus = !isReady
    ? engineNotice?.text ?? formatAnalysisActivity(analysisActivity)
    : formatAnalysisActivity(analysisActivity);
  const engineRecoveryNotice = !isReady ? engineNotice : null;
  const engineRecoveryHint = engineRecoveryNotice?.tone === 'danger'
    ? 'Select Restart to try again.'
    : 'Analysis resumes when the engine is ready.';
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
    const record = moveStructure[nodeId]?.record;
    const before = record ? boardBeforeRecord(record) : null;
    return before ? formatMoveInStyle(before, uci, notationStyle) : formatUciMove(uci);
  }, [notationStyle, moveStructure]);

  /**
   * The engine's line from the position before a move, in the reader's
   * notation. Every move after the first needs the board the one before it
   * left, which is what `formatLineInStyle` walks -- a per-move formatter
   * cannot do this, since it only ever has one board.
   */
  const formatReviewLineText = useCallback((nodeId: string, moves: string[]) => {
    if (notationStyle === 'uci') return moves.map((uci) => formatUciMove(uci)).join(' ');
    const record = moveStructure[nodeId]?.record;
    const before = record ? boardBeforeRecord(record) : null;
    if (!before) return moves.map((uci) => formatUciMove(uci)).join(' ');
    return formatLineInStyle(before, moves, notationStyle, moves.length);
  }, [notationStyle, moveStructure]);

  /**
   * Whether this position has stood here before, and what the rules say about
   * how it got back.
   *
   * Read off the played line rather than the whole tree: a repetition is a
   * property of the moves actually made, and a variation explored and left is
   * not one of them.
   */
  const analyzeRepetition = useMemo(createRepetitionAnalyzer, []);
  const repetition = useMemo(() => {
    const line = moveHistory.slice(0, currentMoveIndex + 1);
    // The root comes from its FEN rather than from the hook, which does not
    // expose the board -- and the FEN is already the hook's own description of
    // that position, so there is nothing to keep in step.
    const sideChar = rootFen.trim().split(/\s+/)[1];
    return analyzeRepetition(rootBoardSnapshot, sideChar === 'b' ? 'b' : 'w', line);
  }, [analyzeRepetition, currentMoveIndex, moveHistory, rootBoardSnapshot, rootFen]);
  /**
   * chessdb.cn's ruling on the moves from here, once the position has stood
   * here before. It is the part `describeRepetition` cannot do: a chase.
   */
  const repetitionLineMoves = useMemo(
    () => moveHistory.slice(0, currentMoveIndex + 1).map((record) => record.uci),
    [currentMoveIndex, moveHistory]
  );
  const cloudRule = useCloudRule(rootFen, repetitionLineMoves, repetition.occurrences >= 2,
    cloudBookEnabled && isPageVisible && (!isMobile || mobileView === 'board' || mobileAnalysisTab === 'graph'));
  const repetitionNoticeRef = useRef<HTMLDivElement>(null);
  const cloudRuleHasVerdict = cloudRule.status === 'ok' && (cloudRule.banned.length > 0 || cloudRule.drawing.length > 0);
  // A forbidden move is worth saying at the first repetition, before it is
  // played, whatever the threshold for an unforced one.
  const visibleRepetition = shouldReportRepetition(repetition) || cloudRuleHasVerdict ? repetition : null;
  /**
   * The one question about a repetition this app will not answer, offered
   * where it is open.
   *
   * `repetition.ts` classifies perpetual check and deliberately stops there:
   * deciding a chase needs to know which piece is being chased, whether it is
   * protected, and whether the chaser is threatening it, with a rulebook of
   * exceptions. chessdb has that machinery and `useCloudRule` asks it -- but
   * only once the reader has the cloud book on, and a reader who has not is
   * simply told the position "is a draw unless one side is perpetually
   * chasing" with nothing saying who could settle it.
   *
   * A button rather than a lookup, because turning the book on sends the
   * position and the moves that reached it off the machine. That is the one
   * thing this app does that leaves it, and it stays the reader's choice.
   *
   * Only for an unforced cycle: a perpetual check is already adjudicated
   * above, and offering to look one up would be noise on a verdict that is
   * not in doubt.
   */
  const canAskCloudAboutChase = visibleRepetition?.verdict === 'unforced' && !cloudBookEnabled;
  /**
   * Why a won ending reads level. The clock is already the fifth field of the
   * FEN the board hands the engine, so this needs no state of its own.
   */
  const captureFree = useMemo(
    () => describeCaptureFree(readCaptureFreePlies(currentFen)),
    [currentFen]
  );
  const cloudRuleText = useMemo(() => {
    if (cloudRule.status === 'loading') return `${CLOUD_BOOK_SITE_NAME}: checking the repetition ruling…`;
    if (cloudRule.status === 'error') return `${CLOUD_BOOK_SITE_NAME}: repetition ruling unavailable. Perpetual chase has not been checked.`;
    // Answered, with nothing to say. The reader still needs telling that chase
    // went unchecked -- silence there reads as "no ruling means legal" -- but
    // not that something failed, because nothing did.
    if (cloudRule.status === 'unknown') return `${CLOUD_BOOK_SITE_NAME} has no ruling for this repetition. Perpetual chase has not been checked.`;
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
  }, [board, cloudRule.status, cloudRule.banned, cloudRule.drawing, cloudRuleHasVerdict, notationStyle]);

  const canStartReview = engineEnabled && isReady && moveHistory.length > 0 && !aiMoveSearchActive;
  const engineUnavailableReviewTitle = engineNotice?.text ?? 'Engine is still loading';
  const engineUnavailableReviewLabel = engineNotice?.text === 'Engine paused after crashes'
    ? 'Engine Paused'
    : engineNotice?.text === 'Recovering engine'
      ? 'Recovering Engine'
      : 'Engine Loading';
  const reviewStartTitle = !engineEnabled
    ? 'Start engine analysis to review this line'
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
    return matchOpening(currentLineMoves, rootFen);
  }, [currentLineMoves, rootFen]);
  const exportOpeningName = useMemo(() => mainLinePinned
    ? matchOpening(studyMainLineNodeIds.map(id => moveStructure[id].record!.uci), rootFen)?.name
    : detectedOpening?.name, [mainLinePinned, studyMainLineNodeIds, moveStructure, rootFen, detectedOpening]);
  const openingCandidates = useMemo(() => {
    return getOpeningCandidates(currentLineMoves, assistMode === 'pro' ? 6 : 4, rootFen);
  }, [assistMode, currentLineMoves, rootFen]);

  // The cloud book answers the same question the local book does -- what is
  // played here -- from a database no bundled table could match. Asked only
  // when switched on, and only for the position on the board.
  const cloudBookReading = useCloudBook(currentFen, cloudBookEnabled && cloudPanelVisible);
  // The hook answers for the position it was last asked about, and for the
  // frame between a navigation and its effect that is the previous one.
  // Drawing that list under the new side's label would put Red's moves
  // beside 'for Black', so anything not for this position reads as loading.
  const cloudBook = cloudBookReading.fen === currentFen || cloudBookReading.status === 'off'
    ? cloudBookReading
    : { status: 'loading' as const, moves: [], fen: currentFen };
  const cloudBookMoveLimit = assistMode === 'pro' ? 6 : 4;
  // The database's own line, to a depth no browser reaches. Same switch,
  // same position sent, same rule about a stale answer.
  const cloudPvReading = useCloudPv(currentFen, cloudBookEnabled && cloudPanelVisible);
  const cloudPv = cloudPvReading.fen === currentFen || cloudPvReading.status === 'off'
    ? cloudPvReading
    : { status: 'loading' as const, line: null, fen: currentFen };
  const cloudPvTokens = useMemo(
    () => (cloudPv.line ? formatLineTokensInStyle(board, cloudPv.line.moves, notationStyle, 8) : null),
    [board, cloudPv.line, notationStyle]
  );

  // Game library
  const { games: savedGames, save: saveGameToLibrary, update: updateGameInLibrary, saveError: librarySaveError, libraryState, refresh: refreshGameLibrary, remove: deleteGameFromLibrary, restore: restoreGameToLibrary, rename: renameGameInLibrary } = useGameLibrary();

  const { report: libraryPositionReport, status: libraryExplorerStatus, skipped: libraryExplorerSkipped, retry: retryLibraryExplorer } =
    useLibraryExplorer(savedGames, board, sideToMove, graphVisible && leftPanelTab === 'graph');

  const [copiedToast, setCopiedToast] = useState(false);
  const [copiedFenToast, setCopiedFenToast] = useState(false);
  const [copiedRecordToast, setCopiedRecordToast] = useState(false);
  const copiedRecordToastTimerRef = useRef<number | null>(null);
  const [copiedShareToast, setCopiedShareToast] = useState(false);
  const [downloadedPgnToast, setDownloadedPgnToast] = useState(false);
  const [engineHashFeedback, setEngineHashFeedback] = useState<EngineHashFeedback>(null);
  const [copiedPvIndex, setCopiedPvIndex] = useState<number | null>(null);
  const [exportFailureKey, setExportFailureKey] = useState<ExportFailureKey | null>(null);
  // Clipboard permission requests can finish out of order. Only the latest
  // export action may publish feedback, including after a download attempt.
  const exportRequestRef = useRef(0);
  const [savedToast, setSavedToast] = useState(false);
  const [saveFailedToast, setSaveFailedToast] = useState(false);
  const savedToastTimerRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (savedToastTimerRef.current !== null) window.clearTimeout(savedToastTimerRef.current);
    savedToastTimerRef.current = null;
    setSavedToast(false);
    setSaveFailedToast(false);
  }, [gameIdentity]);
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
  const directImportGenerationRef = useRef(0);
  const directImportControllerRef = useRef<AbortController | null>(null);
  const [directImportBusy, setDirectImportBusy] = useState(false);
  const [moveLineFileDragActive, setMoveLineFileDragActive] = useState(false);
  const directImportFocusRef = useRef<HTMLElement | null>(null);
  const directImportCancelRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    // A disabled Import button, or a removed Cancel button, can blur to body.
    // Keep keyboard retry nearby without moving focus from another control.
    const target = directImportFocusRef.current;
    if (!directImportBusy && target?.isConnected && document.activeElement === document.body) target.focus();
  }, [directImportBusy]);
  const cancelDirectImport = useCallback(() => {
    directImportGenerationRef.current++;
    directImportControllerRef.current?.abort();
    directImportControllerRef.current = null;
    setDirectImportBusy(false);
  }, []);
  useLayoutEffect(() => {
    cancelDirectImport();
    setMoveLineFileDragActive(false);
  }, [cancelDirectImport, gameIdentity, pendingGameMode, showNewGameMenu, fenInput]);
  useEffect(() => () => { directImportGenerationRef.current++; directImportControllerRef.current?.abort(); }, []);
  const [moveLineInput, setMoveLineInput] = useState('');
  const [moveLineFileName, setMoveLineFileName] = useState('');
  const [moveLineFileUndo, setMoveLineFileUndo] = useState<{ text: string; name: string } | null>(null);
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
    setMoveLineFileUndo(null);
    clearFenError();
    setMoveLineError(null);
    setShowSettings((open) => !open);
  }, [clearFenError]);

  const closeNewGameMenu = useCallback(() => {
    cancelDirectImport();
    setMoveLineFileUndo(null);
    setShowNewGameMenu(false);
    setShowMobileBoardActionMenu(false);
    clearFenError();
    setMoveLineError(null);
  }, [clearFenError, cancelDirectImport]);

  const openNewGameMenu = useCallback(() => {
    cancelDirectImport();
    setShowMobileBoardActionMenu(false);
    setShowSettings(false);
    setPendingGameMode(gameMode);
    setFenInput('');
    setMoveLineInput('');
    setMoveLineFileName('');
    setMoveLineFileUndo(null);
    clearFenError();
    setMoveLineError(null);
    setShowNewGameMenu(true);
  }, [clearFenError, gameMode, cancelDirectImport]);

  const beginnerGuide = showBeginnerGuide ? (
    <BeginnerGuide
      compact={isMobile && viewportSize.height < 700}
      letters={pieceStyle === 'letters'}
      onToggleLetters={() => setPieceStyle(style => style === 'letters' ? 'traditional' : 'letters')}
      onPlay={() => { setAiStrength(1); setAiSpeed('normal'); playFromHere(); }}
      onImport={() => {
        openNewGameMenu();
        window.setTimeout(() => document.getElementById('new-game-line-input')?.focus(), 0);
      }}
      onLibrary={openLibraryPanel}
      onLearn={() => setShowRuleLessons(true)}
      onDismiss={() => { setGuideDismissed(true); writeStorage(BEGINNER_GUIDE_STORAGE_KEY, 'true'); }}
    />
  ) : null;

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
    if (hasMoveTreeMoves && (mainLinePinned || hasStudyBranches || currentMoveIndex < 0)) {
      return exportPgnTree(treeNodes, rootNodeId, {
        mainLineNodeIds: activeLineNodeIds,
        gameMode,
        metadata: gameMetadata,
        opening: exportOpeningName,
        // A tree export includes the continuation beyond the cursor. Its
        // standard result cannot come from an earlier board position.
        result: currentMoveIndex === activeLineNodeIds.length - 1 ? gameResult : undefined,
        startFen: rootFen,
      });
    }

    const moves = activeLineNodeIds
      .slice(0, currentMoveIndex + 1)
      .map(id => treeNodes[id]?.record)
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (moves.length === 0 && !rootComment && !rootResult && rootFen === START_POSITION_FEN && !hasGameMetadata) return null;
    return exportPgn(moves, {
      gameMode,
      metadata: gameMetadata,
      opening: exportOpeningName,
      result: gameResult,
      startFen: rootFen,
      rootComment,
      rootResult,
    });
  }, [activeLineNodeIds, currentMoveIndex, treeNodes, rootNodeId, gameMetadata, hasGameMetadata, gameMode, exportOpeningName, gameResult, rootFen, rootComment, rootResult, mainLinePinned, hasMoveTreeMoves, hasStudyBranches]);

  const handleCopyPgn = useCallback(async () => {
    const request = ++exportRequestRef.current;
    clearToastTimer(copiedToastTimerRef);
    setCopiedToast(false);
    const pgn = buildCurrentPgn();
    if (!pgn) return;
    const ok = await copyToClipboard(pgn);
    if (request !== exportRequestRef.current) return;
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
    exportRequestRef.current++;
    clearToastTimer(downloadedPgnTimerRef);
    setDownloadedPgnToast(false);
    const pgn = buildCurrentPgn();
    if (!pgn) return;
    const ok = downloadTextFile(
      pgnDownloadFilename(exportOpeningName),
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
  }, [buildCurrentPgn, clearExportFailure, exportOpeningName, showExportFailure]);

  const handleCopyShareLink = useCallback(async () => {
    const request = ++exportRequestRef.current;
    clearToastTimer(copiedShareToastTimerRef);
    setCopiedShareToast(false);
    // Notes travel with the link for the same reason variations do: what is
    // being shared is a study. Move notes share the tree's 8000-character
    // budget; the bounded starting-position note has its own URL parameter.
    const moveTree = hasMoveTreeMoves && (mainLinePinned || hasStudyBranches || hasAnnotatedStudyMoves || currentLineMoves.length === 0)
      ? serializeSavedMoveTree(treeNodes, rootNodeId)
      : undefined;
    let share: ReturnType<typeof buildShareUrl>;
    try {
      share = buildShareUrl(window.location.href, rootFen, currentLineMoves, gameMode, moveTree, rootComment, mainLinePinned, rootResult);
    } catch {
      setShareLinkNotice({ tone: 'warning', text: 'Link not copied', detail: 'This study is too large for a share link. Export PGN to keep all of it.' });
      return;
    }
    if (!share || !canShareCurrentPosition) return;
    const ok = await copyToClipboard(share.url);
    if (request !== exportRequestRef.current) return;
    if (!ok) {
      showExportFailure('copy-share');
      return;
    }

    clearExportFailure();
    setShareLinkNotice(share.treeOmitted
      ? {
          tone: 'warning',
          text: 'Variations omitted',
          detail: 'The link was copied. This study is larger than a link can hold, so only the line on screen went with it -- its variations, move notes, and saved analysis stayed behind.',
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
  }, [canShareCurrentPosition, clearExportFailure, currentLineMoves, gameMode, hasAnnotatedStudyMoves, hasMoveTreeMoves, hasStudyBranches, rootFen, rootComment, rootResult, mainLinePinned, rootNodeId, shareNoticePositionKey, showExportFailure, treeNodes]);

  const handlePickMoveLineFile = useCallback(() => {
    moveLineFileInputRef.current?.click();
  }, []);

  /**
   * An XQF file, already read: the format most xiangqi records on disk are
   * in. Unlike a paste it has nowhere to be shown before it is loaded, so
   * it goes straight onto the board, variations and notes with it.
   */
  const handleImportXqf = useCallback((record: XqfRecord, nextGameMode: GameMode = pendingGameMode) => {
    showImportNotice(null);
    const recordedResult = record.mainLineComplete && record.result !== 'unknown'
      ? savedResultToGameResult(record.result) : null;
    const metadata = normalizeGameMetadata(record);
    const reportRecovery = () => {
      if (!record.mainLineComplete) {
        showImportNotice('Incomplete XQF main line', 'The original main line could not be recovered completely. Available legal moves were imported without the file\'s game result.');
      } else if (record.refused > 0) {
        showImportNotice(
          `Skipped ${record.refused} ${record.refused === 1 ? 'move' : 'moves'}`,
          `The file holds ${record.refused} ${record.refused === 1 ? 'move' : 'moves'} the rules refuse; each branch stops at the first one.`
        );
      }
    };
    if (record.moves.length === 0 && !record.startFen && !normalizeMoveComment(record.rootComment) && !recordedResult) {
      setMoveLineError('This XQF file holds no moves and no position.');
      return;
    }
    if (record.moves.length === 0) {
      // Through the ref: the FEN loader is declared further down.
      if (handleLoadFenRef.current?.(record.startFen || START_POSITION_FEN, nextGameMode, record.rootComment)) {
        restoreRecordedResult(rootNodeId, recordedResult);
        setGameMetadata(metadata);
        reportRecovery();
      }
      return;
    }

    if (!checkpointBeforeReplaceRef.current()) return;
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    const nextWorkspace = workspaceForNewGame(nextGameMode, gameMode);
    if (nextWorkspace) setWorkspaceMode(nextWorkspace);
    setGameMode(nextGameMode);
    const facing = orientationForHuman(nextGameMode);
    if (facing) setOrientation(facing);

    setLoadedSavedStudy(null);
    const loadedNodeIds = loadMoveTree(record.moveTree, record.moves, record.startFen, undefined, record.rootComment);
    restoreRecordedResult(loadedNodeIds[record.moves.length - 1] ?? rootNodeId, recordedResult);
    setGameMetadata(metadata);
    reportRecovery();
    setFenInput('');
    clearFenError();
    setMoveLineInput('');
    setMoveLineFileName('');
    setMoveLineError(null);
    setGraphLoadSweepToken((token) => token + 1);
    closeNewGameMenu();
  }, [restoreRecordedResult, rootNodeId, setGameMetadata, clearFenError, closeNewGameMenu, handleCancelReview, loadMoveTree, gameMode, pendingGameMode, resetReview, showImportNotice, stopAnalysis]);

  const readMoveLineFile = useCallback(async (file: File) => {
    cancelDirectImport();
    const generation = directImportGenerationRef.current;
    const previous = { text: moveLineInput, name: moveLineFileName };

    if (file.size > MAX_MOVE_IMPORT_TEXT_LENGTH) {
      setMoveLineError('File is too large for direct import. For an annotated PGN, use Library → Import PGN collection, then Open on board.');
      return;
    }

    try {
      setMoveLineError(null);
      setDirectImportBusy(true);
      const bytes = await file.arrayBuffer();
      if (generation !== directImportGenerationRef.current) return;
      const controller = new AbortController();
      directImportControllerRef.current = controller;
      const response = await readDirectImport({ kind: 'file', bytes, name: file.name }, controller.signal);
      if (generation !== directImportGenerationRef.current) return;
      setDirectImportBusy(false);
      if (response.kind === 'xqf') {
        handleImportXqf(response.record);
        return;
      }
      if (response.kind !== 'text') return;
      const text = response.text;
      if (!text.trim()) throw new Error('The file is empty. Choose a game record with moves or a position.');
      if (isMoveImportTextTooLarge(text)) {
        setMoveLineError('File is too large for direct import. For an annotated PGN, use Library → Import PGN collection, then Open on board.');
        return;
      }
      setMoveLineInput(text);
      setMoveLineFileName(file.name);
      if (text !== previous.text || file.name !== previous.name) setMoveLineFileUndo(previous);
      setMoveLineError(null);
    } catch (error) {
      if (generation !== directImportGenerationRef.current) return;
      setDirectImportBusy(false);
      setMoveLineError(error instanceof Error ? error.message : 'Could not read file');
    }
  }, [handleImportXqf, cancelDirectImport, moveLineInput, moveLineFileName]);

  const handleUndoMoveLineFile = useCallback(() => {
    if (!moveLineFileUndo) return;
    const source = document.activeElement;
    directImportFocusRef.current = document.getElementById('new-game-line-input');
    cancelDirectImport();
    const generation = directImportGenerationRef.current;
    setMoveLineInput(moveLineFileUndo.text);
    setMoveLineFileName(moveLineFileUndo.name);
    setMoveLineError(null);
    setMoveLineFileUndo(null);
    // The Undo button leaves the DOM. Reveal the restored text after layout,
    // unless another edit or focused control has superseded this action.
    requestAnimationFrame(() => {
      if (generation !== directImportGenerationRef.current) return;
      const input = document.getElementById('new-game-line-input');
      if (document.activeElement === document.body || document.activeElement === input || document.activeElement === source) input?.focus();
    });
  }, [cancelDirectImport, moveLineFileUndo]);

  const handleMoveLineFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void readMoveLineFile(file);
  }, [readMoveLineFile]);

  const handleMoveLineFileDrop = useCallback((event: React.DragEvent<HTMLTextAreaElement>) => {
    setMoveLineFileDragActive(false);
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.currentTarget.focus();
    const file = event.dataTransfer.files[0];
    if (event.dataTransfer.files.length !== 1 || !file) {
      cancelDirectImport();
      setMoveLineError('Drop one game file at a time.');
      return;
    }
    void readMoveLineFile(file);
  }, [cancelDirectImport, readMoveLineFile]);

  const handleCopyFen = useCallback(async () => {
    const request = ++exportRequestRef.current;
    clearToastTimer(copiedFenToastTimerRef);
    setCopiedFenToast(false);
    const ok = await copyToClipboard(currentFen);
    if (request !== exportRequestRef.current) return;
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
  // Formatting the whole line belongs to Copy, not every navigation step.
  const canCopyRecord = currentMoveIndex >= 0 && moveHistory.length > 0;

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
  const [moveCommentRestoreVersion, setMoveCommentRestoreVersion] = useState(0);
  const moveCommentEditRef = useRef<{ gameIdentity: object; nodeId: string; draft: string } | null>(null);
  const moveCommentTimerRef = useRef<number | null>(null);
  const treeNodesRef = useRef(treeNodes);
  // Synced in a layout effect rather than during render, immediately above
  // the effect that reads it: effects run in declaration order, so a
  // commit that adds a move and steps onto it has the new tree in hand by the
  // time the note below is loaded from it.
  useLayoutEffect(() => {
    treeNodesRef.current = treeNodes;
  }, [treeNodes]);

  const commitMoveComment = useCallback(() => {
    if (moveCommentTimerRef.current !== null) {
      window.clearTimeout(moveCommentTimerRef.current);
      moveCommentTimerRef.current = null;
    }
    const pending = moveCommentEditRef.current;
    if (pending?.gameIdentity === gameIdentity) setNodeComment(pending.nodeId, pending.draft);
  }, [gameIdentity, setNodeComment]);

  const handleMoveCommentChange = useCallback((value: string) => {
    setMoveCommentDraft(value);
    if (moveCommentEditRef.current) moveCommentEditRef.current.draft = value;
    if (moveCommentTimerRef.current !== null) window.clearTimeout(moveCommentTimerRef.current);
    moveCommentTimerRef.current = window.setTimeout(() => {
      moveCommentTimerRef.current = null;
      const pending = moveCommentEditRef.current;
      if (pending?.gameIdentity === gameIdentity) setNodeComment(pending.nodeId, pending.draft);
    }, 600);
  }, [gameIdentity, setNodeComment]);

  // Stepping to another move writes the note being edited before loading the
  // next one, so a note is never lost by navigating away from it. The tree is
  // read through a ref because it changes on every move and this must not
  // re-run -- and re-reset the draft -- while someone is typing into it.
  // Initialize before paint: a passive effect can run after a quick paste
  // into the new game's editor and erase that first edit with the stored note.
  useLayoutEffect(() => {
    const previous = moveCommentEditRef.current;
    if (moveCommentTimerRef.current !== null) {
      window.clearTimeout(moveCommentTimerRef.current);
      moveCommentTimerRef.current = null;
    }
    // Node IDs restart on load. Never write an old game's draft into a new
    // tree, even if both games happen to select the same node ID.
    if (previous?.gameIdentity === gameIdentity && previous.nodeId !== currentNodeId) {
      setNodeComment(previous.nodeId, previous.draft);
    }
    const editableNodeId = currentNodeId;
    const stored = editableNodeId === rootNodeId ? treeNodesRef.current[rootNodeId]?.comment ?? ''
      : editableNodeId ? treeNodesRef.current[editableNodeId]?.record?.comment ?? '' : '';
    moveCommentEditRef.current = editableNodeId ? { gameIdentity, nodeId: editableNodeId, draft: stored } : null;
    setMoveCommentDraft(stored);
  }, [currentNodeId, gameIdentity, moveCommentRestoreVersion, rootNodeId, setNodeComment]);

  useEffect(() => () => {
    if (moveCommentTimerRef.current !== null) window.clearTimeout(moveCommentTimerRef.current);
  }, []);

  const moveCommentTarget = currentNodeId === rootNodeId ? 'starting position'
    : currentNodeId ? nodeLabel(currentNodeId, rootNodeId, treeNodes, notationStyle, rootFen) : null;
  const studyNotes = useMemo(() => collectStudyNotes(treeNodes, rootNodeId), [treeNodes, rootNodeId]);
  const studyNotesViewRef = useRef<{ identity: object; state: StudyNotesViewState } | null>(null);
  const rememberStudyNotesView = useCallback((identity: object, state: StudyNotesViewState) => {
    studyNotesViewRef.current = { identity, state };
  }, []);
  const handleCopyRecord = useCallback(async () => {
    const request = ++exportRequestRef.current;
    clearToastTimer(copiedRecordToastTimerRef);
    setCopiedRecordToast(false);
    const recordText = formatRecordText(moveHistory.slice(0, currentMoveIndex + 1), rootFen, notationStyle);
    if (!recordText) return;
    const ok = await copyToClipboard(recordText);
    if (request !== exportRequestRef.current) return;
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
  }, [clearExportFailure, currentMoveIndex, moveHistory, notationStyle, rootFen, showExportFailure]);

  const handleCopyPvLine = useCallback(async (lineIndex: number, moves: string[]) => {
    const request = ++exportRequestRef.current;
    clearToastTimer(copiedPvTimerRef);
    setCopiedPvIndex(null);
    const rawLine = moves.filter(Boolean).join(' ').trim();
    if (!rawLine) return;
    const ok = await copyToClipboard(rawLine);
    if (request !== exportRequestRef.current) return;
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
    && reviewStatus !== 'running' && !threatActive && (!candidatePickerOpen || candidateActive);

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
    && reviewStatus !== 'running' && !deepDiveActive && !candidatePickerOpen && Boolean(threatFen);

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

  // Navigating away or replacing the worker invalidates the threat search.
  // Use session identity too: a fast restart can skip an isReady=false render,
  // leaving the availability guard below unable to detect the interruption.
  useEffect(() => {
    setThreatActive(false);
  }, [analysisRequestKey, engineBootKey, readySessionId]);

  // Anything that takes the analysis engine away -- the opponent's turn
  // starting, a review beginning, the engine going down -- takes the threat
  // with it. Without this the card stays on screen over a search that has been
  // stopped, and `stopThreat` is what lets live analysis start again after.
  useEffect(() => {
    if (threatActive && !canShowThreat) stopThreat();
  }, [canShowThreat, stopThreat, threatActive]);

  const canCompareCandidates = isReady && engineEnabled && !isAiTurn && !gameResult && isPageVisible
    && reviewStatus !== 'running' && !deepDiveActive && !threatActive;
  const candidateBudgetLabel = `Up to ${liveAnalysisPolicy.primary.moveTimeMs / 1000}s · target depth ${liveAnalysisPolicy.primary.depth}`;

  const leaveCandidateSearch = useCallback(() => {
    if (!candidateActiveKeyRef.current) return;
    candidateActiveKeyRef.current = '';
    setCandidateSearch(null);
    setDeepDiveActive(false);
    analysisStageRef.current = 'idle';
    activeAnalysisRequestRef.current = '';
    clearAnalysisDeepenTimer();
    clearQueuedSearch();
    clearPvLines();
    if (parseCandidateTag(getActiveSearchTag())) stopSearch();
  }, [clearAnalysisDeepenTimer, clearPvLines, clearQueuedSearch, getActiveSearchTag, setDeepDiveActive, stopSearch]);

  const closeCandidatePicker = useCallback(() => {
    leaveCandidateSearch();
    setCandidatePickerOpen(false);
    candidateButtonRef.current?.focus({ preventScroll: true });
  }, [leaveCandidateSearch]);

  const openCandidatePicker = useCallback(() => {
    if (!canCompareCandidates) return;
    setAnalysisTab('engine');
    setMobileAnalysisTab('engine');
    setMobileView('analysis');
    setCandidatePickerOpen(true);
  }, [canCompareCandidates]);

  const compareCandidateMoves = useCallback((moves: string[], deep = false) => {
    if (!canCompareCandidates) return;
    const go = deep ? deepSearchMode === 'infinite' ? 'go infinite' : deepDiveBudget.goCmd : liveAnalysisPolicy.primary.goCmd;
    const goCmd = candidateGoCommand(go, moves, board, sideToMove);
    if (!goCmd) return;
    const key = `${analysisRequestKey}::candidates:${moves.join(',')}::run:${++candidateRunRef.current}`;
    candidateActiveKeyRef.current = key;
    candidateRequestKeyRef.current = analysisRequestKey;
    activeAnalysisRequestRef.current = '';
    analysisStageRef.current = 'settled';
    applyBestMoveRef.current = false;
    clearAnalysisDeepenTimer();
    clearPvLines();
    clearWdl();
    setDeepDiveActive(deep);
    const budgetLabel = deep
      ? deepSearchMode === 'infinite' ? 'Until stopped' : `Up to ${deepDiveBudget.moveTimeMs / 1000}s · target depth ${deepDiveBudget.depth}`
      : candidateBudgetLabel;
    setCandidateSearch({ requestKey: analysisRequestKey, key, moves: [...moves], completed: false, backgroundAllowed: deep, budgetLabel });
    // Queue options before the search so a running predecessor stops before
    // MultiPV changes, and all selected roots receive a line.
    currentMultiPvRef.current = moves.length;
    currentShowWdlRef.current = false;
    setOption('MultiPV', moves.length);
    setOption('UCI_ShowWDL', false);
    queueSearch(currentPositionCommand, goCmd, 0, makeCandidateTag(key));
  }, [analysisRequestKey, board, canCompareCandidates, candidateBudgetLabel, clearAnalysisDeepenTimer, clearPvLines, clearWdl,
    currentPositionCommand, deepDiveBudget, deepSearchMode, liveAnalysisPolicy.primary.goCmd, queueSearch, setDeepDiveActive, setOption, sideToMove]);

  useEffect(() => {
    candidateActiveKeyRef.current = '';
    setCandidateSearch(null);
  }, [analysisRequestKey, engineRestartToken, readySessionId]);
  useEffect(() => { setCandidatePickerOpen(false); }, [currentPositionCommand]);
  useEffect(() => {
    if (!engineEnabled || !isReady || isAiTurn || gameResult || reviewStatus === 'running' || (!isPageVisible && !retainCandidateInBackground)) {
      leaveCandidateSearch();
    }
  }, [engineEnabled, gameResult, isAiTurn, isPageVisible, isReady, leaveCandidateSearch, retainCandidateInBackground, reviewStatus]);

  const stopDeepDive = useCallback(() => {
    // Stop must also cancel a search waiting for its predecessor's bestmove.
    clearQueuedSearch();
    stopSearch();
    setDeepDiveActive(false);
    analysisStageRef.current = 'settled';
    setCandidateSearch(previous => previous ? { ...previous, completed: true } : previous);
  }, [clearQueuedSearch, setDeepDiveActive, stopSearch]);

  const runDeepDive = useCallback(() => {
    if (!isReady || !engineEnabled || isAiTurn || reviewControllerRef.current.active) return;
    if (candidateActive && candidateSearch) {
      compareCandidateMoves(candidateSearch.moves, true);
      return;
    }
    analysisStageRef.current = 'deep-pending';
    setDeepDiveActive(true);
    queueSearch(
      currentPositionCommand,
      deepSearchMode === 'infinite' ? 'go infinite' : deepDiveBudget.goCmd,
      0,
      makeAnalysisTag('deep', analysisRequestKey),
    );
  }, [analysisRequestKey, candidateActive, candidateSearch, compareCandidateMoves, currentPositionCommand, deepDiveBudget.goCmd, deepSearchMode, engineEnabled, isAiTurn, isReady, queueSearch, setDeepDiveActive]);
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
    setHintUnavailable(false);
    setHintPending(true);
    queueSearch(currentPositionCommand, HINT_GO_CMD, 0, makeHintTag(currentPositionCommand));
  }, [canHint, currentPositionCommand, queueSearch]);

  useEffect(() => {
    // Pending and completed hints belong to this position and engine session.
    // A terminated worker never sends the bestmove that clears hintPending;
    // a fast replacement may become ready without rendering isReady=false.
    setHintMove(null);
    setHintPending(false);
    setHintUnavailable(false);
  }, [currentNodeId, aiPlayActive, engineBootKey, readySessionId, isReady]);

  const hintText = useMemo(() => {
    if (hintPending) return 'Thinking of a hint…';
    if (hintUnavailable) return 'No hint available. Try again.';
    if (!hintMove) return null;
    return `Hint: ${formatLineInStyle(board, [hintMove], notationStyle, 1)}`;
  }, [board, hintMove, hintPending, hintUnavailable, notationStyle]);

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

  /**
   * Play an engine line up to one of its moves, from the position on screen.
   *
   * An engine line is a line *into* the position, and following it to its
   * third move to see what the engine means is how an analysis board is
   * used; the Play button beside a line plays only its first move. The
   * panel stays where it is, because the next line to click is the one the
   * engine reports for the new position.
   */
  const handlePlayPvLine = useCallback((moves: string[], count: number) => {
    if (gameResult || isAiTurn || count <= 0) return;
    clearBoardMarkers();
    applyUciLineAtNode(currentNodeId, moves.slice(0, count));
  }, [applyUciLineAtNode, clearBoardMarkers, currentNodeId, gameResult, isAiTurn]);

  const handleKeepPvLine = useCallback((moves: string[]) => {
    if (!isReady || gameResult || isAiTurn || reviewStatus === 'running') return;
    const result = keepUciLineAtNode(currentNodeId, moves, analysisForLine(moves));
    showImportNotice(result === 'kept'
      ? 'Engine line kept in the move tree.'
      : result === 'full'
        ? `Study limit reached (${MAX_SAVED_TREE_NODES.toLocaleString('en-US')} moves). Remove a variation before keeping another line.`
        : result === 'line-full'
          ? 'Line limit reached (1,024 moves). Step back before keeping another engine line.'
        : 'The complete engine line is not legal here. Nothing was added.');
  }, [analysisForLine, currentNodeId, gameResult, isAiTurn, isReady, keepUciLineAtNode, reviewStatus, showImportNotice]);

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

    if (!checkpointBeforeReplaceRef.current()) return;
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setGameResult(null);
    setAiMoveError(null);
    setPaused(false);
    setGameMode(practiceSide === 'w' ? 'PvAI-Black' : 'PvAI-Red');
    setOrientation(practiceSide === 'w' ? 'red' : 'black');
    setWorkspaceMode('play');
    setLoadedSavedStudy(null);
    loadMoves(practiceMoves, rootFen, undefined, treeNodes[rootNodeId]?.comment);
    setGameMetadata(gameMetadata);
    setAnalysisTab('tree');
    setMobileAnalysisTab('moves');
    setGraphLoadSweepToken((token) => token + 1);
    setMobileView('board');
  }, [gameMetadata, setGameMetadata, getNodeFen, getNodeMoves, handleCancelReview, loadMoves, resetReview, rootFen, rootNodeId, setGameResult, stopAnalysis, treeNodes]);

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

  drillJudgeRef.current = (evalScore, hasExactEvaluation) => {
    if (!drill || drill.finished || (drill.verdict && drill.verdict.kind !== 'unavailable') || !drill.attempt || !drillMoment) return;
    if (currentNodeId !== drill.attempt.nodeId) return;
    const verdict = judgeCompletedDrillAttempt(drillMoment, drill.attempt.uci, evalScore, hasExactEvaluation);
    setDrill({ ...drill, verdict });
  };

  const canRetryDrillAnalysis = canDeepDive && !candidatePickerOpen && currentNodeId === drill?.attempt?.nodeId;
  const retryDrillAnalysis = useCallback(() => {
    if (!drill || !canRetryDrillAnalysis) return;
    setDrill({ ...drill, verdict: null });
    runDeepDive();
  }, [canRetryDrillAnalysis, drill, runDeepDive]);

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
            detail: `Ply ${drillMoment.ply}, where the review found ${formatReviewQualityWithArticle(drillMoment.quality)}.`,
          };
    }
    switch (verdict.kind) {
      case 'unavailable':
        return {
          headline: 'This move has not been graded.',
          detail: `The engine returned ${verdict.reason === 'bound' ? 'only a score bound' : 'no evaluation'}. Retry analysis, try another move, or see the answer.`,
        };
      case 'best':
        return { headline: `${attemptText} is the engine's move.`, detail: '' };
      case 'good':
        return {
          headline: `${attemptText} is good enough.`,
          detail: `Advantage change ${formatWinPercentLoss(verdict.winPercentLoss)}; the engine preferred ${bestText}.`,
        };
      case 'wrong':
        return {
          headline: `Not ${attemptText}.`,
          detail: `${formatReviewQuality(verdict.quality)} on the review's scale, advantage change ${formatWinPercentLoss(verdict.winPercentLoss)}. Try again, or see the answer.`,
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
    setEditorSeed(null);
    // The editor only offers Done for a legal position, so this succeeds;
    // the mode is the one picked in the New Game dialog, or the current one
    // when the editor was opened from the palette.
    handleLoadFenRef.current?.(fen, editorGameMode ?? gameMode);
  }, [editorGameMode, gameMode]);

  /**
   * The board behind a refused FEN, when there is one to show.
   *
   * Only while the refusal is on screen, and only for a FEN whose layout
   * parsed -- a broken layout draws nothing, and the editor would silently
   * open on the current game instead, which looks like the button ignoring
   * the paste.
   */
  const refusedPosition = useMemo(
    () => (fenError ? readFenBoard(fenInput) : null),
    [fenError, fenInput],
  );

  const handleLoadFen = useCallback((fen: string, nextGameMode: GameMode = gameMode, note?: string) => {
    if (!describeFenProblem(fen.trim()) && !checkpointBeforeReplaceRef.current()) return false;
    const ok = loadFen(fen.trim(), note);
    if (!ok) {
      // No timer on this one. The message is now a specific thing to fix --
      // which soldier, which general -- and two seconds was already short for
      // the old one sentence. It goes when the reader answers it: typing in
      // the field clears it, and so does opening or closing the dialog, which
      // is what keeps a refusal from an import or a share link out of the way.
      if (fenErrorTimerRef.current !== null) {
        window.clearTimeout(fenErrorTimerRef.current);
        fenErrorTimerRef.current = null;
      }
      setFenError(
        describeFenProblem(fen.trim())
          ?? 'FEN must describe a legal Xiangqi position with both generals and a side to move.'
      );
      return false;
    }
    setLoadedSavedStudy(null);
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    const nextWorkspace = workspaceForNewGame(nextGameMode, gameMode);
    if (nextWorkspace) setWorkspaceMode(nextWorkspace);
    setGameMode(nextGameMode);
    const facing = orientationForHuman(nextGameMode);
    if (facing) setOrientation(facing);
    setFenInput('');
    clearFenError();
    closeNewGameMenu();
    return true;
  }, [clearFenError, closeNewGameMenu, gameMode, handleCancelReview, loadFen, resetReview, stopAnalysis]);

  const handleLoadFenRef = useRef<typeof handleLoadFen | null>(null);
  handleLoadFenRef.current = handleLoadFen;

  const handleImportMoveLine = useCallback(async (text: string, nextGameMode: GameMode = pendingGameMode) => {
    cancelDirectImport();
    showImportNotice(null);
    setMoveLineError(null);
    const generation = directImportGenerationRef.current;
    const controller = new AbortController();
    directImportControllerRef.current = controller;
    setDirectImportBusy(true);
    let response;
    try { response = await readDirectImport({ kind: 'plan', text, fen: fenInput }, controller.signal); }
    catch (error) {
      if (generation !== directImportGenerationRef.current) return;
      setDirectImportBusy(false);
      setMoveLineError(error instanceof Error ? error.message : 'Could not read this game.');
      return;
    }
    if (generation !== directImportGenerationRef.current || response.kind !== 'plan') return;
    setDirectImportBusy(false);
    const { plan, metadata } = response;
    if (plan.kind === 'error') {
      setMoveLineError(plan.message);
      return;
    }
    if (plan.kind === 'diagram') {
      if (handleLoadFen(plan.startFen, nextGameMode, plan.rootComment)) {
        restoreRecordedResult(rootNodeId, plan.rootResult);
        setGameMetadata(metadata);
      }
      return;
    }
    const { moves, startFen, importedFromNotation, notationRejected } = plan;

    if (!checkpointBeforeReplaceRef.current()) return;
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    const nextWorkspace = workspaceForNewGame(nextGameMode, gameMode);
    if (nextWorkspace) setWorkspaceMode(nextWorkspace);
    setGameMode(nextGameMode);
    const facing = orientationForHuman(nextGameMode);
    if (facing) setOrientation(facing);
    setLoadedSavedStudy(null);
    const loadedNodeIds = (!importedFromNotation && plan.moveTree.length > 0)
      ? loadMoveTree(plan.moveTree, moves, startFen, undefined, plan.rootComment, plan.mainLinePinned)
      : loadMoves(moves, startFen, undefined, plan.rootComment, plan.mainLinePinned);
    restoreRecordedResult(rootNodeId, plan.rootResult);
    restoreRecordedResult(loadedNodeIds[moves.length - 1] ?? rootNodeId, plan.recordedResult, true);
    setGameMetadata(metadata);
    if (notationRejected.length > 0) {
      // More pressing than the first-game notice: that one says the rest of a
      // file was left, this one says part of *this* game was.
      showImportNotice(
        `Stopped at ${notationRejected[0]}`,
        `Imported ${moves.length} ${moves.length === 1 ? 'move' : 'moves'}. The record then reads ${notationRejected[0]}, which names no legal move in the position it had reached, so the rest was not imported.`
      );
    } else if (plan.hadMoreGames) {
      showImportNotice(
        'Imported first game',
        'Imported the first game only. To save several games, open Library → Import PGN collection.'
      );
    }

    // Coordinate PGN annotations are already loaded with plan.moveTree,
    // including a straight line. DhtmlXQ keeps its separate move-indexed notes.
    if (plan.dhtmlComments.length > 0) {
      const comments = plan.dhtmlComments
        .map(([moveNumber, comment]) => {
          const nodeId = loadedNodeIds[moveNumber - 1];
          return moveNumber >= 1 && nodeId ? { nodeId, comment } : null;
        })
        .filter((update): update is { nodeId: string; comment: string } => Boolean(update));
      if (comments.length > 0) setNodeComments(comments);
    }

    setFenInput('');
    clearFenError();
    setMoveLineInput('');
    setMoveLineFileName('');
    setMoveLineError(null);
    setGraphLoadSweepToken((token) => token + 1);
    closeNewGameMenu();
  }, [restoreRecordedResult, rootNodeId, clearFenError, closeNewGameMenu, fenInput, handleCancelReview, handleLoadFen, loadMoveTree, loadMoves, gameMode, pendingGameMode, resetReview, setGameMetadata, setNodeComments, showImportNotice, stopAnalysis, cancelDirectImport]);

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

    const params = readShareParams(window.location);
    const rawFen = params.get('fen')?.trim() || undefined;
    const rawMoves = params.get('moves') || '';
    const rawTree = params.get('tree');
    const sharedMoveTree = decodeSavedMoveTreeParam(rawTree);
    const rawMode = params.get('mode');
    const sharedRootComment = normalizeMoveComment(params.get('note'));
    const sharedRootResult = normalizeRecordedResult(params.get('rootResult'));
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
    // Split on commas and semicolons as well as spaces. The app writes spaces,
    // but a line typed by hand into the address bar is written with commas as
    // often as not, and it used to be refused as "h2e2,h9g7,b2 is not a move"
    // -- which named the whole list and blamed the messaging app.
    const sharedMoveTokens = rawMoves.trim().split(/[\s,;|]+/).filter(Boolean);
    const unreadableToken = sharedMoveTokens.find((token) => !/^[a-i][0-9][a-i][0-9]$/i.test(token));
    if (unreadableToken !== undefined) {
      failShareLink({ kind: 'unreadable-move', token: unreadableToken.slice(0, 12) });
      logDiagnosticWarning('Ignored shared Xiangqi link with unreadable moves:', rawMoves.slice(0, 80));
      return;
    }
    if (!rawFen && moves.length === 0 && !sharedMoveTree?.length && !sharedRootComment && !sharedRootResult) {
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
        ? { kind: 'bad-start-position', reason: describeFenProblem(rawFen ?? '') ?? undefined }
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
    setLoadedSavedStudy(null);
    if (sharedMoveTree?.length && canLoadSharedTree) {
      loadMoveTree(sharedMoveTree, moves, rawFen, undefined, sharedRootComment, params.get('main') === '1');
    } else if (moves.length > 0) {
      loadMoves(moves, rawFen, undefined, sharedRootComment);
    } else if (rawFen || sharedRootComment || sharedRootResult) {
      loadFen(rawFen || START_POSITION_FEN, sharedRootComment);
    }
    restoreRecordedResult(rootNodeId, sharedRootResult);
    setWorkspaceMode('analysis');
    setAnalysisTab('tree');
    setMobileAnalysisTab('moves');
    setMobileView('board');
    setGraphLoadSweepToken((token) => token + 1);
  }, [restoreRecordedResult, rootNodeId, handleCancelReview, loadFen, loadMoves, loadMoveTree, resetReview, stopAnalysis, validateMoveSequence, validateMoveTree]);

  const savedReviewSnapshot = useMemo(() => {
    if (!reviewSummary) return undefined;
    return {
      summary: reviewSummary,
      annotations: reviewedHistory.map((record, moveIndex) => ({
        moveIndex,
        evalScore: record.evalScore,
        evalScoreKind: record.evalScoreKind,
        bestMove: record.bestMove,
        bestLine: record.bestLine,
        quality: record.quality,
        swing: record.swing,
        winPercentLoss: record.winPercentLoss,
        reviewNote: record.reviewNote,
      })),
    };
  }, [reviewedHistory, reviewSummary]);

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
  // Ordinary game evaluations have no bound metadata. While a bound is live,
  // retain this position's existing exact reading, including its score kind.
  // Explicit Keep Line snapshots preserve uncertain scores separately.
  const storedCurrentEval = treeNodes[currentNodeId]?.record;
  const snapshotEval = {
    score: topAnalysisPv?.bounded ? storedCurrentEval?.evalScore : displayEvalScore ?? undefined,
    kind: topAnalysisPv?.bounded ? storedCurrentEval?.evalScoreKind : displayEvalScoreKind,
  };
  const snapshotEvalRef = useRef(snapshotEval);
  snapshotEvalRef.current = snapshotEval;
  // The cursor and game details change the snapshot, not the stored tree.
  // Serialize only when the tree changes or a compact line first needs its
  // unplayed continuation. Keep the memo local so old studies can be released.
  const savedLineLength = reviewMatchesActiveLine ? activeLineNodeIds.length : currentMoveIndex + 1;
  const needsSnapshotTree = hasMoveTreeMoves && Boolean(mainLinePinned || hasStudyBranches || hasAnnotatedStudyMoves
    || savedLineLength === 0 || savedLineLength < activeLineNodeIds.length);
  const snapshotMoveTree = useMemo(() => needsSnapshotTree
    ? serializeSavedMoveTree(treeNodes, rootNodeId) : undefined, [needsSnapshotTree, treeNodes, rootNodeId]);
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
    return {
      gameMode,
      sourceLibrary: loadedSavedStudy ? librarySource(loadedSavedStudy) : undefined,
      metadata: gameMetadata,
      rootComment,
      rootResult,
      mainLinePinned,
      moves,
      cursorPly: currentMoveIndex + 1,
      opening: exportOpeningName,
      startFen: rootFen !== START_POSITION_FEN ? rootFen : undefined,
      result: ((gameResult ?? selectedRecordedResult) === 'red-wins' ? 'red' : (gameResult ?? selectedRecordedResult) === 'black-wins' ? 'black' : (gameResult ?? selectedRecordedResult) === 'draw' ? 'draw' : 'ongoing') as SavedGame['result'],
      moveTree: snapshotMoveTree,
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
  }, [loadedSavedStudy, selectedRecordedResult, activeLineNodeIds, currentMoveIndex, exportOpeningName, gameMetadata, gameMode, gameResult, snapshotMoveTree, reviewMatchesActiveLine, reviewSummary, rootFen, rootComment, rootResult, mainLinePinned, savedReviewSnapshot, treeNodes]);

  const fullStudyTree = useMemo(() => serializeSavedMoveTree(treeNodes, rootNodeId), [treeNodes, rootNodeId]);
  const currentStudyContent = useMemo(() => studyContent({ gameMode, moves: [], moveTree: fullStudyTree,
    startFen: rootFen, rootComment, rootResult, mainLinePinned, metadata: gameMetadata,
    review: currentGameSnapshot.review }), [gameMode, fullStudyTree, rootFen, rootComment, rootResult, mainLinePinned, gameMetadata, currentGameSnapshot.review]);
  const savedStudyContent = useMemo(() => loadedSavedStudy ? studyContent(loadedSavedStudy) : null, [loadedSavedStudy]);
  const commentStillPending = normalizeMoveComment(moveCommentDraft) !== normalizeMoveComment(
    currentNodeId === rootNodeId ? treeNodes[rootNodeId]?.comment : treeNodes[currentNodeId]?.record?.comment);
  const studyModified = Boolean(loadedSavedStudy && (currentStudyContent !== savedStudyContent || commentStillPending));
  const studySaveLabel = libraryWritePending ? 'Saving…' : !loadedSavedStudy ? 'Unsaved study' : studyModified ? 'Modified study' : 'Saved study';
  const mobileStudySaveLabel = libraryWritePending ? 'Saving…' : !loadedSavedStudy ? 'Save study' : studyModified ? 'Save changes' : 'Saved study';

  /** Include the live note even when Save runs before blur or its debounce. */
  const snapshotForStorage = useCallback((snapshot: typeof currentGameSnapshot) => {
    let stored = {
      ...snapshot,
      finalEval: snapshotEvalRef.current.score,
      finalEvalKind: snapshotEvalRef.current.kind,
    };
    const pending = moveCommentEditRef.current;
    if (pending?.gameIdentity !== gameIdentity) return stored;
    const node = treeNodesRef.current[pending.nodeId];
    const normalized = normalizeMoveComment(pending.draft);
    if (pending.nodeId === rootNodeId) {
      stored = { ...stored, rootComment: normalized };
    } else if (node?.record && normalized !== node.record.comment) {
      const record = { ...node.record };
      if (normalized) record.comment = normalized;
      else delete record.comment;
      const patched = { ...treeNodesRef.current, [pending.nodeId]: { ...node, record } };
      stored = { ...stored, moveTree: serializeSavedMoveTree(patched, rootNodeId) };
    }
    return stored;
  }, [gameIdentity, rootNodeId]);

  const reportSaveResult = useCallback((saved: SavedGame | null) => {
    if (saved) setLoadedSavedStudy(saved);
    if (savedToastTimerRef.current !== null) {
      window.clearTimeout(savedToastTimerRef.current);
      savedToastTimerRef.current = null;
    }
    setSavedToast(Boolean(saved));
    setSaveFailedToast(!saved);
    // Recovery instructions stay until dismissal, a successful save, or a
    // different game. A brief success confirmation can fade on its own.
    if (saved) savedToastTimerRef.current = window.setTimeout(() => {
      savedToastTimerRef.current = null;
      setSavedToast(false);
    }, 1800);
  }, []);

  const currentSaveIdentityRef = useRef(gameIdentity);
  useLayoutEffect(() => { currentSaveIdentityRef.current = gameIdentity; }, [gameIdentity]);
  const saveCurrentStudy = useCallback(async (update: boolean) => {
    if (libraryWritePendingRef.current || (update && !loadedSavedStudy)) return;
    libraryWritePendingRef.current = true;
    setLibraryWritePending(true);
    commitMoveComment();
    const snapshot = snapshotForStorage(currentGameSnapshot);
    setLastSaveWasUpdate(update);
    try {
      const { gameMode: mode, moves, ...rest } = snapshot;
      const saved = update && loadedSavedStudy
        ? await updateGameInLibrary(loadedSavedStudy, snapshot)
        : await saveGameToLibrary(mode, moves, rest);
      // A queued save belongs to the study that requested it, even if another
      // study was opened while a different tab held the library lock.
      if (currentSaveIdentityRef.current === gameIdentity) reportSaveResult(saved);
    } finally {
      libraryWritePendingRef.current = false;
      setLibraryWritePending(false);
    }
  }, [commitMoveComment, currentGameSnapshot, gameIdentity, loadedSavedStudy, reportSaveResult, saveGameToLibrary, snapshotForStorage, updateGameInLibrary]);
  const handleSaveGame = useCallback(() => saveCurrentStudy(false), [saveCurrentStudy]);
  const handleUpdateSavedStudy = useCallback(() => saveCurrentStudy(true), [saveCurrentStudy]);


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
  const [deleteUndo, setDeleteUndo] = useState<{ snapshot: MoveTreeSnapshot; removed: number; nodeId: string } | null>(null);
  const deleteUndoTimeout = useUndoTimeout(10000, () => setDeleteUndo(null));
  const dismissDeleteUndo = useCallback(() => {
    deleteUndoTimeout.cancel();
    setDeleteUndo(null);
  }, [deleteUndoTimeout]);
  // A new game may have the same root FEN, but its predecessor's undo cannot
  // be applied to it. Identity changes on reset, import, and library load.
  useEffect(() => { dismissDeleteUndo(); }, [dismissDeleteUndo, gameIdentity]);

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
    setDeleteUndo({ snapshot, removed, nodeId });
    deleteUndoTimeout.start();
  }, [captureTreeSnapshot, clearBoardMarkers, deleteNode, deleteUndoTimeout, handleCancelReview, reviewStatus, rootNodeId, treeNodes]);

  /**
   * Deleting a saved study is the most expensive thing a reader can do here,
   * and it was the only destructive action with no way back.
   *
   * Removing a move offers ten seconds of Undo; removing a *study* -- which
   * may be an evening of analysis, its variations, notes and review -- offered
   * a confirm step and then nothing. A confirm guards against the click you
   * did not mean to make; it does nothing about the one you did mean and
   * regret. This is the same toast, on the more valuable object.
   *
   * The record is captured before the delete rather than read back after, and
   * `restoreGameToLibrary` puts it back under its own id, so an open study or
   * a saved review still points at the same game.
   */
  const [libraryUndo, setLibraryUndo] = useState<{
    game: SavedGame; failed?: boolean; pending?: boolean; downloadFailed?: boolean;
  } | null>(null);
  const libraryUndoTimeout = useUndoTimeout(10000, () => setLibraryUndo(null));
  const libraryUndoVersionRef = useRef(0);
  const libraryUndoButtonRef = useRef<HTMLButtonElement>(null);
  const focusUndoRetryRef = useRef(false);
  useLayoutEffect(() => {
    if (!focusUndoRetryRef.current || libraryUndo?.pending) return;
    focusUndoRetryRef.current = false;
    // Disabling the pending button can blur it. Restore the retry action only
    // if the reader has not moved focus elsewhere while storage was busy.
    if (libraryUndo?.failed && (document.activeElement === document.body || document.activeElement === libraryUndoButtonRef.current)) {
      libraryUndoButtonRef.current?.focus({ preventScroll: true });
      libraryUndoButtonRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [libraryUndo]);
  const dismissLibraryUndo = useCallback(() => {
    libraryUndoVersionRef.current += 1;
    libraryUndoTimeout.cancel();
    setLibraryUndo(null);
  }, [libraryUndoTimeout]);

  const handleDeleteSavedGame = useCallback(async (id: string): Promise<boolean> => {
    const removed = savedGames.find((game) => game.id === id);
    if (!await deleteGameFromLibrary(id)) return false;
    if (!removed) return true;
    libraryUndoVersionRef.current += 1;
    setLibraryUndo({ game: removed });
    libraryUndoTimeout.start();
    return true;
  }, [deleteGameFromLibrary, libraryUndoTimeout, savedGames]);

  const handleUndoLibraryDelete = useCallback(async () => {
    if (!libraryUndo || libraryUndo.pending) return;
    // Once accepted, Undo must survive its original expiry while another tab
    // holds the library lock. A later deletion owns its own toast and timer.
    const version = libraryUndoVersionRef.current;
    const hadFocus = document.activeElement === libraryUndoButtonRef.current;
    libraryUndoTimeout.cancel();
    setLibraryUndo({ ...libraryUndo, pending: true });
    const restored = await restoreGameToLibrary(libraryUndo.game);
    if (version !== libraryUndoVersionRef.current) return;
    if (restored) {
      dismissLibraryUndo();
      return;
    }
    // Storage can refuse -- it is full, or blocked, or unreadable. Say so and
    // leave the toast up rather than closing it on a delete that stands.
    focusUndoRetryRef.current = hadFocus;
    setLibraryUndo({ game: libraryUndo.game, failed: true });
  }, [dismissLibraryUndo, libraryUndo, libraryUndoTimeout, restoreGameToLibrary]);

  const handleUndoDelete = useCallback(() => {
    if (!deleteUndo) return;
    if (reviewStatus === 'running') handleCancelReview();
    clearBoardMarkers();
    if (restoreDeletedSubtree(deleteUndo.snapshot, deleteUndo.nodeId)) {
      // Undo may restore a note on a replayed move without changing its ID.
      setMoveCommentRestoreVersion(version => version + 1);
    }
    dismissDeleteUndo();
  }, [clearBoardMarkers, deleteUndo, dismissDeleteUndo, handleCancelReview, restoreDeletedSubtree, reviewStatus]);
  const canDeleteCurrentMove = currentNodeId !== rootNodeId && !isAiTurn;

  /**
   * Take back, in a game against the engine.
   *
   * The move you regret and the reply it earned, removed together so the
   * board is yours to move on again -- or only your move, when the engine
   * has not answered it yet, in which case its search is cancelled first.
   * Every board a beginner has played on has this; here the only way back
   * was to step through the moves, which leaves them in the game and hands
   * the engine the turn. It rides the same deletion as the tree's cross,
   * undo toast included.
   */
  const takeBackPlies = isAiTurn ? 1 : 2;
  const canTakeBack = aiPlayActive && !gameResult && currentMoveIndex - takeBackPlies >= -1;
  const handleTakeBack = useCallback(() => {
    if (!canTakeBack) return;
    const cutNodeId = activeLineNodeIds[currentMoveIndex - takeBackPlies + 1];
    if (!cutNodeId) return;
    applyBestMoveRef.current = false;
    clearQueuedSearch();
    stopSearch();
    stepPendingRef.current = false;
    setAiMoveError(null);
    handleDeleteNode(cutNodeId);
  }, [activeLineNodeIds, canTakeBack, clearQueuedSearch, currentMoveIndex, handleDeleteNode, stopSearch, takeBackPlies]);

  const paletteCommands = useMemo<Command[]>(() => [
    { id: 'start-engine-analysis', label: 'Start engine analysis', keywords: ['download', 'pikafish', 'activate'],
      hint: 'Downloads about 53 MB on first use', disabled: engineEnabled, run: startEngineAnalysis },
    { id: 'new-game', label: 'New game', keywords: ['restart', 'reset'], run: () => { resetGame(); } },
    { id: 'library', label: 'Library', hint: 'Saved games', keywords: ['open', 'load'], run: openLibraryPanel },
    { id: 'search-library', label: 'Search library', hint: 'Find saved games, players, moves or notes', keywords: ['find', 'saved', 'filter'], run: () => {
      openLibraryPanel();
      setLibrarySearchRequest({ source: dialogLauncherRef.current });
    } },
    {
      id: 'save-game',
      label: 'Save game',
      hint: canSaveCurrentPosition ? undefined : 'Play a move or set up a position first',
      keywords: ['store', 'keep'],
      disabled: !canSaveCurrentPosition,
      run: handleSaveGame,
    },
    {
      id: 'update-saved-study', label: 'Update saved study',
      hint: loadedSavedStudy ? (savingWouldDropTheReview ? 'Replace the opened study; its different-line review will not be included' : 'Replace the opened study with this board and its variations') : 'Load or save a study first',
      keywords: ['replace', 'overwrite', 'library'], disabled: !loadedSavedStudy || !canSaveCurrentPosition,
      run: handleUpdateSavedStudy,
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
      /**
       * The palette could take a record *out* five ways -- PGN, WXF, FEN, a
       * file, a share link -- and bring one back in by none of them. Pasting
       * a game meant knowing the field lives under New game, which is where a
       * reader goes to throw the current game away, not to open one.
       */
      id: 'import-record',
      label: 'Import a game record',
      hint: 'Paste WXF, Chinese or coordinate moves',
      keywords: ['paste', 'load', 'open', 'pgn', 'wxf', 'uci', 'record', 'moves', 'line', 'notation', '\u68cb\u8c31'],
      run: () => {
        openNewGameMenu();
        // After the panel is up, or the field is not in the document yet.
        window.setTimeout(() => {
          document.getElementById('new-game-line-input')?.focus();
        }, 0);
      },
    },
    {
      id: 'setup-position',
      label: 'Set up a position',
      hint: 'Place the pieces by hand',
      keywords: ['editor', 'board', 'compose', 'endgame', 'fen', 'edit'],
      run: () => { setShowSettings(false); setEditorGameMode(null); setShowBoardEditor(true); },
    },
    {
      id: 'learn-rules', label: 'Learn the rules', hint: 'Nine guided board exercises',
      keywords: ['beginner', 'lesson', 'practice', 'learn', 'tutorial'],
      run: () => { setShowSettings(false); setShowRuleLessons(true); },
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
        openAnalysisPanel('tree');
        // After the panel is up, or the field is not in the document yet.
        window.setTimeout(() => {
          // A second command/dialog can open before this callback runs.
          if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
          document.getElementById('move-comment-input')?.focus();
        }, 0);
      },
    },
    {
      id: 'find-study-notes',
      label: 'Find study notes',
      hint: studyNotes.length ? 'Search notes in every variation and jump to a position' : 'Write or import a note first',
      keywords: ['search', 'comment', 'annotation', 'variation', '注释'],
      disabled: !studyNotes.length,
      run: () => {
        const source = dialogLauncherRef.current;
        openAnalysisPanel('tree');
        window.setTimeout(() => {
          if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
          const input = document.getElementById('study-notes-search') as HTMLInputElement | null;
          const active = document.activeElement;
          if (active !== document.body && active !== source && active !== input) return;
          const details = document.getElementById('study-notes') as HTMLDetailsElement | null;
          if (details) details.open = true;
          input?.focus(); input?.select();
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
      id: 'keep-best-line',
      label: 'Keep best engine line',
      hint: canKeepBestLine ? 'Add the full line without moving the board' : 'Wait for a new engine line to keep',
      keywords: ['variation', 'study', 'store', 'retain', 'analysis'],
      disabled: !canKeepBestLine,
      run: () => { if (topAnalysisPv) handleKeepPvLine(topAnalysisPv.moves); },
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
      id: 'pin-study-main-line', label: 'Set this as study main line',
      hint: 'Keep this line first in saved studies and PGN', keywords: ['promote', 'variation', 'pin', 'mainline'],
      disabled: !canPinStudyMainLine, run: pinActiveStudyLine,
    },
    {
      id: 'open-study-main-line', label: 'Go to study main line',
      keywords: ['mainline', 'return'], disabled: !mainLinePinned || studyControlsDisabled || viewingStudyMainLine,
      run: openStudyMainLine,
    },
    {
      id: 'unpin-study-main-line', label: 'Let PGN follow the selected line',
      hint: 'Clear the fixed main-line choice; keep every move', keywords: ['unpin', 'mainline', 'clear'],
      disabled: !mainLinePinned || studyControlsDisabled, run: unpinMainLine,
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
      run: () => { if (deepDiveActive) stopDeepDive(); else runDeepDive(); },
    },
    {
      id: 'compare-candidates',
      label: 'Compare candidate moves',
      hint: canCompareCandidates ? 'Choose up to five legal moves to analyze' : 'Available with the analysis engine ready',
      keywords: ['candidate', 'compare', 'searchmoves', 'what if', 'analysis'],
      disabled: !canCompareCandidates,
      run: openCandidatePicker,
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
      id: 'play-best-move',
      label: "Play the engine's move",
      hint: canPlayBestMove && topAnalysisPv?.moves[0]
        ? formatLineInStyle(board, [topAnalysisPv.moves[0]], notationStyle, 1)
        : engineEnabled ? 'No engine move yet' : 'Analysis engine only',
      keywords: ['best', 'engine', 'first', 'line', 'space'],
      shortcut: 'Space',
      disabled: !canPlayBestMove,
      run: () => { if (topAnalysisPv) handlePlayPvLine(topAnalysisPv.moves, 1); },
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
      id: 'take-back',
      label: 'Take back',
      hint: aiPlayActive
        ? (canTakeBack ? (takeBackPlies === 1 ? 'Your last move, before the engine answers it' : 'Your last move and the engine\'s reply') : 'Nothing to take back')
        : 'Only while playing against the engine',
      keywords: ['undo', 'retract', 'oops', 'back'],
      disabled: !canTakeBack,
      run: handleTakeBack,
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
      /**
       * The same toggle the top bar carries, and the board menu's "Hide arrows"
       * on touch -- reachable here by name rather than by knowing which of the
       * two places it lives in at this width, the way Flip board already is.
       */
      id: 'toggle-arrows',
      label: showArrows ? 'Hide arrows and markers' : 'Show arrows and markers',
      hint: showArrows
        ? 'Leaves the board bare: no engine suggestions, no last move, none of your own drawings'
        : 'The engine\'s suggestions, the last move, and anything you have drawn',
      keywords: ['arrow', 'marker', 'overlay', 'highlight', 'draw', 'annotation', 'clutter', 'clean', '\u7bad\u5934'],
      run: () => setShowArrows((shown) => !shown),
    },
    {
      id: 'clear-board-markers',
      label: 'Clear drawn arrows and highlights',
      hint: userArrows.length || userHighlights.length
        ? 'Remove your drawings; keep engine arrows and the last move'
        : 'No drawings to clear',
      keywords: ['erase', 'remove', 'marker', 'annotation', 'drawing', 'clean'],
      disabled: !userArrows.length && !userHighlights.length,
      run: clearBoardMarkers,
    },
    /**
     * One command per notation, rather than one that cycles: a reader who wants
     * Chinese should not have to pass through WXF to get there, and naming each
     * style makes it findable by the word they would actually type. The one in
     * use is listed but disabled, so the palette answers "which am I on?" as
     * well as "how do I change it?".
     */
    ...NOTATION_STYLES.map((style) => ({
      id: `notation-${style}`,
      label: NOTATION_PALETTE_LABELS[style],
      hint: notationStyle === style
        ? `Already in use. ${NOTATION_STYLE_DESCRIPTIONS[style]}`
        : NOTATION_STYLE_DESCRIPTIONS[style],
      keywords: ['notation', 'moves', 'record', 'style', 'write', ...NOTATION_STYLE_KEYWORDS[style]],
      disabled: notationStyle === style,
      run: () => setNotationStyle(style),
    })),
    {
      id: 'piece-style',
      label: pieceStyle === 'letters' ? 'Draw the pieces as characters' : 'Draw the pieces as letters',
      hint: pieceStyle === 'letters' ? PIECE_STYLE_DESCRIPTIONS.traditional : PIECE_STYLE_DESCRIPTIONS.letters,
      keywords: ['pieces', 'glyph', 'chinese', 'wxf', 'beginner', 'set', 'style'],
      run: () => setPieceStyle((style) => (style === 'letters' ? 'traditional' : 'letters')),
    },
    {
      /**
       * Sound is on by default and its only control was inside the settings
       * dialog. Muting is the one preference a reader reaches for in a hurry --
       * usually because someone else is in the room -- and "open settings,
       * find the row, press Off" is three steps too many for it. Running a
       * palette command is itself a gesture, so `handleSoundToggle` can still
       * unlock the audio device on the way back on.
       */
      id: 'toggle-sound',
      label: soundEnabled ? 'Turn sound off' : 'Turn sound on',
      hint: soundEnabled
        ? 'Moves, captures and checks stop making a noise'
        : 'A click for a move, a knock for a capture, a chime for check',
      keywords: ['sound', 'audio', 'mute', 'unmute', 'silence', 'quiet', 'volume', 'effects', '\u58f0\u97f3'],
      run: () => handleSoundToggle(!soundEnabled),
    },
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
      run: () => openAnalysisPanel('tree'),
    },
    {
      id: 'tab-review', label: 'Review panel', keywords: ['accuracy'], shortcut: 'R',
      run: () => openAnalysisPanel('review'),
    },
    {
      id: 'tab-engine', label: 'Engine panel', hint: engineEnabled ? undefined : 'Start analysis; about 53 MB on first use',
      keywords: ['pikafish', 'depth', 'pv'], shortcut: 'E',
      run: () => { startEngineAnalysis(); openAnalysisPanel('engine'); },
    },
    { id: 'panel-graph', label: 'Evaluation graph', keywords: ['chart', 'swing'], run: openGraphPanel },
    { id: 'go-first', label: 'Go to start', keywords: ['first', 'beginning'], shortcut: '↑', run: goToFirstMove },
    { id: 'go-last', label: 'Go to latest move', keywords: ['end', 'last'], shortcut: '↓', run: goToLatestMove },
    { id: 'settings', label: 'Settings', keywords: ['preferences', 'engine', 'options'], run: () => setShowSettings(true) },
  ], [startEngineAnalysis, openAnalysisPanel, studyControlsDisabled, canPinStudyMainLine, mainLinePinned, openStudyMainLine, pinActiveStudyLine, unpinMainLine, viewingStudyMainLine, canCompareCandidates, openCandidatePicker, canKeepBestLine, handleKeepPvLine, aiPlayActive, board, canCopyRecord, showArrows, soundEnabled, handleSoundToggle, canDeepDive, canPlayBestMove, canStartDrill, canTakeBack, drillMoments.length, handlePlayPvLine, handleTakeBack, pieceStyle, takeBackPlies, topAnalysisPv, moveCommentTarget, canDeleteCurrentMove, canExportCurrentLine, canHint, canPlayFromHere, canShowThreat, canStartReview, cloudBookEnabled, currentNodeId, handleCopyRecord, handleDeleteNode, isAiTurn, notationStyle, playFromHere, reviewStartTitle, reviewStatus, runHint, startMistakeDrill, canSaveCurrentPosition, canShareCurrentPosition, deepDiveActive, deepSearchMode,
      runThreatSearch, sideToMove, sideToMoveLabel, stopThreat, threatActive, threatFen,
      deepDiveBudget.moveTimeMs, engineEnabled, engineRequired, goToFirstMove, goToLatestMove, handleClearEngineHash,
      handleCopyFen, handleCopyPgn, handleCopyShareLink, handleDownloadPgn, handleRestartEngine,
      handleSaveGame, handleUpdateSavedStudy, loadedSavedStudy, savingWouldDropTheReview, isReady, openGraphPanel, openLibraryPanel, openNewGameMenu, resetGame, runDeepDive, startGameReview,
      stopDeepDive, studyNotes.length, clearBoardMarkers, userArrows.length, userHighlights.length])
  const handleLoadGame = useCallback((game: SavedGame, initialPly?: number, openPrimaryLine = false, selectedMoves?: string[]) => {
    initialPly ??= selectedMoves || openPrimaryLine ? undefined : game.cursorPly;
    if (selectedMoves && (!game.moveTree?.length || !moveTreeContainsLine(game.moveTree, selectedMoves))) return false;
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

    if (!checkpointBeforeReplaceRef.current()) return false;
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    setGameMode(game.gameMode);
    setWorkspaceMode('analysis');
    setLeftPanelTab('graph');
    const navigation = selectedMoves ? { moves: selectedMoves, result: undefined } : openPrimaryLine ? savedGameLine(game) : undefined;
    const loadedNodeIds = game.moveTree?.length
      ? loadMoveTree(game.moveTree, game.moves, game.startFen, initialPly, game.rootComment, game.mainLinePinned, navigation?.moves)
      : loadMoves(game.moves, game.startFen, initialPly, game.rootComment, game.mainLinePinned);
    setLoadedSavedStudy(savedGames.some(saved => saved.id === game.id) ? game : null);
    restoreRecordedResult(rootNodeId, game.rootResult);
    restoreRecordedResult(loadedNodeIds[game.moves.length - 1] ?? rootNodeId, savedResultToGameResult(game.result));
    setGameMetadata(game.metadata);
    if (!selectedMoves && (initialPly === undefined || initialPly >= (navigation?.moves.length ?? game.moves.length))) {
      // The loader has already derived checkmate/stalemate from the selected
      // board. Saved metadata may be stale or contradictory; only use it for
      // results the position cannot prove, such as resignation or an agreed draw.
      setGameResult(loadedResult => loadedResult ?? savedResultToGameResult(navigation ? navigation.result : game.result));
    }
    if (game.review) {
      setNodeReviewDataBulk(
        game.review.annotations
          .map((annotation) => {
            const nodeId = loadedNodeIds[annotation.moveIndex];
            if (!nodeId) return null;
            return {
              nodeId,
              evalScore: annotation.evalScore,
              evalScoreKind: annotation.evalScoreKind,
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
    }
    if (!game.review || selectedMoves) {
      setAnalysisTab('tree');
      setMobileAnalysisTab('moves');
    }
    setMobileView('analysis');
    setGraphLoadSweepToken((token) => token + 1);
    return true;
  }, [restoreRecordedResult, rootNodeId, handleCancelReview, hydrateReview, loadMoves, loadMoveTree, resetReview, savedGames, setGameMetadata, setGameResult, setNodeReviewDataBulk, stopAnalysis, validateMoveSequence, validateMoveTree]);

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
    setMobileView('board');
    // Focus only after the mobile board has returned to the layout.
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.xiangqi-board [tabindex="0"]')
        ?? document.querySelector<HTMLElement>('.xiangqi-board [data-file][data-rank]');
      target?.focus();
    });
  }, []);

  const incomingLink = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const params = readShareParams(window.location);
    const rawMoves = params.get('moves') ?? '';
    const hasLink = Boolean(rawMoves.trim() || params.get('tree') || params.get('fen') || params.get('note') || normalizeRecordedResult(params.get('rootResult')));
    if (!hasLink) return null;
    return { moveCount: extractUciMoveLine(rawMoves).length };
  }, []);

  const [recoveryProblems, setRecoveryProblems] = useState(() => readAutoSaveProblems());
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryDownloadFailed, setRecoveryDownloadFailed] = useState(false);
  const [recoveryDrafts, setRecoveryDrafts] = useState<RecoveryDraft[]>([]);
  const [autoSaveRecovery, setAutoSaveRecovery] = useState<RecoveryDraft | null>(null);
  /**
   * One list, because there were two. Every keyboard shortcut that moves
   * through the game is held off while a dialog is up, and that condition was
   * written out twice -- once for the letter shortcuts below, once as
   * WatchControls' `shortcutsEnabled` prop -- and the second copy was missing
   * the command palette and this modal.
   *
   * Both handlers also ignore a key aimed inside a `[role="dialog"]`, which is
   * what hid the gap: it only opens when focus is *not* inside one. Clicking
   * the palette's own count line -- ordinary text, not focusable -- blurs to
   * `body`, and the next arrow key stepped the game to the start position
   * behind the open palette, losing the reader's place in the analysis.
   */
  const aDialogIsOpen = Boolean(
    showSettings || showNewGameMenu || showCommandPalette || visibleGameResult || autoSaveRecovery || showBoardEditor || showRuleLessons || practiceStudy
  );
  /**
   * While a dialog is up, take the rest of the page out of the accessibility
   * tree as well as out of the tab order.
   *
   * Every dialog here already declares `aria-modal="true"`, which is what the
   * spec says to do, and `keepTabWithin` already holds the Tab key inside. But
   * `aria-modal` is honoured unevenly -- VoiceOver in particular has long let
   * a reader swipe straight past it -- and neither of those two things touches
   * browse mode. Measured with a dialog open: **151 controls behind it were
   * still reachable**, including the whole top bar and every square of the
   * board. A reader navigating by control or by heading could work the game
   * underneath a Settings panel without ever being told it was there.
   *
   * `inert` is the one attribute that covers focus, browse mode and pointer
   * events together, and it is supported everywhere this app runs.
   *
   * Applied to the shell's children rather than the shell, because the dialogs
   * render inside it -- inerting the shell would inert the dialog too. A child
   * holding *any* open dialog is left alone, so two stacked dialogs (the
   * recovery modal over the New Game menu, which is reachable) both stay live.
   *
   * A *layout* effect, and that is load-bearing. Closing a dialog restores
   * focus to whatever opened it, from the cleanup of the `useEffect` at the
   * top of this file -- and `focus()` on an inert element does nothing, so
   * with a passive effect here the launcher was still inert at that moment
   * and focus fell to `document.body`. Layout-effect cleanups run before
   * passive ones in the same commit, which is a guarantee about phases rather
   * than about which effect happens to be declared first.
   *
   * Re-run whenever a dialog opens or closes: the dialog has to be in the DOM
   * for `contains` to find it.
   */
  const dialogLauncherRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    const marked: Element[] = [];
    // Inerting an ancestor of the focused element blurs it to `body`, and every
    // dialog reads `document.activeElement` to learn who opened it. Remember
    // the launcher here, before that happens, and hand focus back when the page
    // stops being inert -- otherwise `body` propagates into each dialog's
    // "restore" and the opener is lost for good.
    const launcher = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (aDialogIsOpen) {
      // Keep the original page control through palette → dialog transitions.
      // The palette input can be removed before the next dialog records focus.
      if (!dialogLauncherRef.current && launcher && launcher !== document.body
        && !launcher.closest('[role="dialog"]')) {
        dialogLauncherRef.current = launcher;
      }
      const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
      // Nothing found means the dialog has not rendered yet; the next run of
      // this effect catches it, and inerting everything meanwhile would take
      // the whole app away for a frame.
      if (dialogs.length) {
        for (const child of shell.children) {
          if (dialogs.some((dialog) => child.contains(dialog))) continue;
          child.setAttribute('inert', '');
          marked.push(child);
        }
      }
    } else {
      dialogLauncherRef.current = null;
    }
    const originalLauncher = dialogLauncherRef.current;
    return () => {
      for (const child of marked) child.removeAttribute('inert');
      // Only when nothing else has claimed focus: a dialog that tracked its own
      // launcher restores from a passive cleanup, which runs after this.
      if (!marked.length) return;
      if (document.activeElement && document.activeElement !== document.body) return;
      const destination = launcher && launcher !== document.body && launcher.isConnected
        && !launcher.closest('[role="dialog"]') ? launcher : originalLauncher;
      if (destination?.isConnected) {
        destination.focus({ preventScroll: true });
      }
    };
  }, [aDialogIsOpen, showSettings, showNewGameMenu, showCommandPalette, visibleGameResult, autoSaveRecovery, showBoardEditor, showRuleLessons, practiceStudy]);

  const [autoSaveChecked, setAutoSaveChecked] = useState(false);

  useEffect(() => {
    if (autoSaveCheckedRef.current) return;
    autoSaveCheckedRef.current = true;
    const drafts = readAutoSaveDrafts();
    setRecoveryDrafts(drafts);
    // Credentialless previews keep temporary drafts only for the parent page's
    // lifetime. Reopening one should show its shared position, not a recovery dialog.
    const isolatedPreview = (window as Window & { credentialless?: boolean }).credentialless === true;
    if (drafts.length && !isolatedPreview) setAutoSaveRecovery(drafts[0]);
    setAutoSaveChecked(true);
  }, []);

  const [autoSaveIssue, setAutoSaveIssue] = useState<'failed' | 'too-large' | null>(null);
  const persistAutoSave = useCallback((snapshot: AutoSaveInput) => {
    const result = writeAutoSaveDraft(snapshot);
    setAutoSaveIssue(result === 'failed' || result === 'too-large' ? result : null);
  }, []);

  // currentGameSnapshot is a dependency on purpose: it carries the detected
  // opening and every evaluation a finished search stored on the tree, so as
  // those settle the stored snapshot is rewritten and a recovered game carries
  // them. The live evaluation is deliberately not in it -- see the ref above.
  useEffect(() => {
    if (!autoSaveChecked || autoSaveRecovery) return;
    const timeout = window.setTimeout(() => {
      persistAutoSave(snapshotForStorage(currentGameSnapshot));
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [autoSaveChecked, autoSaveRecovery, currentGameSnapshot, persistAutoSave, snapshotForStorage]);

  const currentGameSnapshotRef = useRef(currentGameSnapshot);
  useLayoutEffect(() => {
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
  const recoverySnapshot = useCallback(() => snapshotForStorage(currentGameSnapshotRef.current), [snapshotForStorage]);

  const lastCheckpointRef = useRef<{ signature: string; id: string } | null>(null);
  useLayoutEffect(() => {
    checkpointBeforeReplaceRef.current = () => {
      const snapshot = recoverySnapshot();
      if (!isWorthAutoSaving(snapshot)) return true;
      const signature = JSON.stringify(snapshot);
      if (signature === lastCheckpointRef.current?.signature && readAutoSaveDrafts().some(draft => draft.draftId === lastCheckpointRef.current?.id)) return true;
      const id = `checkpoint-${createSavedGameId()}`;
      const result = writeAutoSaveDraft(snapshot, undefined, Date.now(), id);
      if (result !== 'saved') {
        setAutoSaveIssue(result === 'too-large' ? 'too-large' : 'failed');
        setShowNewGameMenu(false);
        setShowSettings(false);
        return false;
      }
      lastCheckpointRef.current = { signature, id };
      setRecoveryDrafts(readAutoSaveDrafts().filter(draft => draft.draftId !== currentDraftId));
      return true;
    };
  }, [recoverySnapshot]);

  useEffect(() => {
    if (!autoSaveChecked || autoSaveRecovery) return;
    const flush = () => persistAutoSave(recoverySnapshot());
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [autoSaveChecked, autoSaveRecovery, persistAutoSave, recoverySnapshot]);

  /**
   * "Start fresh" throws away the only copy of an unfinished game.
   *
   * It is the sharpest of the app's destructive actions and had the least
   * around it. The library's delete asks twice and now offers an undo; a
   * deleted move offers an undo. This deleted six moves of play -- measured --
   * on one click of a button that arrives unbidden the moment the page opens,
   * sits beside Restore with the same weight, and is the kind of thing a
   * reader dismisses reflexively. The game was never saved anywhere else;
   * there is nothing to go back to.
   *
   * So the snapshot is kept for the length of the toast instead of dropped on
   * the spot, and Undo restores it the way Restore would have.
   */
  const [discardedAutoSave, setDiscardedAutoSave] = useState<{
    snapshot: AutoSavedGame; failed?: boolean; downloadFailed?: boolean;
  } | null>(null);
  const discardedAutoSaveTimeout = useUndoTimeout(30000, () => setDiscardedAutoSave(null));
  const dismissDiscardedAutoSave = useCallback(() => {
    discardedAutoSaveTimeout.cancel();
    setDiscardedAutoSave(null);
  }, [discardedAutoSaveTimeout]);

  const dismissAutoSaveRecovery = useCallback(() => {
    const discarded = autoSaveRecovery;
    if (discarded) clearAutoSaveDraft(discarded.draftId);
    setRecoveryDrafts(drafts => drafts.filter(draft => draft.draftId !== discarded?.draftId));
    setAutoSaveRecovery(null);
    if (!discarded || !isWorthAutoSaving(discarded.game)) return;
    setDiscardedAutoSave({ snapshot: discarded });
    // Longer than the ten seconds the other two undos run for: this one has to
    // survive the reader starting to look at the fresh board and realising
    // what they have lost, rather than an immediate "no, not that one".
    discardedAutoSaveTimeout.start();
  }, [autoSaveRecovery, discardedAutoSaveTimeout]);

  const undoDiscardedAutoSave = useCallback(() => {
    if (!discardedAutoSave) return;
    // The same path Restore takes, so an undone discard and a Restore leave
    // the board in the same state.
    if (!handleLoadGame(discardedAutoSave.snapshot.game)) {
      // Keep the toast. Dismissing it here would throw away the only copy of
      // the game a second time, with nothing on the board to show for it.
      discardedAutoSaveTimeout.cancel();
      setDiscardedAutoSave({ snapshot: discardedAutoSave.snapshot, failed: true });
      return;
    }
    // Written back at once rather than left to the effect below, which is
    // debounced by `AUTO_SAVE_DEBOUNCE_MS`. Putting the game on the board and
    // waiting six hundred milliseconds to write it down leaves a window in
    // which closing the tab loses it again -- which is the exact loss this
    // undo exists to prevent. Through `persistAutoSave` so that a storage
    // refusal is reported the way every other auto-save failure is: the game
    // is on the board by then, so that notice and its Download PGN are the
    // right place for it rather than a second message here.
    setLoadedSavedStudy(resolveLibrarySource(discardedAutoSave.snapshot.sourceLibrary, savedGames));
    persistAutoSave({ ...discardedAutoSave.snapshot.game, sourceLibrary: discardedAutoSave.snapshot.sourceLibrary });
    dismissDiscardedAutoSave();
  }, [discardedAutoSave, discardedAutoSaveTimeout, dismissDiscardedAutoSave, handleLoadGame, persistAutoSave, savedGames]);

  const restoreAutoSavedGame = useCallback(() => {
    if (!autoSaveRecovery) return;
    const restored = handleLoadGame(autoSaveRecovery.game);
    if (!restored) {
      setRecoveryError('This draft could not be loaded. Its original data is still kept; download it for repair or decide later.');
      return;
    }
    setRecoveryError(null);
    const source = resolveLibrarySource(autoSaveRecovery.sourceLibrary, savedGames);
    setLoadedSavedStudy(source);
    if (autoSaveRecovery.sourceLibrary && !source) {
      setShareLinkNotice({ tone: 'warning', text: 'Recovered as a separate study', detail: 'The saved library entry changed or was removed. Use Save to keep this draft as another copy.' });
    }
    if (restored && writeAutoSaveDraft({ ...autoSaveRecovery.game, sourceLibrary: source ? librarySource(source) : undefined }) === 'saved') {
      clearAutoSaveDraft(autoSaveRecovery.draftId);
      setRecoveryDrafts(drafts => drafts.filter(draft => draft.draftId !== autoSaveRecovery.draftId));
    }
    setAutoSaveRecovery(null);
  }, [autoSaveRecovery, handleLoadGame, savedGames]);

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
      if (isComposingKey(event)) return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (aDialogIsOpen) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable || target?.closest('[role="dialog"]')) {
        return;
      }
      // Space activates a focused button on its own; playing the engine's
      // move as well would do two things for one press.
      if (event.key === ' ' && (tag === 'BUTTON' || tag === 'A' || target?.closest('[role="button"]'))) {
        return;
      }
      if (event.repeat && ['f', 'd', 'x', 'h', ' ', 'e', 't', 'r'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        return;
      }
      const openEnginePanel = () => {
        openAnalysisPanel('engine');
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
            stopDeepDive();
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
        case ' ':
          // The lichess binding: the engine's first choice, played, with the
          // panel left where it is so the next press walks the line on.
          if (!canPlayBestMove || !topAnalysisPv?.moves[0]) return;
          handlePlayPvLine(topAnalysisPv.moves, 1);
          break;
        case 'e':
          startEngineAnalysis();
          openEnginePanel();
          break;
        case 't':
          openAnalysisPanel('tree');
          break;
        case 'r':
          openAnalysisPanel('review');
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    startEngineAnalysis, openAnalysisPanel, aDialogIsOpen, analysisTab, canDeepDive, canHint, canPlayBestMove, canShowThreat, deepDiveActive,
    handlePlayPvLine, runDeepDive, runHint, runThreatSearch, stopDeepDive,
    stopThreat, threatActive, topAnalysisPv,
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
  }, [analysisTab, canDeepDive, canShowThreat, isReady, readySessionId, runDeepDive, runThreatSearch]);

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
    if (!checkpointBeforeReplaceRef.current()) return;
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setAiMoveError(null);
    setGameMode('PvP');
    setWorkspaceMode('analysis');
    setLeftPanelTab('graph');
    setAnalysisTab('tree');
    setLoadedSavedStudy(null);
    loadMoves(game.moves);
    setMobileView('analysis');
    setMobileAnalysisTab('moves');
    setGraphLoadSweepToken((token) => token + 1);
  }, [handleCancelReview, loadMoves, resetReview, stopAnalysis]);

  const dismissGameOverForReview = useCallback(() => {
    if (gameOverKey) {
      setDismissedGameOverKey(gameOverKey);
    }
    startEngineAnalysis();
    setAnalysisTab('review');
    setMobileView('analysis');
    setMobileAnalysisTab('review');
  }, [gameOverKey, startEngineAnalysis]);

  // Board arrows: quality-colored last move + engine recommendation lines
  const selectBoardArrows = useMemo(createBoardArrowSelector, []);
  const allBoardArrows = useMemo(() => !showArrows ? undefined : selectBoardArrows({
    showArrows,
    lastMove: lastMoveFrom && lastMoveTo ? { from: lastMoveFrom, to: lastMoveTo, color: lastMoveArrowColor } : null,
    threatMove,
    hintMove,
    drillAsking,
    engineEnabled,
    analysisPvLines: candidateActive ? candidatePvLines : currentAnalysisPvLines,
    spotlightPvIndex,
    spotlightPvLine,
    // Not in a game against the engine. The book drew the moves the player
    // might make and, on the engine's turn, the replies it was weighing -- the
    // same help the rest of play mode withholds until Hint is asked for. The
    // book continuations list in the side panel is still there to read.
    openingCandidates: aiPlayActive ? NO_OPENING_CANDIDATES : openingCandidates,
    assistMode,
    userArrows,
  }), [selectBoardArrows, candidateActive, candidatePvLines, assistMode, drillAsking, hintMove, lastMoveFrom, lastMoveTo, lastMoveArrowColor, currentAnalysisPvLines, engineEnabled, openingCandidates, aiPlayActive, showArrows, spotlightPvIndex, spotlightPvLine, threatMove, userArrows]);
  const boardArrows = useMemo(() => selected
    ? allBoardArrows?.filter((arrow) => arrow.kind === 'last' || arrow.kind === 'user')
    : allBoardArrows, [allBoardArrows, selected]);
  // The hint is drawn in the focused-line colour, so name it for what it is.
  const boardArrowHint = hintMove && boardArrows?.some((arrow) => arrow.kind === 'engine-focus')
    ? 'Blue arrow: hint'
    : boardArrows?.some((arrow) => arrow.kind === 'engine-focus')
    ? 'Blue arrow: focused engine line'
    : boardArrows?.some((arrow) => arrow.kind === 'engine')
      ? 'Green arrows: engine lines'
      : boardArrows?.some((arrow) => arrow.kind === 'book')
        ? 'Amber arrows: opening book'
        : boardArrows?.some((arrow) => arrow.kind === 'last')
          ? 'Arrow: last move'
          : null;
  const boardDetailText = moveRuleHint ?? (selectedPiece ? legalMoveText : boardArrowHint ?? legalMoveText);

  const recoveryDraftControl = !autoSaveRecovery && recoveryDrafts.length > 0 ? (
    <button type="button" className={isMobile ? 'mobile-action-menu-btn' : 'top-action-btn'}
      role={isMobile ? 'menuitem' : undefined} data-testid="recovery-drafts-btn"
      aria-label={`Recovery drafts (${recoveryDrafts.length})`} title="Restore an unfinished study or replacement checkpoint"
      onClick={() => { setShowMobileBoardActionMenu(false); setAutoSaveRecovery(recoveryDrafts[0]); }}>
      <IconRefresh /><span className={isMobile ? undefined : 'btn-label-desktop'}>Recovery drafts ({recoveryDrafts.length})</span>
    </button>
  ) : null;

  const studySaveControl = <button type="button" className={isMobile ? 'mobile-tab-bar-btn study-save-control' : 'gc-pill study-save-control'}
    data-testid="study-save-status" disabled={!canSaveCurrentPosition}
    aria-labelledby={isMobile ? 'study-save-action' : undefined}
    aria-describedby={isMobile && studySaveLabel !== mobileStudySaveLabel ? 'study-save-state' : undefined}
    title={loadedSavedStudy ? 'Update saved study' : 'Save study'}
    onClick={loadedSavedStudy ? handleUpdateSavedStudy : handleSaveGame}>
    <span id="study-save-state" role="status" className={isMobile ? 'sr-only' : undefined}>{studySaveLabel}</span>
    {isMobile && <span id="study-save-action">{mobileStudySaveLabel}</span>}
  </button>;

  return (
    <main
      className="app-shell"
      data-mobile-view={isMobile ? mobileView : undefined}
      data-assist-mode={assistMode}
      data-ui-density={uiDensity}
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
                onClick={startEngineAnalysis}
                aria-pressed={workspaceMode === 'analysis'}
              >
                Analysis
              </button>
            </div>

            {!isMobile && studySaveControl}
            {!isMobile && !engineRequired && workspaceMode === 'analysis' && (
              <button type="button" className="gc-pill" data-testid="start-engine-analysis" onClick={startEngineAnalysis}
                title="Downloads about 53 MB on first use. Board editing and the library work without the engine.">
                Start engine analysis
              </button>
            )}
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
              {!isMobile && recoveryDraftControl}
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
                aria-label="Open commands"
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
                className="premium-select app-select"
                value={workspaceMode}
                onChange={(e) => e.target.value === 'analysis' ? startEngineAnalysis() : setWorkspaceMode('play')}
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
              <button type="button" className={`chip-btn settings-guide-toggle ${!guideDismissed ? 'chip-btn-primary' : ''}`}
                aria-pressed={!guideDismissed}
                aria-describedby="settings-guide-hint"
                onClick={() => {
                  const dismissed = !guideDismissed;
                  setGuideDismissed(dismissed);
                  writeStorage(BEGINNER_GUIDE_STORAGE_KEY, String(dismissed));
                }}>
                {!guideDismissed && <IconCheck aria-hidden="true" focusable="false" />}
                First-move guide
              </button>
              <p className="settings-hint" id="settings-guide-hint">Appears on empty local boards in Coach mode.</p>
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
              <span id="settings-piece-style-label" className="settings-label">Pieces</span>
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-piece-style-label">
                {PIECE_STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    className={`pill-btn ${pieceStyle === style ? 'pill-btn-active' : ''}`}
                    onClick={() => setPieceStyle(style)}
                    aria-pressed={pieceStyle === style}
                    aria-label={`${PIECE_STYLE_LABELS[style]}: Draw the pieces as ${style === 'letters' ? 'WXF letters' : 'traditional characters'}. ${PIECE_STYLE_DESCRIPTIONS[style]}`}
                    title={PIECE_STYLE_DESCRIPTIONS[style]}
                    data-testid={`piece-style-${style}`}
                  >
                    {PIECE_STYLE_LABELS[style]}
                  </button>
                ))}
              </div>
              <p className="settings-hint">{PIECE_STYLE_DESCRIPTIONS[pieceStyle]}</p>
            </div>

            <div className="settings-group">
              <label htmlFor="settings-game-mode">Game Mode</label>
              <select
                id="settings-game-mode"
                className="premium-select app-select"
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
              <label htmlFor="settings-ui-density">Interface density</label>
              <select id="settings-ui-density" className="premium-select app-select" value={uiDensity}
                onChange={event => setUiDensity(event.target.value as 'comfortable' | 'compact')}>
                <option value="compact">Compact</option>
                <option value="comfortable">Comfortable</option>
              </select>
              <p className="settings-hint">Comfortable enlarges panel text and controls while keeping the board size.</p>
            </div>

            <div className="settings-group">
              <span id="settings-layout-label" className="settings-label">Layout</span>
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-layout-label">
                <button
                  type="button"
                  className={`pill-btn ${leftPanelOpen ? 'pill-btn-active' : ''}`}
                  onClick={() => setLeftWidth(w => w > 0 ? 0 : initialPanelWidth(DEFAULT_LEFT_PANEL_WIDTH))}
                  aria-pressed={leftPanelOpen}
                >
                  Graph Panel
                </button>
                <button
                  type="button"
                  className={`pill-btn ${rightPanelOpen ? 'pill-btn-active' : ''}`}
                  onClick={() => setRightWidth(w => w > 0 ? 0 : initialPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH))}
                  aria-pressed={rightPanelOpen}
                >
                  Tree Panel
                </button>
              </div>
            </div>

            <details className="engine-advanced settings-engine-advanced" data-testid="advanced-engine-settings">
              <summary>Advanced engine settings</summary>
              <p className="settings-hint">Tune search depth, CPU and memory. Device defaults work without adjustment.</p>
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
                <div className="settings-inline-toggles" role="group" aria-labelledby="settings-engine-threads-label" aria-describedby="settings-engine-threads-help">
                  {engineThreadChoices.map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={`pill-btn ${engineBootConfig.threads === count ? 'pill-btn-active' : ''}`}
                      onClick={() => setEngineThreads(count)}
                      aria-pressed={engineBootConfig.threads === count}
                      aria-label={`Engine threads ${count}`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <p id="settings-engine-threads-help" className="settings-help">
                  Fewer threads leave more CPU available for other apps. More threads can speed up analysis.
                </p>
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
              <div className="settings-inline-toggles" role="group" aria-labelledby="settings-engine-hash-label" aria-describedby="settings-engine-hash-help">
                {engineHashChoices.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`pill-btn ${engineBootConfig.hashMB === size ? 'pill-btn-active' : ''}`}
                    onClick={() => setEngineHashMB(size)}
                    aria-pressed={engineBootConfig.hashMB === size}
                    aria-label={`Engine hash ${size} megabytes`}
                  >
                    {size}MB
                  </button>
                ))}
              </div>
              <p id="settings-engine-hash-help" className="settings-help">
                Hash remembers positions already searched. A larger hash can help longer analysis, but uses more memory.
              </p>
            </div>

            <div className="settings-group">
              <button
                type="button"
                className="pill-btn settings-resource-reset"
                aria-describedby="settings-engine-defaults-help"
                onClick={() => { setEngineThreads(undefined); setEngineHashMB(undefined); }}
              >
                Use device defaults
              </button>
              <p id="settings-engine-defaults-help" className="settings-help">
                Restore automatic thread and hash choices for this device. Changing resources restarts the engine.
              </p>
            </div>

            </details>

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
            <div className="new-game-menu-content" tabIndex={-1} onFocusCapture={event => {
              if (event.target instanceof HTMLElement) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}>
            <div className="new-game-menu-modes">
              {GAME_MODES.map(({ mode, label, description }) => (
                <button
                  key={mode}
                  type="button"
                  className={`new-game-mode-btn ${pendingGameMode === mode ? 'new-game-mode-btn-active' : ''}`}
                  onClick={() => setPendingGameMode(mode)}
                  aria-pressed={pendingGameMode === mode}
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
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
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
                  book, a composed problem, the one a friend described -- and,
                  when a pasted FEN drew a board and broke a rule, for that
                  board. Being told the generals face each other and then having
                  to rebuild the whole position to move one of them is the long
                  way round; the editor holds an illegal board on purpose, says
                  the same sentence about it, and keeps Done disabled until it
                  is answered. Only when the layout itself parsed: there is
                  nothing to hand over otherwise, and the button goes back to
                  meaning what it always meant. */}
              <button
                type="button"
                className="new-game-file-btn"
                style={{ marginTop: '0.5rem' }}
                onClick={() => {
                  setEditorGameMode(pendingGameMode);
                  setEditorSeed(refusedPosition);
                  closeNewGameMenu();
                  setShowBoardEditor(true);
                }}
                data-testid="open-board-editor-btn"
              >
                {refusedPosition ? 'Fix this position by hand' : 'Set up the board by hand'}
              </button>
            </div>
            <div className="new-game-fen-section">
              <p className="new-game-strength-label">Import Move Line</p>
              <form
                className="new-game-line-form"
                onKeyDown={event => {
                  if (!moveLineFileUndo || isComposingKey(event.nativeEvent) || !(event.ctrlKey || event.metaKey)
                    || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return;
                  event.preventDefault(); event.stopPropagation(); handleUndoMoveLineFile();
                }}
                onFocusCapture={event => {
                  if (!(event.target instanceof HTMLElement)) return;
                  if (!event.target.isSameNode(directImportCancelRef.current)) directImportFocusRef.current = event.target;
                  else if (!directImportFocusRef.current?.isConnected) directImportFocusRef.current = document.getElementById('new-game-line-input');
                }}
                onSubmit={(e) => { e.preventDefault(); handleImportMoveLine(moveLineInput, pendingGameMode); }}
              >
                <textarea
                  id="new-game-line-input"
                  className={`new-game-line-input ${moveLineError ? 'new-game-fen-input-error' : ''}`}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  value={moveLineInput}
                  data-file-drag={moveLineFileDragActive || undefined}
                  onDragLeave={() => setMoveLineFileDragActive(false)}
                  onDragEnd={() => setMoveLineFileDragActive(false)}
                  onDragOver={event => {
                    if (!event.dataTransfer.types.includes('Files')) return;
                    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
                    setMoveLineFileDragActive(true);
                  }}
                  onDrop={handleMoveLineFileDrop}
                  onChange={(e) => {
                    cancelDirectImport();
                    const nextValue = e.target.value;
                    if (isMoveImportTextTooLarge(nextValue)) {
                      setMoveLineError(`Move line is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.`);
                      return;
                    }
                    setMoveLineFileName('');
                    setMoveLineFileUndo(null);
                    setMoveLineInput(nextValue);
                    setMoveLineError(null);
                  }}
                  placeholder="1. 炮二平五 马8进7   ·   1. C2=5 H8+7   ·   1. b2e2 h9g7"
                  aria-label="Move line in coordinates, WXF or Chinese notation"
                  aria-invalid={moveLineError ? true : undefined}
                  aria-describedby={moveLineError ? 'new-game-line-error new-game-line-drop-hint' : 'new-game-line-drop-hint'}
                  rows={viewportSize.height <= 500 ? 2 : 3}
                  data-testid="uci-line-input"
                />
                <p id="new-game-line-drop-hint" className="settings-hint">Drop a PGN, XQF or text file here.</p>
                <div className="new-game-file-row">
                  <button
                    type="button"
                    className="new-game-file-btn"
                    onClick={handlePickMoveLineFile}
                    data-testid="load-uci-file-btn"
                  >
                    <IconUpload /> Open PGN or XQF
                  </button>
                  <input
                    ref={moveLineFileInputRef}
                    className="new-game-file-input"
                    type="file"
                    accept=".pgn,.txt,.xqf,text/plain,application/x-chess-pgn,application/octet-stream"
                    onChange={handleMoveLineFileChange}
                    aria-label="Open PGN file"
                    data-testid="uci-line-file-input"
                  />
                  {moveLineFileName ? <span className="new-game-file-name" title={moveLineFileName}>{moveLineFileName}</span> : null}
                  {moveLineFileUndo && <button type="button" className="new-game-file-btn" onClick={handleUndoMoveLineFile}
                    title="Undo file load (Ctrl/Cmd+Z)" aria-keyshortcuts="Control+Z Meta+Z">Undo file load</button>}
                </div>
                {directImportBusy && <p role="status">Checking the game… <button type="button" ref={directImportCancelRef} onClick={cancelDirectImport}>Cancel reading</button></p>}
                <div className="new-game-line-actions">
                  {moveLineError ? <span id="new-game-line-error" className="new-game-line-error" role="alert">{moveLineError}</span> : <span />}
                  <button
                    type="submit"
                    className="new-game-strength-btn new-game-strength-btn-active"
                    disabled={directImportBusy || !moveLineInput.trim()}
                    data-testid="import-uci-line-btn"
                  >
                    {directImportBusy ? 'Reading…' : 'Import'}
                  </button>
                </div>
              </form>
            </div>
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
        <div className="main-workspace">
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
            onClick={() => { if (leftWidth === 0) setLeftWidth(initialPanelWidth(DEFAULT_LEFT_PANEL_WIDTH)); }}
            onKeyDown={handleLeftResizeKeyDown}
            aria-label={leftPanelOpen ? `Resize left graph and library panel, ${Math.round(leftWidth)} pixels wide` : 'Expand left graph and library panel'}
            aria-orientation="vertical"
            aria-controls="left-panel-content"
            aria-valuemin={0}
            aria-valuemax={PANEL_MAX_WIDTH}
            aria-valuenow={Math.round(leftWidth)}
            title={leftPanelOpen ? 'Drag to resize. Press arrow keys to adjust, Home to collapse, End to restore.' : 'Click, press Enter, or press End to expand the left panel.'}
            /* The grip is the only visible way back to a collapsed panel, and
               under 1280px this one starts collapsed. `aria-expanded` is not
               available on a separator that carries a value, so the state is
               carried here for the stylesheet to read. */
            data-collapsed={leftPanelOpen ? undefined : 'true'}
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
                  <IconBarChart />Graph
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
                  <IconLibrary />Library
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
                  {graphVisible && <EvalGraph
                    history={moveHistory}
                    currentMoveIndex={currentMoveIndex}
                    currentEval={displayEvalScore}
                    currentEvalKind={displayEvalScoreKind}
                    currentEvalBoundText={displayEvalBoundText}
                    isSearching={isSearching}
                    activity={analysisActivity}
                    notationStyle={notationStyle}
                    branchCounts={graphBranchCounts}
                    rootBranchCount={rootGraphBranchCount}
                    loadSweepToken={graphLoadSweepToken}
                    onNavigate={jumpToMove}
                  />}
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
                            ? `${CLOUD_BOOK_SITE_NAME} did not answer.`
                            : 'Not in the cloud book.'}
                      </p>
                    )}
                    {cloudBookEnabled && cloudBook.status === 'error' ? (
                      <button type="button" className="chip-btn cloud-book-toggle" onClick={cloudBookReading.retry} data-testid="cloud-book-retry">
                        Retry cloud book
                      </button>
                    ) : null}
                    {cloudBookEnabled && (cloudPv.status === 'loading' || cloudPv.status === 'error' || cloudPv.status === 'unknown') ? (
                      <p className="library-explorer-note" role="status" data-testid="cloud-pv-status">
                        {cloudPv.status === 'loading'
                          ? 'Loading cloud line…'
                          : cloudPv.status === 'error'
                            ? 'Cloud line unavailable.'
                            : 'No cloud line for this position.'}
                      </p>
                    ) : null}
                    {cloudBookEnabled && cloudPv.status === 'error' ? (
                      <button type="button" className="chip-btn cloud-book-toggle" onClick={cloudPvReading.retry} data-testid="cloud-pv-retry">
                        Retry cloud line
                      </button>
                    ) : null}
                    {cloudBookEnabled && cloudPv.status === 'ok' && cloudPv.line && cloudPvTokens ? (
                      <div className="cloud-pv" data-testid="cloud-pv" data-depth={cloudPv.line.depth}>
                        <div className="cloud-pv-head">
                          <span>Cloud line</span>
                          <em title={`${CLOUD_BOOK_SITE_NAME} searched this position to depth ${cloudPv.line.depth}`}>
                            depth {cloudPv.line.depth} · {formatCloudBookScore(cloudPv.line.score, sideToMove)}
                          </em>
                        </div>
                        {/* Each move plays the line up to it, like an engine line;
                            the database's line is the one a strong player wants to
                            walk into, and it usually runs far past the engine's. */}
                        <div className="cloud-pv-moves">
                          <MoveLineStrip
                            tokens={cloudPvTokens.tokens}
                            remaining={cloudPvTokens.remaining}
                            disabled={Boolean(gameResult) || isAiTurn}
                            onPlay={(count) => handlePlayPvLine(cloudPv.line!.moves, count)}
                            title={(_, token) => `Play the cloud line up to ${token}`}
                            ariaLabel={(moveIndex, token) => `Play the cloud line up to move ${moveIndex + 1}, ${token}`}
                            testId={(moveIndex) => `cloud-pv-move-${moveIndex}`}
                          />
                        </div>
                      </div>
                    ) : null}
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
                  {libraryExplorerStatus !== 'ready' || libraryExplorerSkipped > 0 ? (
                    <p className="library-explorer-note" role="status" data-testid="library-explorer-status">
                      {libraryExplorerStatus === 'loading' ? 'Checking your saved games…'
                        : libraryExplorerStatus === 'error' ? 'Library explorer unavailable. Try again; your saved games are unchanged.'
                          : `${libraryExplorerSkipped} saved ${libraryExplorerSkipped === 1 ? 'game contains' : 'games contain'} invalid moves. Only reachable positions are shown.`}
                    </p>
                  ) : null}
                  {libraryExplorerStatus === 'error' ? (
                    <button type="button" className="chip-btn library-explorer-retry" onClick={retryLibraryExplorer} data-testid="library-explorer-retry">
                      Retry library explorer
                    </button>
                  ) : null}
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
                              title={isAiTurn ? 'Wait for the AI move to finish' : `In the primary line of ${move.games} saved games; other variations are excluded`}
                              aria-label={`Play ${formatLineInStyle(board, [move.uci], notationStyle, 1)}, in ${move.games} saved primary lines, record ${formatExplorerRecord(move)}`}
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
                      <LibraryMatches
                        hits={libraryPositionReport.hits}
                        total={libraryPositionReport.games}
                        onOpenLibrary={openLibraryPanel}
                        onOpen={(hit) => {
                          const game = savedGames.find(game => game.id === hit.gameId);
                          if (!game || !handleLoadGame(game, hit.ply, true)) return false;
                          setAnalysisTab('tree');
                          setMobileAnalysisTab('moves');
                          if (isMobile) setMobileView('board');
                          return true;
                        }}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <LazyPanelBoundary>
                {qaForcePanelError ? <QaForcedRenderError /> : (
                <React.Suspense fallback={<div className="library-loading" data-testid="library-loading">Loading library…</div>}>
                  <LazyLibraryPanel
                    initialViewState={libraryViewState.current}
                    onViewStateChange={rememberLibraryViewState}
                    searchFocusRequest={librarySearchRequest}
                    onSearchFocusHandled={handleLibrarySearchFocused}
                    savedGames={savedGames}
                    onLoadSavedGame={(game, moves) => handleLoadGame(game, moves?.length, false, moves)}
                    onDeleteSavedGame={handleDeleteSavedGame}
                    onRenameSavedGame={renameGameInLibrary}
                    loadedStudy={loadedSavedStudy ? {
                      id: loadedSavedStudy.id, canUpdate: canSaveCurrentPosition,
                      dropsReview: savingWouldDropTheReview,
                      updated: savedToast && lastSaveWasUpdate, update: handleUpdateSavedStudy,
                    } : undefined}
                    onPracticeSavedGame={game => {
                      if (isAiMode) { stepPendingRef.current = false; pause(); stopAnalysis(); }
                      setPracticeStudy(game);
                    }}
                    libraryState={libraryState}
                    onLibraryChange={refreshGameLibrary}
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
          {/* The board stage header -- a kicker, the mode as a heading, a
              description, and turn/ply/eval/opening chips -- was removed here.
              A top-level `.board-stage-header { display: none }` had hidden it at
              every width since 8f8f897 ("Polish xiangqi board UX"), so it had
              been built on every render and painted on none. Everything it said
              is still on screen elsewhere: the mode in the bottom bar badge,
              turn and ply in the position dock, the evaluation in the eval bar
              beside the board, and the opening in its own pill. */}
          {isMobile && mobileView === 'board' && (
            <div className="mobile-board-header">
              <div className="mobile-board-turn-info">
                <span className={`turn-dot turn-dot-${sideToMove === 'w' ? 'red' : 'black'}`} />
                <span className="mobile-turn-label">{sideToMove === 'w' ? 'Red' : 'Black'}</span>
                {!engineRequired && workspaceMode === 'analysis' && (
                  <button type="button" className="gc-pill" data-testid="start-engine-analysis" onClick={startEngineAnalysis}
                    aria-label="Analyze this position" title="Downloads about 53 MB on first use">Analyze</button>
                )}
                {/* The phone's stand-in for the eval bar, so it reads the same
                    value, the stored one included when no line is live. */}
                {engineEnabled && evalBarScore !== null && (
                  <span
                    className={`mobile-eval-chip ${displayEvalClass}`}
                    aria-label={liveEvalLabel}
                    title={liveEvalLabel}
                  >
                    {evalBarText}
                    {displayEvalBoundText && <span className="board-eval-bound" data-testid="board-eval-bound" aria-hidden="true">Bound</span>}
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
                  ref={mobileMoreActionsButtonRef}
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
              {/* A row of its own, like the notice above it, rather than a
                  fourth item in the turn info. Inside that group the name was
                  what pushed the header onto a second row -- the one the engine
                  status a few lines up is worded tersely to avoid -- and it
                  pushed the *buttons* down there, left-aligned, while the name
                  kept the line the buttons had. An opening name is too long to
                  share a 390px row with five controls at any useful length, so
                  give it the row instead of a truncation to "C...". */}
              {detectedOpening && (
                <span className="mobile-opening-pill" title={detectedOpening.name}>
                  {detectedOpening.name}
                </span>
              )}
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
                    aria-label={`Play from here against the engine as ${sideToMove === 'w' ? 'Red' : 'Black'}`}
                    data-testid="mobile-play-from-here-btn"
                  >
                    <IconPlay />
                    <span>Play from here</span>
                  </button>
                ) : null}
                {aiPlayActive ? (
                  <button
                    className="mobile-action-menu-btn"
                    type="button"
                    onClick={() => { setShowMobileBoardActionMenu(false); handleTakeBack(); }}
                    disabled={!canTakeBack}
                    role="menuitem"
                    title={canTakeBack ? 'Take back your last move' : 'Nothing to take back'}
                    data-testid="mobile-take-back-btn"
                  >
                    <IconSkipBack />
                    <span>Take back</span>
                  </button>
                ) : null}
                {/* The bottom bar carries Hint on a desktop and is hidden on a
                    phone, where the only way to it was the palette. The answer
                    is the arrow on the board, which the phone can see. */}
                {aiPlayActive ? (
                  <button
                    className="mobile-action-menu-btn"
                    type="button"
                    onClick={() => { setShowMobileBoardActionMenu(false); runHint(); }}
                    disabled={!canHint}
                    role="menuitem"
                    title={canHint ? 'Ask the engine what it would play for you' : isAiTurn ? 'Wait for your turn' : 'No hint right now'}
                    data-testid="mobile-hint-btn"
                  >
                    <IconSpark />
                    <span>Hint</span>
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
                <button
                  className={`mobile-action-menu-btn ${savedToast ? 'mobile-action-menu-btn-active' : ''} ${saveFailedToast ? 'mobile-action-menu-btn-warn' : ''}`}
                  type="button"
                  onClick={handleSaveGame}
                  disabled={!canSaveCurrentPosition}
                  role="menuitem"
                  title={saveFailedToast ? 'Save failed' : savedToast ? 'Saved' : savingWouldDropTheReview ? 'Save current game. The review covers a different line, so it is not saved with it.' : 'Save current game'}
                  aria-label={saveFailedToast ? 'Current game save failed' : savedToast ? 'Saved game in this browser' : 'Save game in this browser'}
                  data-testid="mobile-save-game-btn"
                >
                  {saveFailedToast ? <IconX /> : savedToast ? <IconCheck /> : <IconSave />}
                  <span>{saveFailedToast ? 'Save failed' : savedToast ? 'Saved game' : 'Save game'}</span>
                </button>
                {recoveryDraftControl}
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
                    aria-label={exportFailureKey === 'copy-share' ? 'Share link copy failed' : copiedShareToast ? 'Copied link to this position' : 'Copy link to this position'}
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
                  aria-label={exportFailureKey === 'copy-fen' ? 'FEN copy failed' : copiedFenToast ? 'Copied FEN for this position' : 'Copy FEN for this position'}
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
                  aria-label="Open commands"
                  data-testid="mobile-command-palette-btn"
                >
                  <IconSearch />
                  <span>Commands</span>
                </button>
                <button
                  className="mobile-action-menu-btn"
                  type="button"
                  onClick={() => {
                    mobileMoreActionsButtonRef.current?.focus({ preventScroll: true });
                    toggleSettings();
                  }}
                  role="menuitem"
                  aria-label="Open settings"
                  aria-haspopup="dialog"
                  aria-expanded={showSettings}
                  aria-controls="settings-dialog"
                  data-testid="mobile-open-settings-btn"
                >
                  <IconSettings />
                  <span>Settings</span>
                </button>
              </div>
            </>
          ) : null}
          {isMobile && beginnerGuide}
          <div className="mobile-board-center">
            <div className={`board-workspace${drill ? ' board-workspace-drill' : ''}${isMobile && aiPlayActive && hintText ? ' board-workspace-hint' : ''}`}>
              <div className="board-wrap">
                {/* Absolutely positioned against .board-wrap, which the
                    aspect-ratio sizing keeps exactly board-shaped, so the bar
                    is board-height without joining the grid that took such
                    care to derive that height. */}
                {showEvalBar ? (
                  <EvalBar
                    evalScore={evalBarScore}
                    evalText={evalBarText}
                    boundText={displayEvalBoundText}
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
                  onCancelSelection={handleCancelBoardSelection}
                  // Dragging is offered for exactly the pieces a click could
                  // move: the side to play, and only while the board is taking
                  // moves at all. `handleSquareClick` already refuses the other
                  // cases, but refusing them after the piece has been dragged
                  // across the board and dropped is not the same as never
                  // offering the grab cursor.
                  draggableSide={!gameResult && !isAiTurn ? sideToMove : null}
                  pieceStyle={pieceStyle}
                  notationStyle={notationStyle}
                  orientation={orientation}
                  highlights={showArrows ? userHighlights : undefined}
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
                        {drillVerdictKind === 'unavailable' && (
                          <button type="button" className="chip-btn chip-btn-primary" onClick={retryDrillAnalysis} disabled={!canRetryDrillAnalysis} data-testid="drill-reanalyze-btn">Retry analysis</button>
                        )}
                        {(drillVerdictKind === 'wrong' || drillVerdictKind === 'repeat' || drillVerdictKind === 'unavailable') ? (
                          <button type="button" className="chip-btn chip-btn-primary" onClick={retryDrillMoment} data-testid="drill-retry-btn">Try again</button>
                        ) : null}
                        {(drillVerdictKind === 'asking' || drillVerdictKind === 'pending' || drillVerdictKind === 'wrong' || drillVerdictKind === 'repeat' || drillVerdictKind === 'unavailable') ? (
                          <button type="button" className="chip-btn" onClick={showDrillAnswer} data-testid="drill-show-btn">Show answer</button>
                        ) : null}
                        <button
                          type="button"
                          className={`chip-btn ${drillVerdictKind === 'best' || drillVerdictKind === 'good' || drillVerdictKind === 'shown' ? 'chip-btn-primary' : ''}`}
                          onClick={nextDrillMoment}
                          data-testid="drill-next-btn"
                        >
                          {drillVerdictKind === 'asking' || drillVerdictKind === 'pending' || drillVerdictKind === 'unavailable' ? 'Skip' : drillIsLast ? 'Finish' : 'Next'}
                        </button>
                        <button type="button" className="chip-btn" onClick={stopMistakeDrill} aria-label="Stop learning from mistakes" data-testid="drill-stop-btn">Stop</button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="position-dock" role="region" aria-label="Position status" tabIndex={isMobile ? 0 : undefined}>
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
                <div className="position-stat position-stat-selection">
                  <span>{selectedPiece ? selectedSquareText : 'Selection'}</span>
                  <strong>{selectedPieceText}</strong>
                  <em
                    className={moveRuleHint ? 'position-warning' : undefined}
                    title={boardDetailText}
                  >
                    {boardDetailText}
                  </em>
                </div>
                <div className="position-stat position-stat-material">
                  <span>Material</span>
                  <strong>{materialText}</strong>
                  <em>Red {formatMaterialValue(materialSummary.redMaterialTenths)} · Black {formatMaterialValue(materialSummary.blackMaterialTenths)}</em>
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
                    ref={repetitionNoticeRef}
                    tabIndex={-1}
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
                    ) : canAskCloudAboutChase ? (
                      <button
                        type="button"
                        className="position-stat-cloud-ask"
                        onClick={() => setCloudBookEnabled(true)}
                        data-testid="repetition-ask-cloud"
                        title={`Look this repetition up on ${CLOUD_BOOK_SITE_NAME}. The position and the moves that reached it leave this machine, and the cloud book stays on until you turn it off.`}
                      >
                        Ask {CLOUD_BOOK_SITE_NAME} whether this is a chase
                      </button>
                    ) : null}
                    {cloudRule.status === 'error' && <button type="button" className="position-stat-cloud-ask"
                      data-testid="repetition-cloud-retry" onClick={event => {
                        if (document.activeElement === event.currentTarget) repetitionNoticeRef.current?.focus({ preventScroll: true });
                        cloudRule.retry();
                      }}>Retry cloud ruling</button>}
                  </div>
                ) : null}
                {/* The other rule the app will not adjudicate but the engine
                    does. Pikafish can draw at sixty counted capture-free moves
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
                {isMobile && aiPlayActive ? (
                  <div
                    className={hintText ? 'mobile-hint-status' : 'sr-only'}
                    data-testid="mobile-hint-status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {hintText}
                  </div>
                ) : null}
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

        {isMobile && mobileView === 'analysis' && (
          <AnalysisBoardContext board={board} orientation={orientation} pieceStyle={pieceStyle}
            positionLabel={`${sideToMove === 'w' ? 'Red' : 'Black'} to move · ${timelineCompactText}`}
            onReturn={focusBoard} />
        )}

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
            {workspaceMode === 'analysis' ? (
              <button
                type="button"
                role="tab"
                id="mobile-analysis-tab-engine"
                className={`mobile-tab-btn ${mobileAnalysisTab === 'engine' ? 'active' : ''}`}
                onClick={() => {
                  startEngineAnalysis();
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
            onClick={() => { if (rightWidth === 0) setRightWidth(initialPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH)); }}
            onKeyDown={handleRightResizeKeyDown}
            aria-label={rightPanelOpen ? `Resize right analysis panel, ${Math.round(rightWidth)} pixels wide` : 'Expand right analysis panel'}
            aria-orientation="vertical"
            aria-controls="right-analysis-content"
            aria-valuemin={0}
            aria-valuemax={PANEL_MAX_WIDTH}
            aria-valuenow={Math.round(rightWidth)}
            title={rightPanelOpen ? 'Drag to resize. Press arrow keys to adjust, Home to collapse, End to restore.' : 'Click, press Enter, or press End to expand the right panel.'}
            /* Same as its twin: this one is never collapsed by default, but a
               reader who collapses it has the same one grip to find. */
            data-collapsed={rightPanelOpen ? undefined : 'true'}
            data-testid="right-panel-resize-handle"
          >
            <span className="resize-pill" />
          </div>
          <div className="panel-inner" style={{ opacity: (!isMobile && rightWidth === 0) ? 0 : 1 }}>
            <header className="panel-header panel-header-tabs">
              <h2 id="right-panel-heading">Analysis</h2>
              <div className="analysis-tab-strip" role="tablist" aria-label="Analysis panels" onKeyDown={handleTablistKeyDown}>
                {/* T, R and E switch these tabs from anywhere, and the palette
                    lists all three as shortcuts -- but only the buttons for F,
                    D, X and H were saying so. A reader who tabs to one now hears
                    the key, the way they already do on Flip. */}
                <button
                  type="button"
                  role="tab"
                  id="analysis-tab-tree-tab"
                  className={`analysis-tab-btn ${analysisTab === 'tree' ? 'active' : ''}`}
                  onClick={() => {
                    setAnalysisTab('tree');
                    setMobileAnalysisTab('moves');
                  }}
                  title="Game tree (T)"
                  aria-label="Open game tree"
                  aria-keyshortcuts="T"
                  aria-selected={analysisTab === 'tree'}
                  aria-controls="right-analysis-content"
                  data-testid="analysis-tab-tree"
                >
                  <IconTree />Tree
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
                  title="Game review (R)"
                  aria-label="Open game review"
                  aria-keyshortcuts="R"
                  aria-selected={analysisTab === 'review'}
                  aria-controls="right-analysis-content"
                  data-testid="analysis-tab-review"
                >
                  <IconBarChart />Review
                </button>
                {workspaceMode === 'analysis' ? (
                  <button
                    type="button"
                    role="tab"
                    id="analysis-tab-engine-tab"
                    className={`analysis-tab-btn ${analysisTab === 'engine' ? 'active' : ''}`}
                    onClick={() => {
                      startEngineAnalysis();
                      setAnalysisTab('engine');
                      setMobileAnalysisTab('engine');
                    }}
                    title="Engine panel (E)"
                    aria-label="Open engine panel"
                    aria-keyshortcuts="E"
                    aria-selected={analysisTab === 'engine'}
                    aria-controls="right-analysis-content"
                    data-testid="analysis-tab-engine"
                  >
                    <IconBot />Engine
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
                  {breadcrumbVisible && <div
                    className="tree-breadcrumb"
                    ref={treeBreadcrumbRef}
                    role="toolbar"
                    aria-label="Current line, one chip per move"
                    aria-orientation="horizontal"
                    aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                    onClick={event => {
                      const chip = event.target instanceof Element
                        ? event.target.closest<HTMLButtonElement>('.tree-breadcrumb-chip') : null;
                      const nodeId = chip?.dataset.breadcrumbNodeId;
                      if (chip && nodeId && event.currentTarget.contains(chip)) jumpToNode(nodeId);
                    }}
                  >
                    {breadcrumbNodeIds.map((nodeId, index) => {
                      return <BreadcrumbChip key={nodeId} nodeId={nodeId} index={index}
                        record={treeNodes[nodeId]?.record} rootFen={rootFen} notationStyle={notationStyle}
                        isRoot={nodeId === rootNodeId} isCurrent={nodeId === currentNodeId}
                        isTabStop={index === breadcrumbTabStopIndex} hasNext={index < breadcrumbNodeIds.length - 1}
                        onFocusIndex={setRovingBreadcrumbIndex}
                        onKeyDown={handleBreadcrumbKeyDown} />;
                    })}
                  </div>}
                  {!isMobile && beginnerGuide ? beginnerGuide : moveTreeVisible && <MoveListTree
                    treeNodes={treeNodes}
                    rootNodeId={rootNodeId}
                    rootFen={rootFen}
                    currentNodeId={currentNodeId}
                    currentMoveIndex={currentMoveIndex}
                    activeLineNodeIds={activeLineNodeIds}
                    notationStyle={notationStyle}
                    onNavigateNode={jumpToNode}
                    onDeleteNode={handleDeleteNode}
                    onShowBoard={isMobile ? () => setMobileView('board') : undefined}
                    onOpenLibrary={openLibraryPanel}
                  />}
                  {lineRecordedResult && <p className="recorded-line-result" data-testid="recorded-line-result">
                    Recorded line result: {lineRecordedResult === 'draw' ? 'Draw' : lineRecordedResult === 'red-wins' ? 'Red wins' : 'Black wins'} ({RESULT_TAG[lineRecordedResult]})
                  </p>}
                  {hasMoveTreeMoves && (hasStudyBranches || mainLinePinned || Boolean(treeNodes[rootNodeId]?.mainLineRevision)) && <StudyMainLineControls
                    pinned={Boolean(mainLinePinned)} viewingMainLine={viewingStudyMainLine} disabled={studyControlsDisabled}
                    onPin={pinActiveStudyLine} onOpen={openStudyMainLine} onUnpin={unpinMainLine} />}
                  {/* The thinking, beside the moves. Everything attached to a
                      move here was written by the engine -- an evaluation, a
                      best move, a review note it overwrites on every re-run --
                      so a study built on this board carried the line and none of
                      the reasoning for it. The note is the reader's, kept in a
                      separate field for exactly that reason. */}
                  <GameMetadataEditor metadata={gameMetadata} onChange={setGameMetadata} />
                  <StudyNotes notes={studyNotes} treeNodes={treeNodes} rootId={rootNodeId} rootFen={rootFen}
                    notationStyle={notationStyle} currentNodeId={currentNodeId} gameIdentity={gameIdentity}
                    initialViewState={studyNotesViewRef.current?.identity === gameIdentity ? studyNotesViewRef.current.state : undefined}
                    onViewStateChange={rememberStudyNotesView}
                    disabled={studyControlsDisabled} onNavigate={jumpToNode} />
                  {treeNodes[currentNodeId]?.record && <ImportedGlyphs key={currentNodeId} gameIdentity={gameIdentity}
                    nags={treeNodes[currentNodeId]?.record?.nags} disabled={studyControlsDisabled}
                    onChange={nags => setNodeGlyphs(currentNodeId, nags)} />}
                  {[currentNodeId, ...(treeNodes[currentNodeId]?.childrenIds ?? [])].map(id => {
                    const node = treeNodes[id];
                    const analysis = node?.record?.analysis;
                    return analysis ? <StudyAnalysisCard key={id} analysis={analysis}
                      move={nodeLabel(id, rootNodeId, treeNodes, notationStyle, rootFen)}
                      onSource={() => jumpToNode(node.parentId!)} /> : null;
                  })}
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
                      onKeyDown={(event) => {
                        // Every single-key shortcut stands down while this has
                        // focus, and nothing but the mouse gave it back: Escape
                        // kept the caret here. Escape, or Ctrl/Cmd+Enter, now
                        // leaves the note -- the blur saves it -- so F, T and
                        // the arrows answer again. Not mid-composition: an IME
                        // uses Escape to cancel its candidate, and pinyin is how
                        // many readers write these notes.
                        if (isComposingKey(event.nativeEvent)) return;
                        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                      disabled={!moveCommentTarget}
                      maxLength={MAX_MOVE_COMMENT_LENGTH}
                      rows={2}
                      spellCheck
                      placeholder={currentNodeId === rootNodeId ? 'Plans, themes, or questions about this position' : moveCommentTarget ? 'Why this move' : ''}
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
                <DeferredReviewPanel
                  status={reviewStatus}
                  error={reviewError}
                  progress={reviewProgress}
                  progressCompleted={reviewCompletedSteps}
                  progressTotal={reviewTotalSteps}
                  onReviewedLine={reviewMatchesActiveLine}
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
                        onClick={deepDiveActive ? stopDeepDive : runDeepDive}
                        disabled={!deepDiveActive && !canDeepDive}
                        title={deepDiveActive
                          ? 'Stop the deep search and keep what it has found (D)'
                          : deepSearchMode === 'infinite'
                            ? 'Search this position until stopped, including while this tab is in the background (D)'
                            : `Search this position to depth ${deepDiveBudget.depth} for up to ${Math.round(deepDiveBudget.moveTimeMs / 1000)}s, and keep going if this tab goes to the background (D)`}
                        aria-keyshortcuts="D"
                        aria-label={deepDiveActive
                          ? 'Stop the deep search'
                          : `Go deep: search this position, ${deepSearchLimitText}`}
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
                          ? 'Threat on: stop showing the threat and analyse the position as it stands'
                          : 'Show the threat: let the opponent move first'}
                        data-testid="show-threat-btn"
                      >
                        <IconTarget aria-hidden="true" focusable="false" /> {threatActive ? 'Threat on' : 'Threat'}
                      </button>
                      <button
                        type="button"
                        ref={candidateButtonRef}
                        className={`engine-cache-btn ${candidatePickerOpen ? 'engine-pv-btn-active' : ''}`}
                        onClick={candidatePickerOpen ? closeCandidatePicker : openCandidatePicker}
                        disabled={!candidatePickerOpen && !canCompareCandidates}
                        aria-expanded={candidatePickerOpen}
                        aria-controls={candidatePickerOpen ? 'candidate-comparison' : undefined}
                        title="Choose legal moves and compare only their continuations"
                        data-testid="open-candidate-comparison"
                      >
                        <IconBarChart aria-hidden="true" /> Compare
                      </button>
                      <details className="engine-advanced" data-testid="advanced-engine-maintenance">
                        <summary>Engine maintenance</summary>
                        <p>Restart a stalled engine or clear remembered search positions.</p>
                        <div className="engine-advanced-actions">
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
                        aria-label={engineHashFeedback === 'queued' ? 'Engine hash clear queued' : engineHashFeedback === 'cleared' ? 'Engine hash cleared' : 'Clear hash: empty the engine search table'}
                        data-testid="clear-engine-hash-btn"
                      >
                        {engineHashFeedback === 'queued' ? <><IconRefresh aria-hidden="true" focusable="false" /> Queued</> : engineHashFeedback === 'cleared' ? <><IconCheck aria-hidden="true" focusable="false" /> Cleared</> : 'Clear Hash'}
                      </button>
                        </div>
                      </details>
                    </div>
                  </div>
                  {engineRecoveryNotice ? (
                    <div
                      className={`engine-recovery-notice engine-recovery-notice-${engineRecoveryNotice.tone}`}
                      role="status"
                      data-testid="engine-recovery-notice"
                    >
                      <strong>{engineRecoveryNotice.text}</strong>
                      <span>{engineRecoveryHint}</span>
                    </div>
                  ) : null}
                  {candidatePickerOpen ? (
                    <CandidatePanel
                      key={currentPositionCommand}
                      board={board} side={sideToMove} notation={notationStyle}
                      active={candidateActive} completed={candidateSearch?.completed ?? false}
                      searching={candidateActive && (isSearching || isSearchQueued)}
                      canCompare={canCompareCandidates}
                      canPlay={isReady && !gameResult && !isAiTurn && reviewStatus !== 'running'}
                      budgetLabel={candidateActive ? candidateSearch!.budgetLabel : candidateBudgetLabel}
                      lines={candidatePvLines}
                      onCompare={compareCandidateMoves} onEdit={leaveCandidateSearch} onClose={closeCandidatePicker}
                      onStop={stopDeepDive}
                      onPlay={handlePlayPvLine} onKeep={handleKeepPvLine}
                      isKept={isAnalysisLineKept} hasLine={moves => hasMoveTreeLine(treeNodes, currentNodeId, moves)}
                    />
                  ) : null}
                  {/* The threat replaces the candidate list rather than sitting
                      beside it, because the two are evaluations of different
                      positions and a reader comparing them side by side would be
                      comparing nothing. The card says whose move it is showing. */}
                  {candidateActive ? null : threatActive ? (
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
                      const bestReading = currentAnalysisPvLines[0] ?? pv;
                      const lineStanding = describePvStanding(bestReading, pv, i);
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
                      const lineExists = hasMoveTreeLine(treeNodes, currentNodeId, pv.moves);
                      const lineKept = isAnalysisLineKept(pv.moves);
                      const depthLabel = pv.depth ? `depth ${pv.depth}` : 'depth pending';
                      const pvLineText = pv.moves.length ? formatLineInStyle(board, pv.moves, notationStyle, 7) : 'No moves yet';
                      const pvTokens = formatLineTokensInStyle(board, pv.moves, notationStyle, 7);
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
                              <span
                                className={`pv-line-standing ${lineStanding === 'Best' ? 'pv-line-standing-best' : ''}`}
                                title={lineStanding === 'Not exact'
                                  ? i === 0
                                    ? 'This score is a bound; an exact evaluation is not available yet.'
                                    : 'At least one score is a bound, so an exact comparison is not available yet.'
                                  : i === 0 ? 'The engine’s first principal variation.'
                                  : 'Compared with Line 1 from the side to move’s perspective. Live scores can update at different times.'}
                              >
                                {lineStanding}
                              </span>
                            </div>
                            <span className="turnNum">
                              Depth {pv.depth}
                              {lineWdlText ? <span className="pv-line-wdl" title={lineWdlText} data-testid={`engine-pv-wdl-${i}`}> · {lineWdlText}</span> : null}
                            </span>
                            <span className="move">
                              {/* One control per move: click the third to play the
                                  line up to it, which is what a strong player does
                                  with an engine line and could not do here. */}
                              <MoveLineStrip
                                tokens={pvTokens.tokens}
                                remaining={pvTokens.remaining}
                                disabled={Boolean(gameResult)}
                                onPlay={(count) => handlePlayPvLine(pv.moves, count)}
                                title={(_, token) => `Play this line up to ${token}`}
                                ariaLabel={(moveIndex, token) => `Play engine line ${i + 1} up to move ${moveIndex + 1}, ${token}`}
                                testId={(moveIndex) => `engine-pv-${i}-move-${moveIndex}`}
                                emptyText="No moves yet"
                              />
                            </span>
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
                            <button
                              type="button"
                              className="pv-action-btn"
                              onClick={() => handleKeepPvLine(pv.moves)}
                              disabled={!isReady || lineKept || !pv.moves.length || Boolean(gameResult) || isAiTurn || reviewStatus === 'running'}
                              title={lineKept ? 'This line and analysis are saved' : 'Keep the complete line and save this analysis snapshot without moving the board'}
                              aria-label={lineKept ? `Kept line ${i + 1} in the move tree` : lineExists ? `Update analysis for engine line ${i + 1}` : `Keep line ${i + 1} in the move tree`}
                              data-testid={`keep-engine-pv-${i}`}
                            >
                              {lineKept ? <IconCheck /> : <IconSave />}
                              <span>{lineKept ? 'Kept' : lineExists ? 'Update analysis' : 'Keep line'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                  {/* Diagnostics last: at 1280x720 the four cards stood between the
                      controls and the lines and left room for one line of three. The
                      lines are what the panel is for; the core, tier and node rate are
                      what you look at when something is wrong. */}
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
                    <EngineSearchTelemetry store={telemetry} ready={isReady} queued={isSearchQueued} searching={isSearching} stalled={analysisIsStalled}
                      detail={engineRecoveryNotice ? `${engineRecoveryNotice.text}. ${engineRecoveryHint}` : analysisIsStalled ? describeAnalysisActivity(analysisActivity) : undefined}
                      label={engineRecoveryNotice?.text ?? (analysisIsStalled ? formatAnalysisActivity(analysisActivity) : undefined)}
                      secondary={engineRecoveryNotice ? engineRecoveryHint : candidateActive ? candidateSearch!.budgetLabel : analysisIsStalled ? 'tab in background' : undefined}
                    />
                    <div className="engine-stat">
                      <span>Detail</span>
                      <strong>{`MultiPV ${candidateActive ? candidateSearch!.moves.length : analysisMultiPv}`}</strong>
                      <em>{candidateActive ? 'Selected moves · WDL off' : analysisWdlEnabled ? 'WDL on' : 'WDL off'}</em>
                    </div>
                  </div>
                  {assistMode === 'pro' ? (
                    <EngineOutput store={telemetry} />
                  ) : candidateActive ? null : (
                    <div className="engine-coach-summary">
                      <div className="engine-coach-item">
                        <span>Best</span>
                        <strong>{coachBestMoveText}</strong>
                      </div>
                      <div className="engine-coach-item">
                        <span>Depth</span>
                        <strong>{!isReady ? '—' : topAnalysisPv?.depth ? `D${topAnalysisPv.depth}` : isSearchQueued ? 'Queued' : isSearching ? 'Pending' : `D${liveAnalysisPolicy.primary.depth}`}</strong>
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
        {/* Notices take their own row above the bottom chrome. A persistent
            recovery warning must leave board navigation and panels usable. */}
        <div className="app-notice-stack">
          {discardedAutoSave ? (
            <div {...discardedAutoSaveTimeout.bindings} className={`undo-toast ${discardedAutoSave.failed ? 'undo-toast-failed' : ''}`} role="status" data-testid="discard-undo-toast">
              <span>
                {discardedAutoSave.failed
                  ? 'Could not put the game back on the board. Download its data for repair.'
                  : `Discarded the unfinished game${discardedAutoSave.snapshot.game.moves.length === 1
                    ? ' (1 move)' : ` (${discardedAutoSave.snapshot.game.moves.length} moves)`}`}
              </span>
              {discardedAutoSave.failed ? (
                <button type="button" className="undo-toast-btn" data-testid="discard-undo-download"
                  aria-label={discardedAutoSave.downloadFailed ? 'Download failed — retry for unfinished game' : 'Download data for unfinished game'}
                  onClick={() => {
                    const snapshot = discardedAutoSave.snapshot;
                    const ok = downloadRecoveryGame(snapshot.game, 'xiangqi-unfinished-game.json');
                    setDiscardedAutoSave(current => current?.snapshot === snapshot ? { ...current, downloadFailed: !ok } : current);
                  }}>{discardedAutoSave.downloadFailed ? 'Download failed — retry' : 'Download data'}</button>
              ) : (
                <button type="button" className="undo-toast-btn" onClick={undoDiscardedAutoSave} data-testid="discard-undo-btn">Undo</button>
              )}
              <button type="button" className="undo-toast-dismiss" onClick={dismissDiscardedAutoSave} aria-label="Dismiss">
                <IconX />
              </button>
            </div>
          ) : null}
          {libraryUndo ? (
            <div {...libraryUndoTimeout.bindings} className={`undo-toast ${libraryUndo.failed ? 'undo-toast-failed' : ''}`} role="status" data-testid="library-undo-toast">
              <span>
                {libraryUndo.pending ? 'Restoring the saved game…' : libraryUndo.failed
                  ? 'Could not put it back. Browser storage may be full, blocked, or busy. Retry when it is available, or download its data.'
                  : libraryUndo.game.label
                    ? `Deleted “${libraryUndo.game.label}”`
                    : 'Deleted that saved game'}
              </span>
              <button type="button" className="undo-toast-btn" ref={libraryUndoButtonRef} onClick={handleUndoLibraryDelete}
                disabled={libraryUndo.pending} data-testid={libraryUndo.failed ? 'library-retry-undo-btn' : 'library-undo-btn'}>
                {libraryUndo.pending ? 'Restoring…' : libraryUndo.failed ? 'Retry restore' : 'Undo'}
              </button>
              {libraryUndo.failed && <button type="button" className="undo-toast-btn" data-testid="library-undo-download"
                aria-label={libraryUndo.downloadFailed ? 'Download failed — retry for deleted game' : 'Download data for deleted game'}
                onClick={() => {
                  const game = libraryUndo.game;
                  const ok = downloadRecoveryGame(game, 'xiangqi-deleted-game.json');
                  setLibraryUndo(current => current?.game === game ? { ...current, downloadFailed: !ok } : current);
                }}>{libraryUndo.downloadFailed ? 'Download failed — retry' : 'Download data'}</button>}
              <button type="button" className="undo-toast-dismiss" onClick={dismissLibraryUndo} aria-label="Dismiss">
                <IconX />
              </button>
            </div>
          ) : null}
          {deleteUndo ? (
            <div {...deleteUndoTimeout.bindings} className="undo-toast" role="status" data-testid="delete-undo-toast">
              <span>Removed {deleteUndo.removed === 1 ? '1 move' : `${deleteUndo.removed} moves`}</span>
              <button type="button" className="undo-toast-btn" onClick={handleUndoDelete} data-testid="delete-undo-btn">Undo</button>
              <button type="button" className="undo-toast-dismiss" onClick={dismissDeleteUndo} aria-label="Dismiss">
                <IconX />
              </button>
            </div>
          ) : null}

          {moveCapacityError && (
            <div className="save-error-notice" role="alert" data-testid="study-capacity-error">
              <span>{moveCapacityError}</span>
              <button type="button" className="undo-toast-dismiss" onClick={dismissMoveCapacityError} aria-label="Dismiss study limit"><IconX /></button>
            </div>
          )}

          {saveFailedToast && librarySaveError ? (
            <div className="save-error-notice" role="alert" data-testid="save-game-error">
              <span>{librarySaveError}</span>
              <button type="button" className="undo-toast-btn" onClick={() => { setSaveFailedToast(false); openLibraryPanel(); }}>Open library</button>
              <button type="button" className="undo-toast-dismiss" onClick={() => setSaveFailedToast(false)} aria-label="Dismiss save error"><IconX /></button>
            </div>
          ) : null}

          {recoveryProblems.length > 0 && !autoSaveRecovery && (
            <div className="save-error-notice" role="alert" data-testid="recovery-data-error">
              <span>{recoveryProblems.length} unreadable recovery {recoveryProblems.length === 1 ? 'copy is' : 'copies are'} preserved. Download the original data for repair.</span>
              <button type="button" className="undo-toast-btn" onClick={() => {
                const ok = downloadTextFile('xiangqi-recovery-data.json', JSON.stringify(recoveryProblems, null, 2), 'application/json');
                setRecoveryDownloadFailed(!ok);
              }}>{recoveryDownloadFailed ? 'Download failed — retry' : 'Download recovery data'}</button>
              <button type="button" className="undo-toast-dismiss" onClick={() => setRecoveryProblems([])} aria-label="Dismiss recovery data notice"><IconX /></button>
            </div>
          )}

          {autoSaveIssue && !(saveFailedToast && librarySaveError) ? (
            <div className="save-error-notice" role="alert" data-testid="auto-save-error">
              <span>{autoSaveIssue === 'too-large'
                ? 'This study is too large for automatic recovery. Your last successful snapshot is kept. Download a PGN for your latest changes.'
                : 'Automatic recovery could not save your latest changes. Your last successful snapshot is kept. Download a PGN before leaving.'}</span>
              <button type="button" className="undo-toast-btn" onClick={handleDownloadPgn}>
                {exportFailureKey === 'download-pgn' ? 'Download failed — try again' : 'Download PGN'}
              </button>
              <button type="button" className="undo-toast-btn" onClick={() => persistAutoSave(snapshotForStorage(currentGameSnapshot))}>Retry autosave</button>
            </div>
          ) : null}
        </div>
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
                title={saveFailedToast
                  ? 'Could not save to local storage'
                  : savingWouldDropTheReview
                    ? 'Save current game or custom position to library. The review covers a different line, so the moves are saved without it.'
                    : 'Save current game or custom position to library'}
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
                aria-label={exportFailureKey === 'copy-share' ? 'Share link copy failed' : copiedShareToast ? 'Share link copied' : 'Copy link to this position'}
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
                  aria-label={`Play from here against the engine as ${sideToMove === 'w' ? 'Red' : 'Black'}`}
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
              {aiPlayActive && (
                <button
                  type="button"
                  className="gc-btn"
                  onClick={handleTakeBack}
                  disabled={!canTakeBack}
                  title={canTakeBack
                    ? (takeBackPlies === 1 ? 'Take back your last move before the engine answers it' : 'Take back your last move and the engine\'s reply')
                    : 'Nothing to take back'}
                  data-testid="take-back-btn"
                >
                  <IconSkipBack aria-hidden="true" focusable="false" /> Take back
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
                // The bar is the glance and the panel is the detail: there is no
                // room here for a count beside a cancel button on a phone. The
                // title carries it for anyone who asks.
                <span
                  className="review-progress"
                  title={formatReviewProgressDetail(reviewCompletedSteps, reviewTotalSteps) ?? undefined}
                >
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
                    aria-label="View completed game review"
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
                  {/* Wrapped rather than left as a bare text node: as a bare
                      node it is an anonymous flex item, which cannot be given
                      a flex-shrink of its own, and it gave way alongside the
                      English name instead of holding its ground. */}
                  <span className="opening-badge-chinese">{detectedOpening.chinese}</span>
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
              shortcutsEnabled={!aDialogIsOpen}
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
                {hintText ?? (workspaceMode === 'analysis' ? 'Engine not started' : 'Play mode')}
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
          {studySaveControl}
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
          onNewGame={() => { resetGame(); }}
          onReview={dismissGameOverForReview}
        />
      )}

      {showBoardEditor && (
        <BoardEditor
          initialBoard={editorSeed?.board ?? board}
          initialSide={editorSeed?.sideToMove ?? sideToMove}
          pieceStyle={pieceStyle}
          onCancel={() => { setShowBoardEditor(false); setEditorSeed(null); }}
          onApply={handleApplyEditedPosition}
        />
      )}

      {showRuleLessons && <RuleLessons pieceStyle={pieceStyle} onClose={() => setShowRuleLessons(false)} />}

      {practiceStudy && <StudyPracticeDialog game={practiceStudy} pieceStyle={pieceStyle} notationStyle={notationStyle} onClose={() => setPracticeStudy(null)} />}

      {autoSaveRecovery && (
        <AutoSaveRecoveryModal
          error={recoveryError}
          onDownload={() => {
            const raw = readAutoSaveDraftRaw(autoSaveRecovery.draftId) ?? JSON.stringify(autoSaveRecovery);
            if (!downloadTextFile('xiangqi-recovery.json', raw, 'application/json')) setRecoveryError('Download failed. Your recovery data is still kept; try again.');
          }}
          drafts={recoveryDrafts}
          draftId={autoSaveRecovery.draftId}
          onSelectDraft={id => { setRecoveryError(null); setAutoSaveRecovery(recoveryDrafts.find(draft => draft.draftId === id) ?? null); }}
          savedAt={autoSaveRecovery.savedAt}
          moveCount={autoSaveRecovery.game.moves.length}
          /* The link's `moves` are only the path to where it opens; a shared
             tree carries the rest of the line, so "the 1-move game this link
             opened" was said of a two-move game opened at its first move. By
             now the link's game is on the board: count its line instead. */
          incomingLink={incomingLink && { moveCount: Math.max(incomingLink.moveCount, moveHistory.length) }}
          onRestore={restoreAutoSavedGame}
          onDismiss={dismissAutoSaveRecovery}
          onLater={() => { setAutoSaveRecovery(null); requestAnimationFrame(focusBoard); }}
        />
      )}
    </main>
  );
}

export default App;
