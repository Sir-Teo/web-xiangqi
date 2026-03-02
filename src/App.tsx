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
  IconBot, IconX, IconPause
} from './components/icons';
import { useEngine } from './hooks/useEngine';
import { useXiangqi } from './hooks/useXiangqi';

export type GameMode = 'PvP' | 'PvAI-Black' | 'PvAI-Red' | 'AIvAI';
type WorkspaceMode = 'play' | 'analysis';
type AnalysisEngineMode = 'stable' | 'optimized';

const GAME_MODES: Array<{ mode: GameMode; label: string; icon?: string }> = [
  { mode: 'PvP', label: 'Local' },
  { mode: 'PvAI-Black', label: 'vs AI (Red)' },
  { mode: 'PvAI-Red', label: 'vs AI (Black)' },
  { mode: 'AIvAI', label: 'AI vs AI' },
];
const WORKER_SAFE_MAX_DEPTH = 12;

function nodeLabel(nodeId: string, rootNodeId: string, treeNodes: ReturnType<typeof useXiangqi>['treeNodes']) {
  if (nodeId === rootNodeId) return 'Start';
  const record = treeNodes[nodeId]?.record;
  if (!record) return 'Node';
  return `${record.ply}. ${record.uci}`;
}

function App() {
  const [gameMode, setGameMode] = useState<GameMode>('PvP');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('analysis');
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(320);
  const [topPanelOpen, setTopPanelOpen] = useState(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [analysisTab, setAnalysisTab] = useState<'tree' | 'engine'>('tree');
  const [showSettings, setShowSettings] = useState(false);
  const [orientation, setOrientation] = useState<BoardOrientation>('red');
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth
  );

  const [searchDepth, setSearchDepth] = useState(8);
  const [analysisEngineMode, setAnalysisEngineMode] = useState<AnalysisEngineMode>('optimized');
  const [engineRestartToken, setEngineRestartToken] = useState(0);
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
    onSquareClick,
    resetBoard,
    sideToMove,
    applyUciMove,
    setCurrentNodeEval,
    jumpToMove,
    jumpToNode,
  } = useXiangqi();

  const currentPositionCommand = useMemo(() => {
    return `position fen ${currentFen}`;
  }, [currentFen]);
  const useInfiniteAnalysis = analysisEngineMode === 'optimized';
  const analysisRequestKey = useMemo(() => {
    if (useInfiniteAnalysis) {
      return `${currentPositionCommand}::infinite`;
    }
    return `${currentPositionCommand}::depth:${Math.min(searchDepth, WORKER_SAFE_MAX_DEPTH)}`;
  }, [currentPositionCommand, searchDepth, useInfiniteAnalysis]);

  const applyBestMoveRef = useRef(false);
  const activeAnalysisRequestRef = useRef('');
  const settledAnalysisRequestRef = useRef('');
  const currentAnalysisRequestKeyRef = useRef(analysisRequestKey);
  const engineRecoveryTimestampsRef = useRef<number[]>([]);
  const lastEngineRecoveryAtRef = useRef(0);
  currentAnalysisRequestKeyRef.current = analysisRequestKey;

  const restartEngine = useCallback(() => {
    setEngineRestartToken((value) => value + 1);
  }, []);

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
    settledAnalysisRequestRef.current = '';

    if (engineRecoveryTimestampsRef.current.length > 3) {
      console.error('Pikafish worker crashed repeatedly; automatic restart suppressed.', message);
      return;
    }

    if (workspaceMode === 'analysis' && analysisEngineMode === 'optimized') {
      setAnalysisEngineMode('stable');
    }

    restartEngine();
  }, [analysisEngineMode, restartEngine, workspaceMode]);

  const { isReady, isSearching, variant: engineVariant, startSearch, stopSearch, outputLines, pvLines, evalScore } = useEngine({
    restartToken: engineRestartToken,
    onWorkerError: handleEngineWorkerError,
    onBestMove: (uci, score) => {
      if (applyBestMoveRef.current) {
        applyUciMove(uci, score);
        // In step mode: after applying the AI move, re-pause
        if (aiSpeedRef.current === 'step' || stepPendingRef.current) {
          stepPendingRef.current = false;
          pausedRef.current = true;
          setPaused(true);
        }
        applyBestMoveRef.current = false;
      } else {
        settledAnalysisRequestRef.current = currentAnalysisRequestKeyRef.current;
      }
    }
  });
  const safeSearchDepth = Math.min(searchDepth, WORKER_SAFE_MAX_DEPTH);

  const canGoBack = currentMoveIndex >= 0;
  const canGoForward = currentMoveIndex < moveHistory.length - 1;
  const viewedPly = Math.max(0, currentMoveIndex + 1);

  const breadcrumbNodeIds = useMemo(() => {
    const path: string[] = [];
    let cursor: string | null = currentNodeId;
    while (cursor && cursor !== rootNodeId) {
      path.push(cursor);
      cursor = treeNodes[cursor]?.parentId ?? null;
    }
    path.reverse();
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
  const isMobile = viewportWidth <= 900;
  const leftPanelOpen = leftWidth > 0;
  const rightPanelOpen = rightWidth > 0;
  const engineEnabled = workspaceMode === 'analysis';

  const stopAnalysis = useCallback(() => {
    applyBestMoveRef.current = false;
    stopSearch();
  }, [stopSearch]);

  const resetGame = useCallback(() => {
    stopAnalysis();
    pausedRef.current = false;
    setPaused(false);
    resetBoard();
  }, [stopAnalysis, resetBoard]);

  useEffect(() => {
    if (!engineEnabled) {
      applyBestMoveRef.current = false;
      stopSearch();
      activeAnalysisRequestRef.current = '';
      settledAnalysisRequestRef.current = '';
    }
  }, [engineEnabled, stopSearch]);

  useEffect(() => {
    if (!engineEnabled && analysisTab === 'engine') {
      setAnalysisTab('tree');
    }
  }, [engineEnabled, analysisTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSettings(false);
      }
    };
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Analysis engine effect
  useEffect(() => {
    const isAiTurn =
      gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w');

    if (!engineEnabled || !isReady) {
      activeAnalysisRequestRef.current = '';
      settledAnalysisRequestRef.current = '';
      if (isSearching) {
        applyBestMoveRef.current = false;
        stopSearch();
      }
      return;
    }

    if (isAiTurn) {
      activeAnalysisRequestRef.current = '';
      settledAnalysisRequestRef.current = '';
      if (isSearching && !applyBestMoveRef.current) {
        stopSearch();
      }
      return;
    }

    const requestChanged = activeAnalysisRequestRef.current !== analysisRequestKey;
    if (requestChanged) {
      activeAnalysisRequestRef.current = analysisRequestKey;
      settledAnalysisRequestRef.current = '';
    }

    if (isSearching) {
      if (requestChanged) {
        applyBestMoveRef.current = false;
        stopSearch();
      }
      return;
    }

    if (settledAnalysisRequestRef.current === analysisRequestKey) {
      return;
    }

    applyBestMoveRef.current = false;
    startSearch(currentPositionCommand);
    startSearch(useInfiniteAnalysis ? 'go infinite' : `go depth ${safeSearchDepth}`);
  }, [engineEnabled, isReady, gameMode, sideToMove, currentPositionCommand, analysisRequestKey, isSearching, stopSearch, startSearch, safeSearchDepth, useInfiniteAnalysis]);

  // AI move effect
  useEffect(() => {
    if (!isReady) return;

    const isAiTurn =
      gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w');

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
      startSearch(currentPositionCommand);
      startSearch(`go depth ${safeSearchDepth}`);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [sideToMove, gameMode, isReady, isSearching, startSearch, stopSearch, currentPositionCommand, paused, safeSearchDepth]);

  // Eval capture for graph
  useEffect(() => {
    if (!engineEnabled || !isSearching || currentMoveIndex < 0) return;
    setCurrentNodeEval(evalScore);
  }, [engineEnabled, isSearching, currentMoveIndex, evalScore, setCurrentNodeEval]);

  const jumpAndPausePlayback = useCallback((index: number) => {
    jumpToMove(index);
  }, [jumpToMove]);

  const jumpNodeAndPausePlayback = useCallback((nodeId: string) => {
    jumpToNode(nodeId);
  }, [jumpToNode]);


  const handleSquareClick = (file: number, rank: number) => {
    const isAiTurn =
      gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w');

    if (!isAiTurn) {
      onSquareClick(file, rank);
    }
  };

  const applyMode = (mode: GameMode) => {
    setGameMode(mode);
    resetGame();
  };

  const MIN_WIDTH = 60;
  const DEFAULT_LEFT = 320;
  const DEFAULT_RIGHT = 320;

  const startLeftResize = (event: React.MouseEvent) => {
    event.preventDefault();
    document.body.classList.add('resizing');
    const startX = event.clientX;
    const startW = leftWidth;
    const onMove = (e: MouseEvent) => {
      const next = startW + e.clientX - startX;
      setLeftWidth(next < MIN_WIDTH ? 0 : Math.min(next, 600));
    };
    const onUp = () => {
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const startRightResize = (event: React.MouseEvent) => {
    event.preventDefault();
    document.body.classList.add('resizing');
    const startX = event.clientX;
    const startW = rightWidth;
    const onMove = (e: MouseEvent) => {
      const next = startW - (e.clientX - startX);
      setRightWidth(next < MIN_WIDTH ? 0 : Math.min(next, 600));
    };
    const onUp = () => {
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const isAiMode = gameMode !== 'PvP';
  const isGameOver = false; // TODO: detect checkmate

  return (
    <main className="app-shell">
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

            <span className="toolbar-divider desktop-only" />

            {/* Game mode pills */}
            <div className="top-mode-pills" role="tablist" aria-label="Game mode">
              {GAME_MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  className={`gc-pill ${gameMode === mode ? 'gc-pill-active' : ''}`}
                  onClick={() => applyMode(mode)}
                >
                  {label}
                </button>
              ))}
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
                className="top-action-btn"
                onClick={resetGame}
                title="New game"
                aria-label="Start new game"
              >
                <IconRefresh />
                <span className="btn-label-desktop">New</span>
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
                Search Depth (AI / Stable Analysis) — {searchDepth}
                {!useInfiniteAnalysis && searchDepth > safeSearchDepth ? ` (worker cap ${safeSearchDepth})` : ''}
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

      <div className="main-container">
        {/* ── Left panel: Eval Graph ── */}
        <section className="panel left" style={{ width: leftWidth }}>
          <div
            className="resize-handle resize-handle-right"
            onMouseDown={startLeftResize}
            onClick={() => { if (leftWidth === 0) setLeftWidth(DEFAULT_LEFT); }}
            title="Drag to resize · click to expand"
          >
            <span className="resize-pill" />
          </div>
          <div className="panel-inner" style={{ opacity: (!isMobile && leftWidth === 0) ? 0 : 1 }}>
            <header className="panel-header">
              <h2><IconBarChart style={{ marginRight: '0.35rem', verticalAlign: 'middle' }} />Analysis Graph</h2>
              <span className="panel-kicker">Click chart nodes to jump</span>
            </header>
            <div className="panel-content">
              <EvalGraph
                history={moveHistory}
                currentMoveIndex={currentMoveIndex}
                currentEval={evalScore}
                isSearching={isSearching}
                branchCounts={graphBranchCounts}
                rootBranchCount={rootGraphBranchCount}
                onNavigate={jumpAndPausePlayback}
              />
              <div className="graph-jump-controls">
                <button type="button" className="chip-btn" onClick={() => jumpAndPausePlayback(-1)} disabled={!canGoBack}>Start</button>
                <button type="button" className="chip-btn" onClick={() => jumpAndPausePlayback(currentMoveIndex - 1)} disabled={!canGoBack}>Prev</button>
                <button type="button" className="chip-btn" onClick={() => jumpAndPausePlayback(currentMoveIndex + 1)} disabled={!canGoForward}>Next</button>
                <button type="button" className="chip-btn" onClick={() => jumpAndPausePlayback(moveHistory.length - 1)} disabled={!canGoForward}>Live</button>
              </div>
              <p className="panel-copy small">
                Active ply: <strong>{viewedPly}</strong> / {moveHistory.length}
              </p>
            </div>
          </div>
        </section>

        {/* ── Board stage ── */}
        <section className="board-stage" aria-label="Xiangqi board">
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
            />
            {inCheck && (
              <div className="check-overlay">
                <span className="check-badge">CHECK</span>
              </div>
            )}
          </div>
        </section>

        {/* ── Right panel: Move tree / Engine ── */}
        <aside className="panel right" style={{ width: rightWidth }}>
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
                        onClick={() => jumpNodeAndPausePlayback(nodeId)}
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
                    onNavigateNode={jumpNodeAndPausePlayback}
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
              <button className="gc-btn" onClick={resetGame}>
                <IconRefresh /> New Game
              </button>
              <span className="game-mode-badge">
                {isAiMode && <IconBot />}
                {GAME_MODES.find(m => m.mode === gameMode)?.label ?? gameMode}
              </span>
            </div>

            <WatchControls
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onFirst={() => jumpAndPausePlayback(-1)}
              onPrev={() => jumpAndPausePlayback(currentMoveIndex - 1)}
              onNext={() => jumpAndPausePlayback(currentMoveIndex + 1)}
              onLast={() => jumpAndPausePlayback(moveHistory.length - 1)}
              gameMode={gameMode}
              paused={paused}
              isGameOver={isGameOver}
              onPause={pause}
              onResume={resume}
              onStep={step}
              aiSpeed={aiSpeed}
              onSpeedChange={handleSpeedChange}
              currentMoveIndex={currentMoveIndex}
              totalMoves={moveHistory.length}
              onScrub={jumpAndPausePlayback}
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
    </main>
  );
}

export default App;
