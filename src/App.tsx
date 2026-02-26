import React, { useState } from 'react';
import './App.css';
import { Board } from './components/Board/Board';
import { useEngine } from './hooks/useEngine';

function App() {
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const { isReady, isSearching, startSearch, stopSearch, outputLines, pvLines } = useEngine();

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
              <label>Search Mode</label>
              <select className="premium-select">
                <option>Depth</option>
                <option>Time per move</option>
                <option>Infinite</option>
              </select>
            </div>
            <div className="settings-group">
              <label>Search Depth (Plys)</label>
              <input type="range" min="1" max="30" defaultValue="16" className="premium-slider" />
              <div className="slider-value">16</div>
            </div>
            <div className="settings-group">
              <label>MultiPV Lines</label>
              <select className="premium-select">
                <option>1 Line</option>
                <option>3 Lines</option>
                <option>5 Lines</option>
              </select>
            </div>

            <button
              className="premium-primary-btn mt-4"
              onClick={() => {
                if (isSearching) {
                  stopSearch();
                } else {
                  // Basic sequence to start searching from startpos
                  startSearch('position startpos');
                  startSearch('go depth 16');
                }
              }}
              disabled={!isReady}
            >
              {isSearching ? 'Stop Analysis' : 'Start Analysis'}
            </button>
          </div>
        </aside>

        {/* Center: The Board */}
        <section className="board-area">
          <Board />
        </section>

        {/* Right Panel: Analysis & Eval */}
        <aside className={`panel right-panel glass-panel ${rightPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header">
            <h2>Analysis</h2>
          </div>
          <div className="panel-content">
            <div className="eval-graph-placeholder">
              <span>Evaluation Graph</span>
            </div>
            <div className="pv-lines-container">
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
        <div className="bottombar-info">Nodes: 0 | NPS: 0 | Depth: 0</div>
        <div className="bottombar-fen">FEN: rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w</div>
      </footer>
    </div>
  );
}

export default App;
