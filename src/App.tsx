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
  IconPawn, IconCheck
} from './components/icons';
import { useEngine, type WdlStats } from './hooks/useEngine';
import { useXiangqi } from './hooks/useXiangqi';
import { uciToSquare, type Side } from './utils/xiangqi';
import { WdlBar } from './components/Panels/WdlBar';
import { playMoveSound, playCaptureSound, playCheckSound } from './utils/sounds';
import { matchOpening } from './utils/openings';
import { useGameLibrary } from './hooks/useGameLibrary';
import type { SavedGame } from './utils/gameLibrary';
import { LibraryPanel } from './components/Library/LibraryPanel';
import type { HistoricalGame } from './utils/historicalGames';
import { useGameReview } from './hooks/useGameReview';
import { GameOverModal } from './components/GameOverModal';
import { exportPgn, copyToClipboard } from './utils/gameExport';
import {
  detectDeviceTier,
  resolveEngineBootConfig,
  resolveLiveAnalysisPolicy,
  resolveReviewPolicy,
} from './utils/analysisProfile';
import {
  computeReviewArtifacts,
  getEvalLossForMove,
  getReviewSideForRecord,
  makeReviewLineSignature,
  makeReviewLineSignatureFromMoves,
  remapReviewSummaryToLine,
} from './utils/review';

export type GameMode = 'PvP' | 'PvAI-Black' | 'PvAI-Red' | 'AIvAI';
type WorkspaceMode = 'play' | 'analysis';
type AnalysisEngineMode = 'stable' | 'optimized';

const GAME_MODES: Array<{ mode: GameMode; label: string; icon?: string }> = [
  { mode: 'PvP', label: 'Local' },
  { mode: 'PvAI-Black', label: 'vs AI (Red)' },
  { mode: 'PvAI-Red', label: 'vs AI (Black)' },
  { mode: 'AIvAI', label: 'AI vs AI' },
];

export type AiStrength = 1 | 2 | 3 | 4 | 5;
const WORKER_SAFE_MAX_DEPTH = 12;
const AI_SPEED_MS: Record<Exclude<AiSpeed, 'step'>, number> = {
  slow: 1500,
  normal: 800,
  fast: 150,
};
const AI_STRENGTH_LABELS: Record<AiStrength, string> = {
  1: 'Beginner',
  2: 'Easy',
  3: 'Medium',
  4: 'Hard',
  5: 'Master',
};
const AI_DEPTH_LIMIT: Record<AiStrength, number> = {
  1: 2,
  2: 4,
  3: 6,
  4: 9,
  5: WORKER_SAFE_MAX_DEPTH,
};
const ANALYSIS_TAG_PREFIX = 'analysis';
const AI_TAG_PREFIX = 'ai';
const REVIEW_TAG_PREFIX = 'review';

type ReviewPhase = 'base' | 'revisit';

