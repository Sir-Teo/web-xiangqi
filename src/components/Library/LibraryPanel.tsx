import { useState } from 'react';
import type { SavedGame } from '../../utils/gameLibrary';
import type { HistoricalGame } from '../../utils/historicalGames';
import { HISTORICAL_GAMES } from '../../utils/historicalGames';
import { IconRefresh, IconX } from '../icons';
import './LibraryPanel.css';

interface LibraryPanelProps {
  savedGames: SavedGame[];
  onLoadSavedGame: (game: SavedGame) => void;
  onDeleteSavedGame: (id: string) => void;
  onRenameSavedGame: (id: string, label: string) => void;
  onLoadHistorical: (game: HistoricalGame) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function resultLabel(result: HistoricalGame['result']): string {
  if (result === 'red') return 'Red wins';
  if (result === 'black') return 'Black wins';
  return 'Draw';
}

export function LibraryPanel({
  savedGames,
  onLoadSavedGame,
  onDeleteSavedGame,
  onRenameSavedGame,
  onLoadHistorical,
}: LibraryPanelProps) {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const q = search.trim().toLowerCase();

  const filteredHistorical = HISTORICAL_GAMES.filter((g) => {
    if (!q) return true;
    return (
      g.redPlayer.toLowerCase().includes(q) ||
      g.blackPlayer.toLowerCase().includes(q) ||
      g.event.toLowerCase().includes(q) ||
      g.date.includes(q) ||
      (g.opening ?? '').toLowerCase().includes(q)
    );
  });

  const filteredSaved = savedGames.filter((g) => {
    if (!q) return true;
    return (
      (g.label ?? '').toLowerCase().includes(q) ||
      (g.opening ?? '').toLowerCase().includes(q) ||
      g.gameMode.toLowerCase().includes(q)
    );
  });

  const startEdit = (game: SavedGame) => {
    setEditingId(game.id);
    setEditLabel(game.label ?? '');
  };

  const commitEdit = (id: string) => {
    onRenameSavedGame(id, editLabel.trim());
    setEditingId(null);
  };

  return (
    <div className="lib-panel">
      <div className="lib-search-wrap">
        <input
          className="lib-search"
          type="search"
          placeholder="Search players, events…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search library"
        />
      </div>

      {/* ── Classic Games ── */}
      <div className="lib-section-header">Classic Games</div>
      <div className="lib-list">
        {filteredHistorical.length === 0 ? (
          <p className="lib-empty">No games match your search.</p>
        ) : (
          filteredHistorical.map((game) => (
            <div key={game.id} className="lib-card">
              <div className="lib-card-title">
                <span className="lib-matchup">
                  {game.redPlayer} <span className="lib-vs">vs</span> {game.blackPlayer}
                </span>
                <span className={`lib-result lib-result--${game.result}`}>
                  {resultLabel(game.result)}
                </span>
              </div>
              <div className="lib-card-meta">
                <span>{game.event}</span>
                <span className="lib-dot">·</span>
                <span>{game.date}</span>
                <span className="lib-dot">·</span>
                <span>{game.moves.length} moves</span>
                {game.opening && (
                  <>
                    <span className="lib-dot">·</span>
                    <span className="lib-opening">{game.opening}</span>
                  </>
                )}
              </div>
              <div className="lib-card-actions">
                <button
                  type="button"
                  className="chip-btn chip-btn-primary"
                  onClick={() => onLoadHistorical(game)}
                >
                  <IconRefresh /> Load
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── My Games ── */}
      <div className="lib-section-header">My Games</div>
      <div className="lib-list">
        {filteredSaved.length === 0 ? (
          <p className="lib-empty">
            {savedGames.length === 0
              ? 'No saved games yet. Use the Save button to save the current game.'
              : 'No games match your search.'}
          </p>
        ) : (
          filteredSaved.map((game) => (
            <div key={game.id} className="lib-card">
              <div className="lib-card-title">
                {editingId === game.id ? (
                  <form
                    className="lib-rename-form"
                    onSubmit={(e) => { e.preventDefault(); commitEdit(game.id); }}
                  >
                    <input
                      autoFocus
                      className="lib-rename-input"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Game name…"
                    />
                    <button type="submit" className="chip-btn">Save</button>
                    <button type="button" className="chip-btn" onClick={() => setEditingId(null)}>Cancel</button>
                  </form>
                ) : (
                  <span
                    className="lib-game-name"
                    onClick={() => startEdit(game)}
                    title="Click to rename"
                  >
                    {game.label || `Game — ${formatDate(game.savedAt)}`}
                  </span>
                )}
                <div className="lib-card-actions lib-card-actions--inline">
                  <button
                    type="button"
                    className="chip-btn chip-btn-primary"
                    onClick={() => onLoadSavedGame(game)}
                  >
                    <IconRefresh /> Load
                  </button>
                  <button
                    type="button"
                    className="chip-btn chip-btn-danger"
                    onClick={() => onDeleteSavedGame(game.id)}
                    title="Delete"
                  >
                    <IconX />
                  </button>
                </div>
              </div>
              <div className="lib-card-meta">
                <span>{game.gameMode}</span>
                <span className="lib-dot">·</span>
                <span>{game.moves.length} moves</span>
                {game.opening && (
                  <>
                    <span className="lib-dot">·</span>
                    <span className="lib-opening">{game.opening}</span>
                  </>
                )}
                {typeof game.finalEval === 'number' && (
                  <>
                    <span className="lib-dot">·</span>
                    <span className={`lib-eval ${game.finalEval > 0 ? 'lib-eval--pos' : 'lib-eval--neg'}`}>
                      {game.finalEval > 0 ? '+' : ''}{(game.finalEval / 100).toFixed(2)}
                    </span>
                  </>
                )}
                <span className="lib-date">{formatDate(game.savedAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
