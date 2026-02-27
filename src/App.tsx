import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import './App.css';
import { Board } from './components/Board/Board';
import { EvalGraph } from './components/Panels/EvalGraph';
import { WatchControls } from './components/Controls/WatchControls';
import { MoveListTree } from './components/Controls/MoveListTree';
import { IconSettings } from './components/icons';
import { useEngine } from './hooks/useEngine';
import { useXiangqi } from './hooks/useXiangqi';

export type GameMode = 'PvP' | 'PvAI-Black' | 'PvAI-Red' | 'AIvAI';
type WorkspaceMode = 'play' | 'analysis';

const GAME_MODES: Array<{ mode: GameMode; label: string }> = [
  { mode: 'PvP', label: 'Local' },
  { mode: 'PvAI-Black', label: 'vs AI (Red)' },
  { mode: 'PvAI-Red', label: 'vs AI (Black)' },
  { mode: 'AIvAI', label: 'AI vs AI' },
];

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
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth
  );

  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [searchDepth, setSearchDepth] = useState(8);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState(700);

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

  const activeLineMoves = useMemo(
    () => moveHistory.slice(0, currentMoveIndex + 1),
    [moveHistory, currentMoveIndex]
  );

  const currentPositionCommand = useMemo(() => {
    const uciMoves = activeLineMoves.map((move) => move.uci).join(' ');
    return `position startpos ${uciMoves ? 'moves ' + uciMoves : ''}`.trim();
  }, [activeLineMoves]);

  const applyBestMoveRef = useRef(false);

  const { isReady, isSearching, startSearch, stopSearch, outputLines, pvLines, evalScore } = useEngine({
    onBestMove: (uci, score) => {
      if (applyBestMoveRef.current) {
        applyUciMove(uci, score);
      }
    }
  });

  const canGoBack = currentMoveIndex >= 0;
  const canGoForward = currentMoveIndex < moveHistory.length - 1;
  const viewedPly = Math.max(0, currentMoveIndex + 1);
  const currentNode = treeNodes[currentNodeId];
  const parentNode = currentNode?.parentId ? treeNodes[currentNode.parentId] : null;
  const siblingIds = parentNode ? parentNode.childrenIds : [];
  const siblingIndex = siblingIds.indexOf(currentNodeId);
  const canPrevVariation = siblingIndex > 0;
  const canNextVariation = siblingIndex >= 0 && siblingIndex < siblingIds.length - 1;
  const variationLabel = siblingIds.length > 1 ? `V ${siblingIndex + 1}/${siblingIds.length}` : 'V 1/1';

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

  const stopAnalysis = () => {
    applyBestMoveRef.current = false;
    setAutoAnalyze(false);
    stopSearch();
  };

  const resetGame = () => {
    stopAnalysis();
    setIsAutoPlaying(false);
    resetBoard();
  };

  useEffect(() => {
    if (!engineEnabled && autoAnalyze) {
      stopAnalysis();
    }
  }, [engineEnabled, autoAnalyze]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const openSettings = document.querySelector('.settings-menu[open]') as HTMLDetailsElement | null;
        openSettings?.removeAttribute('open');
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

  useEffect(() => {
    const isAiTurn =
      gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w');

    if (!engineEnabled || !isReady || !autoAnalyze || isAiTurn) return undefined;

    applyBestMoveRef.current = false;
    stopSearch();
    const timer = setTimeout(() => {
      startSearch(currentPositionCommand);
      startSearch(`go depth ${searchDepth}`);
    }, 80);
    return () => clearTimeout(timer);
  }, [engineEnabled, isReady, autoAnalyze, gameMode, sideToMove, stopSearch, startSearch, currentPositionCommand, searchDepth]);

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

    if (autoAnalyze) {
      setAutoAnalyze(false);
      stopSearch();
    }

    if (isSearching) {
      return undefined;
    }

    const timer = setTimeout(() => {
      applyBestMoveRef.current = true;
      startSearch(currentPositionCommand);
      startSearch(`go depth ${searchDepth}`);
    }, 500);

    return () => clearTimeout(timer);
  }, [sideToMove, gameMode, isReady, isSearching, autoAnalyze, startSearch, stopSearch, searchDepth, currentPositionCommand]);

  useEffect(() => {
    if (!engineEnabled || !isSearching || currentMoveIndex < 0) return;
    setCurrentNodeEval(evalScore);
  }, [engineEnabled, isSearching, currentMoveIndex, evalScore, setCurrentNodeEval]);

  useEffect(() => {
    if (!isAutoPlaying) return;
    if (moveHistory.length === 0 || currentMoveIndex >= moveHistory.length - 1) {
      setIsAutoPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => {
      jumpToMove(currentMoveIndex + 1);
    }, playbackSpeedMs);

    return () => window.clearTimeout(timer);
  }, [isAutoPlaying, currentMoveIndex, moveHistory.length, playbackSpeedMs, jumpToMove]);

  const jumpAndPausePlayback = (index: number) => {
    setIsAutoPlaying(false);
    jumpToMove(index);
  };

  const jumpNodeAndPausePlayback = (nodeId: string) => {
    setIsAutoPlaying(false);
    jumpToNode(nodeId);
  };

  const goToSiblingVariation = (offset: -1 | 1) => {
    if (!parentNode || siblingIndex < 0) return;
    const nextIndex = siblingIndex + offset;
    const target = siblingIds[nextIndex];
    if (!target) return;
    jumpNodeAndPausePlayback(target);
  };

  const handleSquareClick = (file: number, rank: number) => {
    const isAiTurn =
      gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w');

    if (!isAiTurn) {
      setIsAutoPlaying(false);
      onSquareClick(file, rank);
    }
  };

  const toggleAnalysis = () => {
    if (!engineEnabled) return;
    if (autoAnalyze) {
      stopAnalysis();
      return;
    }
    applyBestMoveRef.current = false;
    setAutoAnalyze(true);
  };

  const applyMode = (mode: GameMode) => {
    setGameMode(mode);
    resetGame();
  };

  const closeSettingsMenu = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    const details = element?.closest('.settings-menu') as HTMLDetailsElement | null;
    details?.removeAttribute('open');
  };

  const MIN_WIDTH = 60;
  const DEFAULT_LEFT = 320;
  const DEFAULT_RIGHT = 320;

  const startLeftResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    document.body.classList.add('resizing');
    const startX = event.clientX;
    const startW = leftWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const next = startW + moveEvent.clientX - startX;
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

  const startRightResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    document.body.classList.add('resizing');
    const startX = event.clientX;
    const startW = rightWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const next = startW - (moveEvent.clientX - startX);
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

  return (
    <main className="app-shell">
      <section className={`panel top ${topPanelOpen ? '' : 'hidden'}`}>
        <div className="panel-inner">
          <div className="panel-content compact-grid">
            <div className="app-brand">
              <span className="app-brand-text">Web Xiangqi</span>
              <span className="brand-badge">Analysis</span>
            </div>

            <div className="mobile-actions">
              <button
                type="button"
                onClick={() => setLeftWidth((width) => (width > 0 ? 0 : DEFAULT_LEFT))}
              >
                <span className="btn-label">Graph</span>
              </button>
              <button
                type="button"
                onClick={resetGame}
              >
                <span className="btn-label">New</span>
              </button>
              <button
                type="button"
                onClick={toggleAnalysis}
                disabled={!isReady || !engineEnabled}
              >
                <span className="btn-label">{autoAnalyze ? 'Stop' : 'Analyze'}</span>
              </button>
              <button
                type="button"
                onClick={() => setRightWidth((width) => (width > 0 ? 0 : DEFAULT_RIGHT))}
              >
                <span className="btn-label">Tree</span>
              </button>
            </div>

            <span className="toolbar-divider desktop-only" />

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

            <div className="top-engine-state">
              <span className={`status-dot ${isReady ? 'healthy' : ''}`}></span>
              {isReady ? 'Pikafish ready' : 'Loading engine'}
            </div>

            <span className="toolbar-divider desktop-only" />

            <details className="settings-menu">
              <summary className="settings-trigger">
                <IconSettings />
                Settings
              </summary>
              <div className="settings-backdrop" onClick={(event) => closeSettingsMenu(event.currentTarget)} />
              <div className="settings-body" role="dialog" aria-modal="true" aria-label="Settings">
                <div className="settings-header">
                  <h2>Settings</h2>
                  <button
                    className="settings-close-btn"
                    type="button"
                    onClick={(event) => closeSettingsMenu(event.currentTarget)}
                  >
                    Done
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
                      closeSettingsMenu(e.currentTarget);
                    }}
                  >
                    <option value="PvP">Local Multiplayer</option>
                    <option value="PvAI-Black">Play Red vs AI</option>
                    <option value="PvAI-Red">Play Black vs AI</option>
                    <option value="AIvAI">Watch AI vs AI</option>
                  </select>
                </div>

                <div className="settings-group">
                  <label>Layout</label>
                  <div className="settings-inline-toggles">
                    <button
                      type="button"
                      className={`pill-btn ${leftPanelOpen ? 'pill-btn-active' : ''}`}
                      onClick={() => setLeftWidth((width) => (width > 0 ? 0 : DEFAULT_LEFT))}
                    >
                      Left Panel
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${rightPanelOpen ? 'pill-btn-active' : ''}`}
                      onClick={() => setRightWidth((width) => (width > 0 ? 0 : DEFAULT_RIGHT))}
                    >
                      Right Panel
                    </button>
                  </div>
                </div>

                <div className="settings-group">
                  <label>Analysis Mode</label>
                  <button
                    className={`premium-primary-btn ${autoAnalyze ? 'active' : ''}`}
                    onClick={toggleAnalysis}
                    disabled={!isReady || !engineEnabled}
                  >
                    {!engineEnabled ? 'Switch to Analysis Workspace' : (autoAnalyze ? 'Stop Analysis' : 'Analyze Position')}
                  </button>
                </div>

                <div className="settings-group">
                  <label>Search Depth (Plys)</label>
                  <input
                    type="range"
                    min="1"
                    max="24"
                    value={searchDepth}
                    onChange={(e) => setSearchDepth(Number(e.target.value))}
                    className="premium-slider"
                  />
                  <div className="setting-value">Depth: {searchDepth}</div>
                </div>
              </div>
            </details>
          </div>
        </div>
        <div className="resize-handle resize-handle-bottom" onClick={() => setTopPanelOpen((open) => !open)} title="Toggle top bar">
          <span className="resize-pill horizontal" />
        </div>
      </section>

      <div className="main-container">
        <section className="panel left" style={{ width: leftWidth }}>
          <div
            className="resize-handle resize-handle-right"
            onMouseDown={startLeftResize}
            onClick={() => {
              if (leftWidth === 0) setLeftWidth(DEFAULT_LEFT);
            }}
            title="Drag to resize · click to expand"
          >
            <span className="resize-pill" />
          </div>
          <div className="panel-inner" style={{ opacity: (!isMobile && leftWidth === 0) ? 0 : 1 }}>
            <header className="panel-header">
              <h2>Analysis Graph</h2>
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

        <section className="board-stage" aria-label="Xiangqi board">
          <div className="board-wrap">
            <Board
              board={board}
              selected={selected}
              validTargets={validTargets}
              onSquareClick={handleSquareClick}
            />
          </div>
        </section>

        <aside className="panel right" style={{ width: rightWidth }}>
          <div
            className="resize-handle resize-handle-left"
            onMouseDown={startRightResize}
            onClick={() => {
              if (rightWidth === 0) setRightWidth(DEFAULT_RIGHT);
            }}
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
                  Game Tree
                </button>
                <button
                  type="button"
                  className={`analysis-tab-btn ${analysisTab === 'engine' ? 'active' : ''}`}
                  onClick={() => setAnalysisTab('engine')}
                >
                  Engine
                </button>
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
                    {outputLines.length === 0 && <div>Waiting for engine...</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      <section className={`panel bottom ${bottomPanelOpen ? '' : 'hidden'}`}>
        <div className="resize-handle resize-handle-top" onClick={() => setBottomPanelOpen((open) => !open)} title="Toggle bottom bar">
          <span className="resize-pill horizontal" />
        </div>
        <div className="panel-inner">
          <div className={`analyzing-bar ${isSearching ? 'active' : ''}`} />
          <div className="panel-content bottom-main">
            <div className="game-controls">
              <button className="gc-btn" onClick={resetGame}>New Game</button>
              <button
                className={`gc-btn ${autoAnalyze ? 'gc-btn-pause' : 'gc-btn-resume'}`}
                onClick={toggleAnalysis}
                disabled={!isReady || !engineEnabled}
              >
                {autoAnalyze ? 'Stop Analysis' : 'Analyze'}
              </button>
              <span className="game-mode-badge">
                {GAME_MODES.find((item) => item.mode === gameMode)?.label ?? gameMode}
              </span>
            </div>

            <WatchControls
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onFirst={() => jumpAndPausePlayback(-1)}
              onPrev={() => jumpAndPausePlayback(currentMoveIndex - 1)}
              onNext={() => jumpAndPausePlayback(currentMoveIndex + 1)}
              onLast={() => jumpAndPausePlayback(moveHistory.length - 1)}
              canPrevVariation={canPrevVariation}
              canNextVariation={canNextVariation}
              onPrevVariation={() => goToSiblingVariation(-1)}
              onNextVariation={() => goToSiblingVariation(1)}
              variationLabel={variationLabel}
              isAutoPlaying={isAutoPlaying}
              onToggleAutoPlay={() => {
                if (moveHistory.length === 0) return;
                if (currentMoveIndex >= moveHistory.length - 1) {
                  jumpAndPausePlayback(-1);
                }
                setIsAutoPlaying((playing) => !playing);
              }}
              playbackSpeedMs={playbackSpeedMs}
              onPlaybackSpeedChange={setPlaybackSpeedMs}
              currentMoveIndex={currentMoveIndex}
              totalMoves={moveHistory.length}
              onScrub={jumpAndPausePlayback}
            />
          </div>

          <div className="bottom-status-row">
            <div className="bottom-engine-info">
              {isSearching ? `Analyzing depth ${searchDepth}` : `Idle at depth ${searchDepth}`}
              {inCheck ? <span className="check-badge">CHECK</span> : null}
            </div>
            <div className="bottombar-fen">FEN: {currentFen}</div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
