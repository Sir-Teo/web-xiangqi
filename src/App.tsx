import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Board } from './components/Board/Board';
import type { BoardOrientation } from './components/Board/Board';
import { EvalGraph } from './components/Panels/EvalGraph';
import { WatchControls } from './components/Controls/WatchControls';
import type { AiSpeed } from './components/Controls/WatchControls';
import { AI_SPEED_MS } from './components/Controls/WatchControls';
import { MoveListTree } from './components/Controls/MoveListTree';
import {
  IconSettings, IconRefresh, IconFlip, IconBarChart, IconTree,
  IconBot, IconX, IconPause, IconPlay, IconSave, IconLibrary, IconArrow
} from './components/icons';
import { useEngine } from './hooks/useEngine';
import { useXiangqi } from './hooks/useXiangqi';
import { uciToSquare } from './utils/xiangqi';
import { WdlBar } from './components/Panels/WdlBar';
import { playMoveSound, playCaptureSound, playCheckSound } from './utils/sounds';
import { matchOpening } from './utils/openings';
import { useGameLibrary } from './hooks/useGameLibrary';
import type { SavedGame } from './utils/gameLibrary';
import { LibraryPanel } from './components/Library/LibraryPanel';
import type { HistoricalGame } from './utils/historicalGames';
import { useGameReview, computeReviewSummary } from './hooks/useGameReview';
import { GameOverModal } from './components/GameOverModal';
import { exportPgn, copyToClipboard } from './utils/gameExport';
import {
  detectDeviceTier,
  resolveEngineBootConfig,
  resolveLiveAnalysisPolicy,
  resolveReviewPolicy,
} from './utils/analysisProfile';

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
const AI_STRENGTH_LABELS: Record<AiStrength, string> = {
  1: 'Beginner',
  2: 'Easy',
  3: 'Medium',
  4: 'Hard',
  5: 'Master',
};
const AI_SKILL_LEVEL: Record<AiStrength, number> = {
  1: 3,
  2: 7,
  3: 12,
  4: 17,
  5: 20,
};
const WORKER_SAFE_MAX_DEPTH = 12;
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