type ReviewController = {
  active: boolean;
  phase: ReviewPhase;
  baseQueue: string[];
  revisitQueue: string[];
  provisionalEvals: Map<string, number>;
  criticalNodeSwings: Map<string, number>;
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
    criticalNodeSwings: new Map(),
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
  return `${record.ply}. ${record.uci}`;
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

function App() {
  const [gameMode, setGameMode] = useState<GameMode>('PvP');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('analysis');
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(320);
  const [topPanelOpen, setTopPanelOpen] = useState(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [analysisTab, setAnalysisTab] = useState<'tree' | 'review' | 'engine'>('tree');
  const [mobileView, setMobileView] = useState<'board' | 'analysis'>('board');
  const [mobileAnalysisTab, setMobileAnalysisTab] = useState<'moves' | 'graph'>('moves');
  const [showArrows, setShowArrows] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewGameMenu, setShowNewGameMenu] = useState(false);
  const [pendingGameMode, setPendingGameMode] = useState<GameMode>('PvP');
  const [aiStrength, setAiStrength] = useState<AiStrength>(5);
  const [leftPanelTab, setLeftPanelTab] = useState<'graph' | 'library'>('graph');
  const [graphLoadSweepToken, setGraphLoadSweepToken] = useState(0);
  const [orientation, setOrientation] = useState<BoardOrientation>('red');
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));

  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(true);
  const handleSoundToggle = useCallback((enabled: boolean) => {
    soundEnabledRef.current = enabled;
    setSoundEnabled(enabled);
  }, []);

  const [searchDepth, setSearchDepth] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth <= 900 ? 6 : 8
  );
  const [analysisEngineMode, setAnalysisEngineMode] = useState<AnalysisEngineMode>('optimized');
  const [engineRestartToken, setEngineRestartToken] = useState(0);
  const [engineSafetyBootLevel, setEngineSafetyBootLevel] = useState(0);
  const [aiSpeed, setAiSpeed] = useState<AiSpeed>('normal');
  const aiSpeedRef = useRef<AiSpeed>('normal');
  const handleSpeedChange = useCallback((s: AiSpeed) => {
    setAiSpeed(s);
    aiSpeedRef.current = s;
  }, []);

  // AI pause/resume state
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const stepPendingRef = useRef(false);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    stepPendingRef.current = false;
  }, []);

  const step = useCallback(() => {
    // In step mode: allow exactly one AI move then re-pause
    stepPendingRef.current = true;
    pausedRef.current = false;
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
    inCheck,
    gameResult,
    setGameResult,
    onSquareClick,
    resetBoard,
    loadMoves,
    loadFen,
    sideToMove,
    applyUciMove,
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
  const currentPositionCommand = useMemo(() => {
    return `position fen ${currentFen}`;
  }, [currentFen]);
  const isAiTurn =
    gameMode === 'AIvAI' ||
    (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
    (gameMode === 'PvAI-Red' && sideToMove === 'w');
  const engineEnabled = workspaceMode === 'analysis';

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

  const applyBestMoveRef = useRef(false);
  const analysisStageRef = useRef<'idle' | 'primary-pending' | 'primary-complete' | 'deepen-pending' | 'settled'>('idle');
  const analysisDeepenTimerRef = useRef<number | null>(null);
  const activeAnalysisRequestRef = useRef('');
  const currentAnalysisRequestKeyRef = useRef('');
  const currentMultiPvRef = useRef(1);
  const currentShowWdlRef = useRef(false);
  const reviewControllerRef = useRef<ReviewController>(createReviewController());
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
  const liveAnalysisPolicy = useMemo(() => resolveLiveAnalysisPolicy({
    tier: engineBootConfig.tier,
    mode: analysisEngineMode,
    searchDepth: safeSearchDepth,
    detailEnabled: engineDetailEnabled,
  }), [analysisEngineMode, engineBootConfig.tier, engineDetailEnabled, safeSearchDepth]);

  const reviewPolicy = useMemo(() => resolveReviewPolicy(deviceProfile), [deviceProfile]);
  const analysisRequestKey = useMemo(
    () => `${currentPositionCommand}::mode:${analysisEngineMode}::policy:${liveAnalysisPolicy.signature}::detail:${engineDetailEnabled ? 'detail' : 'compact'}`,
    [analysisEngineMode, currentPositionCommand, engineDetailEnabled, liveAnalysisPolicy.signature]
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
    );
    flushReviewEvalUpdates();
    setNodeReviewDataBulk(annotations);
    resetReviewController(false);
    completeReview(summary);
    setAnalysisTab('review');
  }, [activeLineNodeIds, completeReview, flushReviewEvalUpdates, resetReviewController, setNodeReviewDataBulk, treeNodes]);

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
      console.error('Pikafish worker crashed repeatedly; automatic restart suppressed.', message);
      return;
    }

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
    evalScore,
    wdl,
  } = useEngine({
    restartToken: engineRestartToken,
    variant: engineBootConfig.variant,
    allowSIMD: engineBootConfig.allowSIMD,
    threads: engineBootConfig.threads,
    hashMB: engineBootConfig.hashMB,
    onWorkerError: handleEngineWorkerError,
    onBestMove: (uci, score, searchTag) => {
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
          const parentId = treeNodes[reviewTag.nodeId]?.parentId ?? null;
          const parentEval = parentId ? getEffectiveNodeEval(parentId) : undefined;
          if (typeof parentEval === 'number') {
            const swing = Math.abs(normalizedScore - parentEval);
            if (swing >= reviewPolicy.revisitThreshold) {
              const previousSwing = controller.criticalNodeSwings.get(reviewTag.nodeId) ?? 0;
              if (swing > previousSwing) {
                controller.criticalNodeSwings.set(reviewTag.nodeId, swing);
              }
            }
          }
        }

        controller.completed += 1;
        updateReviewProgress(controller.completed, controller.total);
        return;
      }

      if (searchTag?.startsWith(`${AI_TAG_PREFIX}|`)) {
        applyBestMoveRef.current = false;
        if (uci) {
          applyUciMove(uci, normalizeEvalForSide(score, sideToMove));
        }
        if (aiSpeedRef.current === 'step' || stepPendingRef.current) {
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

  const reviewRevisitGoCmd = reviewPolicy.revisit?.goCmd ?? null;
  const canGoBack = currentMoveIndex >= 0;
  const canGoForward = currentMoveIndex < moveHistory.length - 1;
  const viewedPly = Math.max(0, currentMoveIndex + 1);
  const currentLineSignature = useMemo(
    () => makeReviewLineSignature(activeLineNodeIds, treeNodes),
    [activeLineNodeIds, treeNodes]
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
    if (reviewStatus !== 'done' || !reviewSummary) return;
    if (reviewSummary.lineSignature === currentLineSignature) return;
    clearCompletedReview();
  }, [clearCompletedReview, currentLineSignature, reviewStatus, reviewSummary]);

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
        setFenError(false);
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
      if (document.hidden) {
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
    if (!engineEnabled || !isReady) return;

    const targetMultiPv = engineDetailEnabled ? 3 : 1;
    const showWdl = engineDetailEnabled;

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
  }, [clearPvLines, clearWdl, engineDetailEnabled, engineEnabled, isReady, setOption, trimPvLines]);

  // Analysis engine effect
  useEffect(() => {
    if (!engineEnabled || !isReady || isAiTurn || reviewControllerRef.current.active || document.hidden) {
      activeAnalysisRequestRef.current = '';
      analysisStageRef.current = 'idle';
      clearAnalysisDeepenTimer();
      clearQueuedSearch();
      if (isSearching && !applyBestMoveRef.current) {
        stopSearch();
      }
      return;
    }

    if (activeAnalysisRequestRef.current !== analysisRequestKey) {
      activeAnalysisRequestRef.current = analysisRequestKey;
      analysisStageRef.current = 'idle';
      clearAnalysisDeepenTimer();
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
    currentPositionCommand,
    engineEnabled,
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
      document.hidden ||
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
    isAiTurn,
    isReady,
    liveAnalysisPolicy.deepen,
    queueSearch,
  ]);

  // AI move effect
  useEffect(() => {
    if (!isReady) return;

    if (!isAiTurn) {
      applyBestMoveRef.current = false;
      return undefined;
    }

    if (isSearching) {
      return undefined;
    }

    // If paused, don't start the search (unless stepPending)
    if (pausedRef.current && !stepPendingRef.current) {
      return undefined;
    }

    const delayMs = aiSpeedRef.current === 'step'
      ? 0
      : (AI_SPEED_MS[aiSpeedRef.current as Exclude<AiSpeed, 'step'>] ?? 800);
    const aiSearchDepth = Math.max(1, Math.min(safeSearchDepth, AI_DEPTH_LIMIT[aiStrength]));

    const timer = setTimeout(() => {
      // Check again in case pause was set during the delay
      if (pausedRef.current && !stepPendingRef.current) {
        return;
      }
      applyBestMoveRef.current = true;
      queueSearch(
        currentPositionCommand,
        `go depth ${aiSearchDepth}`,
        0,
        `${AI_TAG_PREFIX}|${currentPositionCommand}|${aiSearchDepth}`,
      );
    }, delayMs);

    return () => clearTimeout(timer);
  }, [aiStrength, currentPositionCommand, isAiTurn, isReady, isSearching, queueSearch, safeSearchDepth]);

  // Review engine drive: when review is running and engine is idle, fire next search
  useEffect(() => {
    const controller = reviewControllerRef.current;
    if (!controller.active) return;
    if (isSearching) return;
    if (!isReady) return;
    if (controller.currentNodeId) return;

    if (controller.phase === 'base' && controller.baseQueue.length === 0) {
      if (reviewPolicy.revisit && controller.revisitQueue.length === 0) {
        controller.revisitQueue = Array.from(controller.criticalNodeSwings.entries())
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
  }, [finalizeReview, getNodeFen, isReady, isSearching, queueSearch, reviewPolicy.base.goCmd, reviewPolicy.revisit, reviewPolicy.revisitLimit, reviewRevisitGoCmd, reviewStatus, updateReviewProgress]);

  const startGameReview = useCallback(() => {
    if (applyBestMoveRef.current) return;
    if (!engineEnabled || !isReady) return;
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

    const totalSteps = activeLineNodeIds.length + 1;
    if (!startReview(totalSteps)) {
      const { summary } = computeReviewArtifacts(activeLineNodeIds, treeNodes);
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
  }, [activeLineNodeIds, applyBestMoveRef, clearAllReviewData, clearPvLines, clearWdl, completeReview, engineEnabled, isReady, resetReviewController, rootNodeId, setOption, startReview, stopAnalysis, treeNodes]);

  const handleSquareClick = useCallback((file: number, rank: number) => {
    if (gameResult) return;
    if (!isAiTurn || paused) {
      onSquareClick(file, rank);
    }
  }, [gameResult, isAiTurn, paused, onSquareClick]);

  const applyMode = useCallback((mode: GameMode) => {
    setGameMode(mode);
    resetGame();
  }, [resetGame]);

  const MIN_WIDTH = 60;
  const DEFAULT_LEFT = 320;
  const DEFAULT_RIGHT = 320;

  const startLeftResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    document.body.classList.add('resizing');
    const startX = event.clientX;
    const startW = leftWidth;
    let last = startW;
    const onMove = (e: MouseEvent) => {
      const next = startW + e.clientX - startX;
      last = next < MIN_WIDTH ? 0 : Math.min(next, 600);
      document.documentElement.style.setProperty('--left-panel-w', last + 'px');
    };
    const onUp = () => {
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setLeftWidth(last);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [leftWidth]);

  const startRightResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    document.body.classList.add('resizing');
    const startX = event.clientX;
    const startW = rightWidth;
    let last = startW;
    const onMove = (e: MouseEvent) => {
      const next = startW - (e.clientX - startX);
      last = next < MIN_WIDTH ? 0 : Math.min(next, 600);
      document.documentElement.style.setProperty('--right-panel-w', last + 'px');
    };
    const onUp = () => {
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setRightWidth(last);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [rightWidth]);

  const isAiMode = gameMode !== 'PvP';
  const currentModeLabel = GAME_MODES.find((candidate) => candidate.mode === gameMode)?.label ?? gameMode;
  const pendingModeLabel = GAME_MODES.find((candidate) => candidate.mode === pendingGameMode)?.label ?? pendingGameMode;
  const pendingModeIsAi = pendingGameMode !== 'PvP';
  const displayEvalScore = useMemo(
    () => normalizeEvalForSide(evalScore, sideToMove),
    [evalScore, sideToMove]
  );
  const displayWdl = useMemo(
    () => normalizeWdlForSide(wdl, sideToMove),
    [sideToMove, wdl]
  );
  const currentEvalText = typeof displayEvalScore === 'number'
    ? formatEvalScore(displayEvalScore)
    : null;

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
    if (delta <= 40)  return '#22c55e'; // best   — bright green
    if (delta <= 90)  return '#4ade80'; // good   — light green
    if (delta <= 180) return '#facc15'; // inaccuracy — yellow
    if (delta <= 320) return '#f97316'; // mistake   — orange
    return '#ef4444';                   // blunder   — red
  }, [currentNodeId, treeNodes]);

  // Opening recognition
  const detectedOpening = useMemo(() => {
    const uciMoves = moveHistory.slice(0, currentMoveIndex + 1).map(r => r.uci);
    return matchOpening(uciMoves);
  }, [moveHistory, currentMoveIndex]);

  // Game library
  const { games: savedGames, save: saveGameToLibrary, remove: deleteGameFromLibrary, rename: renameGameInLibrary } = useGameLibrary();

  const [copiedToast, setCopiedToast] = useState(false);
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState(false);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const toggleSettings = useCallback(() => {
    setShowNewGameMenu(false);
    setFenError(false);
    setShowSettings((open) => !open);
  }, []);

  const closeNewGameMenu = useCallback(() => {
    setShowNewGameMenu(false);
    setFenError(false);
  }, []);

  const openNewGameMenu = useCallback(() => {
    setShowSettings(false);
    setPendingGameMode(gameMode);
    setFenInput('');
    setFenError(false);
    setShowNewGameMenu(true);
  }, [gameMode]);

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

  const handleCopyPgn = useCallback(async () => {
    const moves = activeLineNodeIds
      .slice(0, currentMoveIndex + 1)
      .map(id => treeNodes[id]?.record)
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (moves.length === 0) return;
    const pgn = exportPgn(moves, {
      gameMode,
      opening: detectedOpening?.name,
      result: gameResult,
    });
    const ok = await copyToClipboard(pgn);
    if (ok) {
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    }
  }, [activeLineNodeIds, currentMoveIndex, treeNodes, gameMode, detectedOpening, gameResult]);

  const handleLoadFen = useCallback((fen: string, nextGameMode: GameMode = gameMode) => {
    const ok = loadFen(fen.trim());
    if (!ok) {
      setFenError(true);
      setTimeout(() => setFenError(false), 2000);
      return;
    }
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setGameMode(nextGameMode);
    setFenInput('');
    setFenError(false);
    closeNewGameMenu();
  }, [closeNewGameMenu, gameMode, handleCancelReview, loadFen, resetReview, stopAnalysis]);

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
    saveGameToLibrary(gameMode, moves, {
      opening: detectedOpening?.name,
      finalEval: displayEvalScore,
      result: gameResult === 'red-wins' ? 'red' : gameResult === 'black-wins' ? 'black' : gameResult === 'draw' ? 'draw' : 'ongoing',
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
  }, [activeLineNodeIds, currentMoveIndex, detectedOpening, displayEvalScore, gameMode, gameResult, reviewStatus, reviewSummary, saveGameToLibrary, savedReviewSnapshot, treeNodes]);

  const handleLoadGame = useCallback((game: SavedGame) => {
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setLeftPanelTab('graph');
    const loadedNodeIds = loadMoves(game.moves);
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
    }
    setGraphLoadSweepToken((token) => token + 1);
  }, [handleCancelReview, hydrateReview, loadMoves, resetReview, setNodeReviewDataBulk, stopAnalysis]);

  const handleLoadHistoricalGame = useCallback((game: HistoricalGame) => {
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setLeftPanelTab('graph');
    loadMoves(game.moves);
    setGraphLoadSweepToken((token) => token + 1);
  }, [handleCancelReview, loadMoves, resetReview, stopAnalysis]);

  // Board arrows: quality-colored last move + engine recommendation lines
  const boardArrows = useMemo(() => {
    const result: Array<{ from: { file: number; rank: number }; to: { file: number; rank: number }; color: string; opacity?: number; strokeWidth?: number }> = [];

    // Last played move — color encodes quality (green=good … red=blunder)
    if (lastMoveFrom && lastMoveTo) {
      result.push({ from: lastMoveFrom, to: lastMoveTo, color: lastMoveArrowColor, opacity: 0.82, strokeWidth: 5 });
    }

    // Engine best move (green)
    if (engineEnabled && pvLines[0]?.moves[0]) {
      const uci = pvLines[0].moves[0];
      const from = uciToSquare(uci.substring(0, 2));
      const to = uciToSquare(uci.substring(2, 4));
      if (from && to) result.push({ from, to, color: '#10b981', opacity: 0.88, strokeWidth: 6 });
    }

    // Alternative engine lines (muted green)
    for (let idx = 1; idx <= 2; idx++) {
      const uci = pvLines[idx]?.moves[0];
      if (!uci) continue;
      const from = uciToSquare(uci.substring(0, 2));
      const to = uciToSquare(uci.substring(2, 4));
      if (from && to) result.push({ from, to, color: '#6ee7b7', opacity: 0.55, strokeWidth: 3.5 });
    }

    if (!showArrows) return [];
    return result;
  }, [lastMoveFrom, lastMoveTo, lastMoveArrowColor, engineEnabled, pvLines, showArrows]);

  return (
    <main className="app-shell" data-mobile-view={isMobile ? mobileView : undefined}>
      {/* ── Top bar ── */}
      <section className={`panel top ${topPanelOpen ? '' : 'hidden'}`}>
        <div className="panel-inner">
          <div className="panel-content compact-grid">
            <div className="app-brand">
              <IconPawn className="app-brand-icon" />
              <span className="app-brand-text">Web Xiangqi</span>
              <span className="brand-badge">Alpha</span>
            </div>

            <span className="toolbar-divider desktop-only" />

            {/* Workspace mode pills */}
            <div className="top-mode-pills" aria-label="Workspace mode">
              <button
                type="button"
                className={`gc-pill ${workspaceMode === 'play' ? 'gc-pill-active' : ''}`}
                onClick={() => setWorkspaceMode('play')}
              >
                Play
              </button>
              <button
                type="button"
                className={`gc-pill ${workspaceMode === 'analysis' ? 'gc-pill-active' : ''}`}
                onClick={() => setWorkspaceMode('analysis')}
              >
                Analysis
              </button>
            </div>

            {engineEnabled ? (
              <div className="top-engine-state">
                <span className={`status-dot ${isReady ? 'healthy' : ''}`} />
                {isReady ? `Pikafish ready (${engineVariant})` : 'Loading engine…'}
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
                title={showArrows ? 'Hide arrows' : 'Show arrows'}
                aria-label="Toggle board arrows"
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
              >
                <IconRefresh />
                <span className="btn-label-desktop">New</span>
              </button>
              <button
                type="button"
                className="top-action-btn"
                onClick={() => {
                  if (leftWidth === 0) setLeftWidth(DEFAULT_LEFT);
                  setLeftPanelTab('library');
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
              >
                <IconSettings />
                <span className="btn-label-desktop">Settings</span>
              </button>
            </div>

            {/* Mobile panel toggles */}
            <div className="mobile-actions">
              <button
                type="button"
                onClick={() => setLeftWidth(w => w > 0 ? 0 : DEFAULT_LEFT)}
                title="Toggle graph panel"
                aria-label="Toggle graph panel"
              >
                <IconBarChart />
              </button>
              <button
                type="button"
                onClick={() => setRightWidth(w => w > 0 ? 0 : DEFAULT_RIGHT)}
                title="Toggle tree panel"
                aria-label="Toggle move tree panel"
              >
                <IconTree />
              </button>
            </div>
          </div>
        </div>
        <div
          className="resize-handle resize-handle-bottom"
          onClick={() => setTopPanelOpen(o => !o)}
          title="Toggle top bar"
        >
          <span className="resize-pill horizontal" />
        </div>
      </section>

      {/* ── Settings modal ── */}
      {showSettings && (
        <>
          <div
            className="settings-backdrop"
            onClick={closeSettings}
            aria-hidden="true"
          />
          <div className="settings-body" role="dialog" aria-modal="true" aria-label="Settings">
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
              <label>Workspace</label>
              <select
                className="premium-select"
                value={workspaceMode}
                onChange={(e) => setWorkspaceMode(e.target.value as WorkspaceMode)}
              >
                <option value="analysis">Analysis</option>
                <option value="play">Play</option>
              </select>
            </div>

            <div className="settings-group">
              <label>Game Mode</label>
              <select
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
              <label>Board Orientation</label>
              <div className="settings-inline-toggles">
                <button
                  type="button"
                  className={`pill-btn ${orientation === 'red' ? 'pill-btn-active' : ''}`}
                  onClick={() => setOrientation('red')}
                >
                  Red at bottom
                </button>
                <button
                  type="button"
                  className={`pill-btn ${orientation === 'black' ? 'pill-btn-active' : ''}`}
                  onClick={() => setOrientation('black')}
                >
                  Black at bottom
                </button>
              </div>
            </div>

            <div className="settings-group">
              <label>Layout</label>
              <div className="settings-inline-toggles">
                <button
                  type="button"
                  className={`pill-btn ${leftPanelOpen ? 'pill-btn-active' : ''}`}
                  onClick={() => setLeftWidth(w => w > 0 ? 0 : DEFAULT_LEFT)}
                >
                  Graph Panel
                </button>
                <button
                  type="button"
                  className={`pill-btn ${rightPanelOpen ? 'pill-btn-active' : ''}`}
                  onClick={() => setRightWidth(w => w > 0 ? 0 : DEFAULT_RIGHT)}
                >
                  Tree Panel
                </button>
              </div>
            </div>

            <div className="settings-group">
              <label>Analysis Engine</label>
              <div className="settings-inline-toggles">
                <button
                  type="button"
                  className={`pill-btn ${analysisEngineMode === 'stable' ? 'pill-btn-active' : ''}`}
                  onClick={() => setAnalysisEngineMode('stable')}
                >
                  Stable
                </button>
                <button
                  type="button"
                  className={`pill-btn ${analysisEngineMode === 'optimized' ? 'pill-btn-active' : ''}`}
                  onClick={() => setAnalysisEngineMode('optimized')}
                >
                  Optimized
                </button>
              </div>
            </div>

            <div className="settings-group">
              <label>
                Search Depth (AI / Live Analysis Cap) — {searchDepth}
                {searchDepth > safeSearchDepth ? ` (worker cap ${safeSearchDepth})` : ''}
              </label>
              <input
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
                <label>AI Speed</label>
                <div className="settings-inline-toggles">
                  {(['slow', 'normal', 'fast', 'step'] as AiSpeed[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`pill-btn ${aiSpeed === s ? 'pill-btn-active' : ''}`}
                      onClick={() => handleSpeedChange(s)}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="settings-group">
              <label>Sound Effects</label>
              <div className="settings-inline-toggles">
                <button
                  type="button"
                  className={`pill-btn ${soundEnabled ? 'pill-btn-active' : ''}`}
                  onClick={() => handleSoundToggle(true)}
                >
                  On
                </button>
                <button
                  type="button"
                  className={`pill-btn ${!soundEnabled ? 'pill-btn-active' : ''}`}
                  onClick={() => handleSoundToggle(false)}
                >
                  Off
                </button>
              </div>
            </div>

            <div className="settings-group">
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
          <div className="new-game-menu" role="dialog" aria-modal="true" aria-label="New game">
            <div className="new-game-menu-header">
              <div className="new-game-menu-copy">
                <h2>New Game</h2>
                <p>Choose a mode, set the AI before you start, or drop straight into a custom FEN.</p>
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
              {GAME_MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  className={`new-game-mode-btn ${pendingGameMode === mode ? 'new-game-mode-btn-active' : ''}`}
                  onClick={() => setPendingGameMode(mode)}
                  aria-pressed={pendingGameMode === mode}
                >
                  {label}
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
                      title={AI_STRENGTH_LABELS[lvl]}
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
                  onChange={(e) => setFenInput(e.target.value)}
                  placeholder="rnbakabnr/9/… w - - 0 1"
                  aria-label="FEN string"
                />
                <button
                  type="submit"
                  className="new-game-strength-btn new-game-strength-btn-active"
                  disabled={!fenInput.trim()}
                >
                  {fenError ? 'Invalid FEN' : 'Load'}
                </button>
              </form>
            </div>
            <div className="new-game-menu-footer">
              <div className="new-game-selection">
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
        <section className="panel left">
          <div
            className="resize-handle resize-handle-right"
            onMouseDown={startLeftResize}
            onClick={() => { if (leftWidth === 0) setLeftWidth(DEFAULT_LEFT); }}
            title="Drag to resize · click to expand"
          >
            <span className="resize-pill" />
          </div>
          <div className="panel-inner" style={{ opacity: (!isMobile && leftWidth === 0) ? 0 : 1 }}>
            <header className="panel-header panel-header-tabs">
              <div className="analysis-tab-strip">
                <button
                  type="button"
                  className={`analysis-tab-btn ${leftPanelTab === 'graph' ? 'active' : ''}`}
                  onClick={() => setLeftPanelTab('graph')}
                >
                  <IconBarChart style={{ marginRight: '0.3rem' }} />Graph
                </button>
                <button
                  type="button"
                  className={`analysis-tab-btn ${leftPanelTab === 'library' ? 'active' : ''}`}
                  onClick={() => setLeftPanelTab('library')}
                >
                  <IconLibrary style={{ marginRight: '0.3rem' }} />Library
                </button>
              </div>
            </header>
            <div className="panel-content">
              {leftPanelTab === 'graph' ? (
                <>
                  {engineEnabled && <WdlBar wdl={displayWdl} isSearching={isSearching} />}
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
                  <div className="graph-jump-controls">
                    <button type="button" className="chip-btn" onClick={() => jumpToMove(-1)} disabled={!canGoBack}>Start</button>
                    <button type="button" className="chip-btn" onClick={() => jumpToMove(currentMoveIndex - 1)} disabled={!canGoBack}>Prev</button>
                    <button type="button" className="chip-btn" onClick={() => jumpToMove(currentMoveIndex + 1)} disabled={!canGoForward}>Next</button>
                    <button type="button" className="chip-btn" onClick={() => jumpToMove(moveHistory.length - 1)} disabled={!canGoForward}>Live</button>
                  </div>
                  <p className="panel-copy small">
                    Active ply: <strong>{viewedPly}</strong> / {moveHistory.length} · focus the chart for keyboard navigation
                  </p>
                </>
              ) : (
                <LibraryPanel
                  savedGames={savedGames}
                  onLoadSavedGame={handleLoadGame}
                  onDeleteSavedGame={deleteGameFromLibrary}
                  onRenameSavedGame={renameGameInLibrary}
                  onLoadHistorical={handleLoadHistoricalGame}
                />
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
                    ? `${detectedOpening.name} is on the board. ${engineEnabled && currentEvalText ? `Live eval ${currentEvalText}.` : 'Keep exploring variations and review notes.'}`
                    : workspaceMode === 'analysis'
                      ? 'Engine lines, review, and move-tree navigation stay synced with the current position.'
                      : 'A clean over-the-board workspace for local play and sparring.'}
                </p>
              </div>
              <div className="board-stage-chips">
                <span className={`board-stage-chip board-stage-chip-turn ${sideToMove === 'w' ? 'turn-red' : 'turn-black'}`}>
                  <span className={`turn-dot turn-dot-${sideToMove === 'w' ? 'red' : 'black'}`} />
                  {sideToMove === 'w' ? 'Red' : 'Black'} to move
                </span>
                <span className="board-stage-chip">Ply {viewedPly} / {moveHistory.length}</span>
                {currentEvalText ? (
                  <span className={`board-stage-chip board-stage-chip-eval ${displayEvalScore > 0 ? 'eval-positive' : displayEvalScore < 0 ? 'eval-negative' : ''}`}>
                    Eval {currentEvalText}
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
                {isAiMode ? (
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
                  <span className={`mobile-eval-chip ${displayEvalScore > 0 ? 'eval-positive' : displayEvalScore < 0 ? 'eval-negative' : ''}`}>
                    {formatEvalScore(displayEvalScore)}
                  </span>
                )}
                {detectedOpening && (
                  <span className="mobile-opening-pill" title={detectedOpening.name}>
                    {detectedOpening.name}
                  </span>
                )}
              </div>
              <div className="mobile-board-actions">
                <button className="mobile-action-btn" type="button" onClick={toggleNewGameMenu} title="New game" aria-label="Open new game menu"><IconRefresh /></button>
                {isAiMode && (
                  <button className={`mobile-action-btn ${paused ? 'mobile-action-btn-warn' : ''}`} type="button" onClick={() => paused ? resume() : pause()} title={paused ? 'Resume AI' : 'Pause AI'} aria-label={paused ? 'Resume AI' : 'Pause AI'}>
                    {paused ? <IconPlay /> : <IconPause />}
                  </button>
                )}
                <button className={`mobile-action-btn ${showArrows ? 'mobile-action-btn-active' : ''}`} type="button" onClick={() => setShowArrows(v => !v)} title="Toggle arrows" aria-label="Toggle board arrows"><IconArrow /></button>
                <button className="mobile-action-btn" type="button" onClick={() => setOrientation(o => o === 'red' ? 'black' : 'red')} title="Flip board" aria-label="Flip board"><IconFlip /></button>
                <button className="mobile-action-btn" type="button" onClick={toggleSettings} title="Settings" aria-label="Open settings"><IconSettings /></button>
              </div>
            </div>
          )}
          <div className="mobile-board-center">
          <div className="board-wrap">
            {isAiMode && (
              <div className="board-ai-status">
                <IconBot />
                {paused ? (
                  <span className="ai-status-paused"><IconPause /> AI Paused</span>
                ) : isSearching && applyBestMoveRef.current ? (
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
              arrows={boardArrows}
            />
            {inCheck && (
              <div className="check-overlay">
                <span className="check-badge">CHECK</span>
              </div>
            )}
          </div>
          </div>
          {isMobile && (
            <div className="mobile-board-nav">
              <button className="mobile-nav-btn" type="button" onClick={() => jumpToMove(-1)} disabled={!canGoBack} aria-label="Go to first move">⏮</button>
              <button className="mobile-nav-btn" type="button" onClick={() => jumpToMove(currentMoveIndex - 1)} disabled={!canGoBack} aria-label="Go to previous move">‹</button>
              <span className="mobile-nav-label">
                {currentMoveIndex < 0 ? 'Start' : `${currentMoveIndex + 1} / ${moveHistory.length}`}
              </span>
              <button className="mobile-nav-btn" type="button" onClick={() => jumpToMove(currentMoveIndex + 1)} disabled={!canGoForward} aria-label="Go to next move">›</button>
              <button className="mobile-nav-btn" type="button" onClick={() => jumpToMove(moveHistory.length - 1)} disabled={!canGoForward} aria-label="Go to latest move">⏭</button>
            </div>
          )}
        </section>

        {/* ── Mobile analysis sub-tab strip (analysis view only) ── */}
        {isMobile && (
          <div className="mobile-analysis-tabs">
            <button
              className={`mobile-tab-btn ${mobileAnalysisTab === 'moves' ? 'active' : ''}`}
              onClick={() => setMobileAnalysisTab('moves')}
            >
              <IconTree /> Moves
            </button>
            <button
              className={`mobile-tab-btn ${mobileAnalysisTab === 'graph' ? 'active' : ''}`}
              onClick={() => setMobileAnalysisTab('graph')}
            >
              <IconBarChart /> Graph
            </button>
          </div>
        )}

        {/* ── Right panel: Move tree / Engine ── */}
        <aside className="panel right">
          <div
            className="resize-handle resize-handle-left"
            onMouseDown={startRightResize}
            onClick={() => { if (rightWidth === 0) setRightWidth(DEFAULT_RIGHT); }}
            title="Drag to resize · click to expand"
          >
            <span className="resize-pill" />
          </div>
          <div className="panel-inner" style={{ opacity: (!isMobile && rightWidth === 0) ? 0 : 1 }}>
            <header className="panel-header panel-header-tabs">
              <h2>Analysis</h2>
              <div className="analysis-tab-strip">
                <button
                  type="button"
                  className={`analysis-tab-btn ${analysisTab === 'tree' ? 'active' : ''}`}
                  onClick={() => setAnalysisTab('tree')}
                  data-testid="analysis-tab-tree"
                >
                  <IconTree style={{ marginRight: '0.3rem' }} />Game Tree
                </button>
                <button
                  type="button"
                  className={`analysis-tab-btn ${analysisTab === 'review' ? 'active' : ''}`}
                  onClick={() => setAnalysisTab('review')}
                  data-testid="analysis-tab-review"
                >
                  <IconBarChart style={{ marginRight: '0.3rem' }} />Review
                </button>
                {engineEnabled ? (
                  <button
                    type="button"
                    className={`analysis-tab-btn ${analysisTab === 'engine' ? 'active' : ''}`}
                    onClick={() => setAnalysisTab('engine')}
                    data-testid="analysis-tab-engine"
                  >
                    <IconBot style={{ marginRight: '0.3rem' }} />Engine
                  </button>
                ) : null}
              </div>
            </header>
            <div className="panel-content">
              {analysisTab === 'tree' ? (
                <>
                  <div className="tree-breadcrumb">
                    {breadcrumbNodeIds.map((nodeId, index) => (
                      <button
                        key={nodeId}
                        type="button"
                        className={`tree-breadcrumb-chip ${nodeId === currentNodeId ? 'tree-breadcrumb-chip-active' : ''}`}
                        onClick={() => jumpToNode(nodeId)}
                      >
                        {nodeLabel(nodeId, rootNodeId, treeNodes)}
                        {index < breadcrumbNodeIds.length - 1 ? <span className="tree-breadcrumb-sep">/</span> : null}
                      </button>
                    ))}
                  </div>
                  <MoveListTree
                    treeNodes={treeNodes}
                    rootNodeId={rootNodeId}
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
                  canStart={engineEnabled && moveHistory.length > 0}
                  onStart={startGameReview}
                  onCancel={handleCancelReview}
                  onClear={clearCompletedReview}
                  onNavigateNode={jumpToNode}
                />
              ) : (
                <>
                  <div className="pv-lines-container">
                    {pvLines.length === 0 ? (
                      <div className="text-muted small">No PV available yet.</div>
                    ) : pvLines.map((pv, i) => {
                      const normalizedScore = normalizeEvalForSide(pv.score, sideToMove);
                      return (
                        <div key={i} className="pv-line premium-card">
                          <div className={`pv-score ${normalizedScore > 0 ? 'positive' : 'negative'}`}>
                            {formatEvalScore(normalizedScore, 0)}
                          </div>
                          <div className="pv-moves">
                            <span className="turnNum">Depth {pv.depth}</span>
                            <span className="move">{pv.moves.slice(0, 7).join(' ')}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="engine-output-terminal mt-4">
                    {outputLines.slice(-20).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                    {outputLines.length === 0 && <div>Waiting for engine…</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ── Bottom bar ── */}
      <section className={`panel bottom ${bottomPanelOpen ? '' : 'hidden'}`}>
        <div
          className="resize-handle resize-handle-top"
          onClick={() => setBottomPanelOpen(o => !o)}
          title="Toggle bottom bar"
        >
          <span className="resize-pill horizontal" />
        </div>
        <div className="panel-inner">
          {engineEnabled ? <div className={`analyzing-bar ${isSearching ? 'active' : ''}`} /> : null}
          <div className="panel-content bottom-main">
            <div className="game-controls">
              <button className="gc-btn" onClick={() => setShowNewGameMenu(m => !m)}>
                <IconRefresh /> New Game
              </button>
              <button
                className="gc-btn"
                onClick={handleSaveGame}
                disabled={moveHistory.length === 0}
                title="Save current game to library"
                data-testid="save-game-btn"
              >
                <IconSave /> Save
              </button>
              <button
                className="gc-btn"
                onClick={handleCopyPgn}
                disabled={moveHistory.length === 0}
                title="Copy PGN to clipboard"
              >
                {copiedToast ? <><IconCheck /> Copied</> : 'Copy PGN'}
              </button>
              {engineEnabled && moveHistory.length > 0 && reviewStatus === 'idle' && (
                <button className="gc-btn" onClick={startGameReview} title="Analyse all moves" data-testid="start-review-btn">
                  Review Game
                </button>
              )}
              {reviewStatus === 'running' && (
                <span className="review-progress">
                  Reviewing… {Math.round(reviewProgress * 100)}%
                  <button className="chip-btn" onClick={handleCancelReview}>Cancel</button>
                </span>
              )}
              {reviewStatus === 'done' && reviewSummary && (
                <span className="review-summary">
                  <strong>{reviewSummary.accuracy}%</strong> accuracy
                  <span className="quality-blunder"> {reviewSummary.blunderCount}B</span>
                  <span className="quality-mistake"> {reviewSummary.mistakeCount}M</span>
                  <span className="quality-inaccuracy"> {reviewSummary.inaccuracyCount}I</span>
                  <button className="chip-btn" onClick={() => setAnalysisTab('review')}>View</button>
                  <button className="chip-btn" onClick={clearCompletedReview}><IconX /></button>
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
              onFirst={() => jumpToMove(-1)}
              onPrev={() => jumpToMove(currentMoveIndex - 1)}
              onNext={() => jumpToMove(currentMoveIndex + 1)}
              onLast={() => jumpToMove(moveHistory.length - 1)}
              gameMode={gameMode}
              paused={paused}
              onPause={pause}
              onResume={resume}
              onStep={step}
              aiSpeed={aiSpeed}
              onSpeedChange={handleSpeedChange}
              currentMoveIndex={currentMoveIndex}
              totalMoves={moveHistory.length}
              onScrub={jumpToMove}
            />
          </div>

          <div className="bottom-status-row">
            {engineEnabled ? (
              <div className="bottom-engine-info">
                {isSearching ? 'Analyzing' : 'Idle'}
                {inCheck ? <span className="check-badge">CHECK</span> : null}
              </div>
            ) : (
              <div className="bottom-engine-info">
                {inCheck ? <span className="check-badge">CHECK</span> : 'Play mode'}
              </div>
            )}
            <div className="bottombar-fen">FEN: {currentFen}</div>
          </div>
        </div>
      </section>

      {/* ── Persistent bottom tab bar (mobile only) ── */}
      {isMobile && (
        <nav className="mobile-tab-bar">
          <button
            className={`mobile-tab-bar-btn ${mobileView === 'board' ? 'active' : ''}`}
            onClick={() => setMobileView('board')}
          >
            <IconPawn style={{ fontSize: '1.1rem' }} />
            Board
          </button>
          <button
            className={`mobile-tab-bar-btn ${mobileView === 'analysis' ? 'active' : ''}`}
            onClick={() => setMobileView('analysis')}
          >
            <IconBarChart />
            Analysis
          </button>
        </nav>
      )}

      {gameResult && (
        <GameOverModal
          result={gameResult}
          onNewGame={() => { setGameResult(null); resetGame(); }}
          onReview={() => setGameResult(null)}
        />
      )}
    </main>
  );
}

export default App;
