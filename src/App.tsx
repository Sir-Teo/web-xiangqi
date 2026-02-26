import React, { useState, useEffect } from 'react';
import './App.css';
import { Board } from './components/Board/Board';
import { EvalGraph } from './components/Panels/EvalGraph';
import { useEngine } from './hooks/useEngine';
import { useXiangqi } from './hooks/useXiangqi';

export type GameMode = 'PvP' | 'PvAI-Black' | 'PvAI-Red' | 'AIvAI';

function App() {
  const [gameMode, setGameMode] = useState<GameMode>('PvP');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const { board, selected, validTargets, moveHistory, currentFen, inCheck, onSquareClick, resetBoard, sideToMove, applyUciMove } = useXiangqi();

  const { isReady, isSearching, startSearch, stopSearch, outputLines, pvLines, evalScore } = useEngine({
    onBestMove: (uci, score) => {
      applyUciMove(uci, score);
    }
  });

  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [searchDepth, setSearchDepth] = useState(8);

  // Auto-analyze when moves change, if autoAnalyze is on
  useEffect(() => {
    if (isReady && autoAnalyze) {
      if (isSearching) {
        stopSearch();
      }
      setTimeout(() => {
        const uciMoves = moveHistory.map(m => m.uci).join(' ');
        startSearch(`position startpos ${uciMoves ? 'moves ' + uciMoves : ''}`);
        startSearch('go depth 16');
      }, 50);
    }
  }, [moveHistory, isReady, autoAnalyze]);

  // AI Turn orchestrator
  useEffect(() => {
    if (!isReady) return;

    const isAiTurn =
      gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w');

    // If it's an AI turn and we aren't currently searching (and autoAnalyze isn't hogging it)
    if (isAiTurn && !isSearching) {
      if (autoAnalyze) {
        setAutoAnalyze(false); // Disable manual analysis if AI is playing
        stopSearch();
      }

      const timer = setTimeout(() => {
        const uciMoves = moveHistory.map(m => m.uci).join(' ');
        startSearch(`position startpos ${uciMoves ? 'moves ' + uciMoves : ''}`);
        startSearch(`go depth ${searchDepth}`); // Fixed depth search since Wasm time management can be unreliable
      }, 500); // 500ms slight delay before AI starts thinking to feel more natural

      return () => clearTimeout(timer);
    }
  }, [sideToMove, gameMode, isReady, isSearching, moveHistory, autoAnalyze, startSearch, stopSearch, searchDepth]);

  const handleSquareClick = (file: number, rank: number) => {
    // Only allow manual clicks if it's not the AI's turn
    const isAiTurn =
      gameMode === 'AIvAI' ||
      (gameMode === 'PvAI-Black' && sideToMove === 'b') ||
      (gameMode === 'PvAI-Red' && sideToMove === 'w');

    if (!isAiTurn) {
      onSquareClick(file, rank);
    }
  };

  return (
    <div className="app-container">
      {/* Top Navigation Bar */}
      <header className="topbar glass-panel">
        <div className="topbar-left">
          <button
            className="icon-btn"
            onClick={() => setLeftPanelOpen(!leftPanelOpen)}
            aria-label="Toggle Left Panel"
          >
            {/* SVG Hamburger / Pane icon */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
          </button>
          <div className="brand">
            <h1>Xiangqi Analysis</h1>
            <span className="badge">Pro</span>
          </div>
        </div>

        <div className="topbar-center">
          {/* Central engine status / active game info */}
          <div className="engine-status">
            <span className={`status-dot ${isReady ? 'healthy' : ''}`}></span>
            {isReady ? 'Pikafish engine ready' : 'Loading Engine...'}
          </div>
        </div>

        <div className="topbar-right">
          <button className="icon-btn" aria-label="Settings">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button
            className="icon-btn"
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            aria-label="Toggle Right Panel"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="15" y1="3" x2="15" y2="21"></line>
            </svg>
          </button>
        </div>
      </header>

      {/* Main Layout Area */}
      <main className="main-content">

        {/* Left Panel: Controls & Settings */}
        <aside className={`panel left-panel glass-panel ${leftPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header">
            <h2>Controls</h2>
          </div>
          <div className="panel-content">
            <div className="settings-group">
              <label>Game Mode</label>
              <select
                className="premium-select"
                value={gameMode}
                onChange={(e) => {
                  setGameMode(e.target.value as GameMode);
                  resetBoard();
                }}
              >
                <option value="PvP">Local Multiplayer</option>
                <option value="PvAI-Black">Play Red vs AI</option>
                <option value="PvAI-Red">Play Black vs AI</option>
                <option value="AIvAI">Watch AI vs AI</option>
              </select>
            </div>

            <div className="settings-group">
              <label>Engine Action</label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button className="premium-primary-btn" style={{ flex: 1, padding: '8px' }} onClick={resetBoard}>
                  New Game
                </button>
              </div>
            </div>

            <div className="settings-divider" style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '16px 0' }} />

            <div className="settings-group">
              <label>Analysis Mode</label>
              <button
                className={`premium-primary-btn mt-2 ${autoAnalyze ? 'active' : ''}`}
                onClick={() => {
                  if (autoAnalyze) {
                    setAutoAnalyze(false);
                    stopSearch();
                  } else {
                    setAutoAnalyze(true);
                    const uciMoves = moveHistory.map(m => m.uci).join(' ');
                    startSearch(`position startpos ${uciMoves ? 'moves ' + uciMoves : ''}`);
                    startSearch(`go depth ${searchDepth}`);
                  }
                }}
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
              <div className="slider-value">{searchDepth}</div>
            </div>
          </div>
        </aside>

        {/* Center: The Board */}
        <section className="board-area">
          <Board
            board={board}
            selected={selected}
            validTargets={validTargets}
            onSquareClick={handleSquareClick}
          />
        </section>

        {/* Right Panel: Analysis & Eval */}
        <aside className={`panel right-panel glass-panel ${rightPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header">
            <h2>Analysis</h2>
          </div>
          <div className="panel-content">
            <EvalGraph history={moveHistory} currentEval={evalScore} />
            <div className="pv-lines-container mt-4">
              {pvLines.length === 0 ? (
                <div className="text-muted" style={{ fontSize: '0.85rem', padding: '16px' }}>No PV available</div>
              ) : pvLines.map((pv, i) => (
                <div key={i} className="pv-line premium-card">
                  <div className={`pv-score ${pv.score > 0 ? 'positive' : 'negative'}`}>{pv.scoreStr}</div>
                  <div className="pv-moves">
                    <span className="turnNum">Depth {pv.depth}</span>
                    <span className="move" style={{ fontSize: '0.75rem' }}>{pv.moves.slice(0, 5).join(' ')}...</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="engine-output-terminal mt-auto">
              {outputLines.slice(-20).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              {outputLines.length === 0 && <div>Waiting for engine...</div>}
            </div>
          </div>
        </aside>

      </main>

      {/* Bottom Status Bar */}
      <footer className="bottombar glass-panel">
        <div className="bottombar-info">
          Nodes: 0 | NPS: 0 | Depth: 0 {inCheck && <span className="text-warning ml-2 font-bold">· CHECK</span>}
        </div>
        <div className="bottombar-fen">FEN: {currentFen}</div>
      </footer>
    </div>
  );
}

export default App;