function App() {
  const [gameMode, setGameMode] = useState<GameMode>('PvP');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('analysis');
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(320);
  const [topPanelOpen, setTopPanelOpen] = useState(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [analysisTab, setAnalysisTab] = useState<'tree' | 'engine'>('tree');
  const [mobileView, setMobileView] = useState<'board' | 'analysis'>('board');
  const [mobileAnalysisTab, setMobileAnalysisTab] = useState<'moves' | 'graph'>('moves');
  const [showArrows, setShowArrows] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewGameMenu, setShowNewGameMenu] = useState(false);
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
    sideToMove,
    applyUciMove,
    setCurrentNodeEval,
    setNodeEvals,
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
    const summary = computeReviewSummary(activeLineNodeIds, treeNodes, controller.provisionalEvals);
    flushReviewEvalUpdates();
    resetReviewController(false);
    completeReview(summary);
  }, [activeLineNodeIds, completeReview, flushReviewEvalUpdates, resetReviewController, treeNodes]);

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
  }, [cancelReview, clearAnalysisDeepenTimer, resetReviewController, restartEngine, workspaceMode]);

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
        queueReviewEvalUpdate(reviewTag.nodeId, score);

        if (reviewTag.phase === 'base' && reviewPolicy.revisit) {
          const parentId = treeNodes[reviewTag.nodeId]?.parentId ?? null;
          const parentEval = parentId ? getEffectiveNodeEval(parentId) : 0;
          if (typeof parentEval === 'number') {
            const swing = Math.abs(score - parentEval);
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
          applyUciMove(uci, score);
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

      if (currentMoveIndex >= 0) {
        setCurrentNodeEval(score);
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
    cancelReview();
    clearQueuedSearch();
    stopSearch();
  }, [cancelReview, clearQueuedSearch, flushReviewEvalUpdates, resetReviewController, stopSearch]);

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

  // Stop AI engine when game ends
  useEffect(() => {
    if (gameResult) {
      stopAnalysis();
    }
  }, [gameResult, stopAnalysis]);

  // Apply AI skill level whenever it changes or engine becomes ready
  useEffect(() => {
    if (!isReady) return;
    setOption('Skill Level', AI_SKILL_LEVEL[aiStrength]);
  }, [isReady, aiStrength, setOption]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSettings(false);
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

    const timer = setTimeout(() => {
      // Check again in case pause was set during the delay
      if (pausedRef.current && !stepPendingRef.current) {
        return;
      }
      applyBestMoveRef.current = true;
      queueSearch(
        currentPositionCommand,
        `go depth ${safeSearchDepth}`,
        0,
        `${AI_TAG_PREFIX}|${currentPositionCommand}|${safeSearchDepth}`,
      );
    }, delayMs);

    return () => clearTimeout(timer);
  }, [currentPositionCommand, isAiTurn, isReady, isSearching, queueSearch, safeSearchDepth]);

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
  }, [finalizeReview, getNodeFen, isReady, isSearching, queueSearch, reviewPolicy.base.goCmd, reviewPolicy.revisit, reviewPolicy.revisitLimit, reviewRevisitGoCmd, updateReviewProgress]);

  const startGameReview = useCallback(() => {
    if (applyBestMoveRef.current) return;
    if (!engineEnabled || !isReady) return;
    stopAnalysis();
    resetReviewController(true);
    clearPvLines();
    clearWdl();
    currentMultiPvRef.current = 1;
    currentShowWdlRef.current = false;
    setOption('MultiPV', 1);
    setOption('UCI_ShowWDL', false);

    const totalSteps = activeLineNodeIds.length;
    if (!startReview(totalSteps)) {
      completeReview(computeReviewSummary(activeLineNodeIds, treeNodes));
      return;
    }

    reviewControllerRef.current = {
      ...createReviewController(),
      active: true,
      phase: 'base',
      baseQueue: [...activeLineNodeIds],
      total: totalSteps,
    };
  }, [activeLineNodeIds, applyBestMoveRef, clearPvLines, clearWdl, completeReview, engineEnabled, isReady, resetReviewController, setOption, startReview, stopAnalysis, treeNodes]);

  const handleSquareClick = useCallback((file: number, rank: number) => {
    if (gameResult) return;
    if (!isAiTurn || paused) {
      onSquareClick(file, rank);
    }
  }, [gameResult, isAiTurn, paused, onSquareClick]);

  const applyMode = (mode: GameMode) => {
    setGameMode(mode);
    resetGame();
  };

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

  const lastMoveUci = treeNodes[currentNodeId]?.record?.uci ?? null;
  const lastMoveFrom = useMemo(() => lastMoveUci ? uciToSquare(lastMoveUci.substring(0, 2)) : null, [lastMoveUci]);
  const lastMoveTo   = useMemo(() => lastMoveUci ? uciToSquare(lastMoveUci.substring(2, 4)) : null, [lastMoveUci]);

  const lastMoveArrowColor = useMemo(() => {
    const currentEval = treeNodes[currentNodeId]?.record?.evalScore;
    const parentId    = treeNodes[currentNodeId]?.parentId;
    const parentEval  = parentId ? treeNodes[parentId]?.record?.evalScore : 0;
    if (typeof currentEval !== 'number' || typeof parentEval !== 'number') return '#94a3b8';
    const delta = Math.abs(currentEval - parentEval);
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

  const handleSaveGame = useCallback(() => {
    const moves = activeLineNodeIds
      .slice(0, currentMoveIndex + 1)
      .map(id => treeNodes[id]?.record?.uci)
      .filter((uci): uci is string => Boolean(uci));
    saveGameToLibrary(gameMode, moves, {
      opening: detectedOpening?.name,
      finalEval: evalScore,
    });
  }, [activeLineNodeIds, currentMoveIndex, treeNodes, gameMode, saveGameToLibrary, detectedOpening, evalScore]);

  const handleLoadGame = useCallback((game: SavedGame) => {
    stopAnalysis();
    handleCancelReview();
    resetReview();
    setLeftPanelTab('graph');
    loadMoves(game.moves);
    setGraphLoadSweepToken((token) => token + 1);
  }, [handleCancelReview, loadMoves, resetReview, stopAnalysis]);

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
              <span className="app-brand-icon">♟</span>
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
                onClick={() => setShowNewGameMenu(m => !m)}
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
                onClick={() => setShowSettings(s => !s)}
                title="Settings"
                aria-label="Open settings"
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
              >
                <IconBarChart />
              </button>
              <button
                type="button"
                onClick={() => setRightWidth(w => w > 0 ? 0 : DEFAULT_RIGHT)}
                title="Toggle tree panel"
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
            onClick={() => setShowSettings(false)}
            aria-hidden="true"
          />
          <div className="settings-body" role="dialog" aria-modal="true" aria-label="Settings">
            <div className="settings-header">
              <h2>Settings</h2>
              <button
                className="settings-close-btn"
                type="button"
                onClick={() => setShowSettings(false)}
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
            onClick={() => setShowNewGameMenu(false)}
            aria-hidden="true"
          />
          <div className="new-game-menu" role="dialog" aria-modal="true" aria-label="New game">
            <div className="settings-header">
              <h2>New Game</h2>
              <button
                className="settings-close-btn"
                type="button"
                onClick={() => setShowNewGameMenu(false)}
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
                  className={`new-game-mode-btn ${gameMode === mode ? 'new-game-mode-btn-active' : ''}`}
                  onClick={() => { applyMode(mode); setShowNewGameMenu(false); }}
                >
                  {label}
                </button>
              ))}
            </div>
            {gameMode !== 'PvP' && (
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
                  {engineEnabled && <WdlBar wdl={wdl} isSearching={isSearching} />}
                  <EvalGraph
                    history={moveHistory}
                    currentMoveIndex={currentMoveIndex}
                    currentEval={evalScore}
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
          {isMobile && mobileView === 'board' && (
            <div className="mobile-board-header">
              <div className="mobile-board-turn-info">
                <span className={`turn-dot turn-dot-${sideToMove === 'w' ? 'red' : 'black'}`} />
                <span className="mobile-turn-label">{sideToMove === 'w' ? 'Red' : 'Black'}</span>
                {engineEnabled && evalScore !== null && (
                  <span className={`mobile-eval-chip ${evalScore > 0 ? 'eval-positive' : evalScore < 0 ? 'eval-negative' : ''}`}>
                    {evalScore > 0 ? '+' : ''}{(evalScore / 100).toFixed(1)}
                  </span>
                )}
                {detectedOpening && (
                  <span className="mobile-opening-pill" title={detectedOpening.name}>
                    {detectedOpening.name}
                  </span>
                )}
              </div>
              <div className="mobile-board-actions">
                <button className="mobile-action-btn" onClick={() => setShowNewGameMenu(m => !m)} title="New game"><IconRefresh /></button>
                {isAiMode && (
                  <button className={`mobile-action-btn ${paused ? 'mobile-action-btn-warn' : ''}`} onClick={() => paused ? resume() : pause()} title={paused ? 'Resume AI' : 'Pause AI'}>
                    {paused ? <IconPlay /> : <IconPause />}
                  </button>
                )}
                <button className={`mobile-action-btn ${showArrows ? 'mobile-action-btn-active' : ''}`} onClick={() => setShowArrows(v => !v)} title="Toggle arrows"><IconArrow /></button>
                <button className="mobile-action-btn" onClick={() => setOrientation(o => o === 'red' ? 'black' : 'red')} title="Flip board"><IconFlip /></button>
                <button className="mobile-action-btn" onClick={() => setShowSettings(s => !s)} title="Settings"><IconSettings /></button>
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
              <button className="mobile-nav-btn" onClick={() => jumpToMove(-1)} disabled={!canGoBack}>⏮</button>
              <button className="mobile-nav-btn" onClick={() => jumpToMove(currentMoveIndex - 1)} disabled={!canGoBack}>‹</button>
              <span className="mobile-nav-label">
                {currentMoveIndex < 0 ? 'Start' : `${currentMoveIndex + 1} / ${moveHistory.length}`}
              </span>
              <button className="mobile-nav-btn" onClick={() => jumpToMove(currentMoveIndex + 1)} disabled={!canGoForward}>›</button>
              <button className="mobile-nav-btn" onClick={() => jumpToMove(moveHistory.length - 1)} disabled={!canGoForward}>⏭</button>
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
              <h2>Review</h2>
              <div className="analysis-tab-strip">
                <button
                  type="button"
                  className={`analysis-tab-btn ${analysisTab === 'tree' ? 'active' : ''}`}
                  onClick={() => setAnalysisTab('tree')}
                >
                  <IconTree style={{ marginRight: '0.3rem' }} />Game Tree
                </button>
                {engineEnabled ? (
                  <button
                    type="button"
                    className={`analysis-tab-btn ${analysisTab === 'engine' ? 'active' : ''}`}
                    onClick={() => setAnalysisTab('engine')}
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
              ) : (
                <>
                  <div className="pv-lines-container">
                    {pvLines.length === 0 ? (
                      <div className="text-muted small">No PV available yet.</div>
                    ) : pvLines.map((pv, i) => (
                      <div key={i} className="pv-line premium-card">
                        <div className={`pv-score ${pv.score > 0 ? 'positive' : 'negative'}`}>{pv.scoreStr}</div>
                        <div className="pv-moves">
                          <span className="turnNum">Depth {pv.depth}</span>
                          <span className="move">{pv.moves.slice(0, 7).join(' ')}</span>
                        </div>
                      </div>
                    ))}
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
              <button className="gc-btn" onClick={handleSaveGame} disabled={moveHistory.length === 0} title="Save current game to library">
                <IconSave /> Save
              </button>
              <button
                className="gc-btn"
                onClick={handleCopyPgn}
                disabled={moveHistory.length === 0}
                title="Copy PGN to clipboard"
              >
                {copiedToast ? '✓ Copied' : 'Copy PGN'}
              </button>
              {engineEnabled && moveHistory.length > 0 && reviewStatus === 'idle' && (
                <button className="gc-btn" onClick={startGameReview} title="Analyse all moves">
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
                  <button className="chip-btn" onClick={resetReview}>✕</button>
                </span>
              )}
              <span className="game-mode-badge">
                {isAiMode && <IconBot />}
                {GAME_MODES.find(m => m.mode === gameMode)?.label ?? gameMode}
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
            <span style={{ fontSize: '1.1rem' }}>♟</span>
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
