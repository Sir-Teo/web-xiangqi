import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Board } from './components/Board/Board';
import { EvalGraph } from './components/Panels/EvalGraph';
import { WatchControls } from './components/Controls/WatchControls';
import { MoveListTree } from './components/Controls/MoveListTree';
import { useEngine } from './hooks/useEngine';
import { useXiangqi } from './hooks/useXiangqi';

export type GameMode = 'PvP' | 'PvAI-Black' | 'PvAI-Red' | 'AIvAI';

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
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [analysisTab, setAnalysisTab] = useState<'tree' | 'engine'>('tree');

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const openSettings = document.querySelector('.settings-menu[open]') as HTMLDetailsElement | null;
      openSettings?.removeAttribute('open');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Auto-analyze while exploring a position tree.
  useEffect(() => {
    const isAiTurn =
      gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w');

    if (!isReady || !autoAnalyze || isAiTurn) return undefined;

    applyBestMoveRef.current = false;
    if (isSearching) {
      stopSearch();
    }
    const timer = setTimeout(() => {
      startSearch(currentPositionCommand);
      startSearch(`go depth ${searchDepth}`);
    }, 80);
    return () => clearTimeout(timer);
  }, [isReady, autoAnalyze, gameMode, sideToMove, isSearching, stopSearch, startSearch, currentPositionCommand, searchDepth]);

  // AI turn orchestrator.
  useEffect(() => {
    if (!isReady) return;

    const isAiTurn =
      gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w');

    if (isAiTurn && !isSearching) {
      if (autoAnalyze) {
        setAutoAnalyze(false);
        stopSearch();
      }

      const timer = setTimeout(() => {
        applyBestMoveRef.current = true;
        startSearch(currentPositionCommand);
        startSearch(`go depth ${searchDepth}`);
      }, 500);

      return () => clearTimeout(timer);
    }

    applyBestMoveRef.current = false;
    return undefined;
  }, [sideToMove, gameMode, isReady, isSearching, autoAnalyze, startSearch, stopSearch, searchDepth, currentPositionCommand]);

  // Playback mode for stepping through previous moves quickly.
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
    if (autoAnalyze) {
      stopAnalysis();
      return;
    }
    applyBestMoveRef.current = false;
    setAutoAnalyze(true);
  };

  const closeSettingsMenu = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    const details = element?.closest('.settings-menu') as HTMLDetailsElement | null;
    details?.removeAttribute('open');
  };

  const settingsPanel = (
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
          <label>Game Mode</label>
          <select
            className="premium-select"
            value={gameMode}
            onChange={(e) => {
              setGameMode(e.target.value as GameMode);
              resetGame();
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
              onClick={() => setLeftPanelOpen((open) => !open)}
            >
              Left Panel
            </button>
            <button
              type="button"
              className={`pill-btn ${rightPanelOpen ? 'pill-btn-active' : ''}`}
              onClick={() => setRightPanelOpen((open) => !open)}
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
            disabled={!isReady || gameMode === 'AIvAI'}
          >
            {autoAnalyze ? 'Stop Analysis' : 'Analyze Position'}
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
  );

  return (
    <div className="app-container">
      <header className="topbar glass-panel">
        <div className="topbar-left">
          <button
            className="icon-btn"
            onClick={() => setLeftPanelOpen((open) => !open)}
            aria-label="Toggle left panel"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
          </button>
          <div className="brand">
            <h1>Web Xiangqi</h1>
            <span className="badge">Analysis</span>
          </div>
        </div>

        <div className="topbar-center">
          <div className="top-mode-pills" role="tablist" aria-label="Game mode">
            {GAME_MODES.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                className={`mode-pill ${gameMode === mode ? 'mode-pill-active' : ''}`}
                onClick={() => {
                  setGameMode(mode);
                  resetGame();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="engine-status">
            <span className={`status-dot ${isReady ? 'healthy' : ''}`}></span>
            {isReady ? 'Pikafish ready' : 'Loading engine'}
          </div>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="icon-btn top-action-btn"
            onClick={resetGame}
            aria-label="New game"
          >
            New
          </button>
          <button
            type="button"
            className={`icon-btn top-action-btn ${autoAnalyze ? 'top-action-active' : ''}`}
            onClick={toggleAnalysis}
            disabled={!isReady || gameMode === 'AIvAI'}
            aria-label={autoAnalyze ? 'Stop analysis' : 'Start analysis'}
          >
            {autoAnalyze ? 'Stop' : 'Analyze'}
          </button>

          <details className="settings-menu">
            <summary aria-label="Settings">
              <span className="icon-btn">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </span>
            </summary>
            <div className="settings-backdrop" onClick={(event) => closeSettingsMenu(event.currentTarget)} />
            {settingsPanel}
          </details>

          <button
            type="button"
            className="icon-btn"
            onClick={() => setRightPanelOpen((open) => !open)}
            aria-label="Toggle right panel"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="15" y1="3" x2="15" y2="21"></line>
            </svg>
          </button>
        </div>
      </header>

      <main className="main-content">
        <aside className={`panel left-panel glass-panel ${leftPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header">
            <h2>Analysis Graph</h2>
            <span className="panel-kicker">Click any node to jump</span>
          </div>
          <div className="panel-content">
            <EvalGraph
              history={moveHistory}
              currentMoveIndex={currentMoveIndex}
              currentEval={evalScore}
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
        </aside>

        <section className="board-area">
          <div className="board-stage">
            <Board
              board={board}
              selected={selected}
              validTargets={validTargets}
              onSquareClick={handleSquareClick}
            />
          </div>
        </section>

        <aside className={`panel right-panel glass-panel ${rightPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header panel-header-tabs">
            <h2>Review</h2>
            <div className="analysis-tabs">
              <button
                type="button"
                className={`analysis-tab-btn ${analysisTab === 'tree' ? 'analysis-tab-btn-active' : ''}`}
                onClick={() => setAnalysisTab('tree')}
              >
                Game Tree
              </button>
              <button
                type="button"
                className={`analysis-tab-btn ${analysisTab === 'engine' ? 'analysis-tab-btn-active' : ''}`}
                onClick={() => setAnalysisTab('engine')}
              >
                Engine
              </button>
            </div>
          </div>
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
        </aside>
      </main>

      <footer className="bottombar glass-panel">
        <div className="bottom-controls-row">
          <div className="game-controls">
            <button className="gc-btn" onClick={resetGame}>New Game</button>
            <button
              className={`gc-btn ${autoAnalyze ? 'gc-btn-pause' : 'gc-btn-resume'}`}
              onClick={toggleAnalysis}
              disabled={!isReady || gameMode === 'AIvAI'}
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
          <div className="bottombar-info">
            {isSearching ? `Analyzing depth ${searchDepth}` : `Idle at depth ${searchDepth}`}
            {inCheck ? <span className="check-badge">CHECK</span> : null}
          </div>
          <div className="bottombar-fen">FEN: {currentFen}</div>
        </div>
      </footer>
    </div>
  );
}

export default App;
