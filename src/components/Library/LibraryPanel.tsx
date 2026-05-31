import { useEffect, useRef, useState } from 'react';
import type { SavedGame } from '../../utils/gameLibrary';
import type { HistoricalGame } from '../../utils/historicalGames';
import { HISTORICAL_GAMES } from '../../utils/historicalGames';
import { exportPgnFromUci, copyToClipboard, downloadTextFile } from '../../utils/gameExport';
import { IconCheck, IconCopy, IconDownload, IconRefresh, IconX } from '../icons';
import './LibraryPanel.css';

interface LibraryPanelProps {
  savedGames: SavedGame[];
  onLoadSavedGame: (game: SavedGame) => void;
  onDeleteSavedGame: (id: string) => boolean;
  onRenameSavedGame: (id: string, label: string) => boolean;
  onLoadHistorical: (game: HistoricalGame) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function resultLabel(result: HistoricalGame['result'] | SavedGame['result']): string {
  if (result === 'red') return 'Red wins';
  if (result === 'black') return 'Black wins';
  if (result === 'ongoing') return 'Ongoing';
  return 'Draw';
}

function savedResultToGameResult(result: SavedGame['result']) {
  if (result === 'red') return 'red-wins';
  if (result === 'black') return 'black-wins';
  if (result === 'draw') return 'draw';
  return null;
}

function makeSavedGamePgnFilename(game: SavedGame) {
  const date = new Date(game.savedAt).toISOString().slice(0, 10);
  const slug = String(game.label || game.opening || 'saved-game')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'saved-game';
  return `web-xiangqi-${date}-${slug}.pgn`;
}

function buildSavedGamePgn(game: SavedGame) {
  return exportPgnFromUci(game.moves, {
    gameMode: game.gameMode,
    opening: game.opening,
    result: savedResultToGameResult(game.result),
    label: game.label,
    startFen: game.startFen,
  });
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const copiedToastTimerRef = useRef<number | null>(null);
  const downloadedToastTimerRef = useRef<number | null>(null);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'reviewed' | 'unreviewed'>('all');
  const [resultFilter, setResultFilter] = useState<'all' | 'red' | 'black' | 'draw' | 'ongoing'>('all');

  useEffect(() => {
    return () => {
      if (copiedToastTimerRef.current !== null) {
        window.clearTimeout(copiedToastTimerRef.current);
      }
      if (downloadedToastTimerRef.current !== null) {
        window.clearTimeout(downloadedToastTimerRef.current);
      }
    };
  }, []);

  const q = search.trim().toLowerCase();

  const filteredHistorical = HISTORICAL_GAMES.filter((g) => {
    if (reviewFilter === 'reviewed') return false;
    if (resultFilter !== 'all' && g.result !== resultFilter) return false;
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
    const isReviewed = Boolean(g.review);
    if (reviewFilter === 'reviewed' && !isReviewed) return false;
    if (reviewFilter === 'unreviewed' && isReviewed) return false;
    if (resultFilter !== 'all' && (g.result ?? 'ongoing') !== resultFilter) return false;
    if (!q) return true;
    return (
      (g.label ?? '').toLowerCase().includes(q) ||
      (g.opening ?? '').toLowerCase().includes(q) ||
      g.gameMode.toLowerCase().includes(q)
    );
  });

  const startEdit = (game: SavedGame) => {
    setPendingDeleteId(null);
    setActionError(null);
    setEditingId(game.id);
    setEditLabel(game.label ?? '');
  };

  const commitEdit = (id: string) => {
    const ok = onRenameSavedGame(id, editLabel.trim());
    if (!ok) {
      setActionError('Could not rename this game. Browser storage may be full or blocked.');
      return;
    }
    setActionError(null);
    setEditingId(null);
  };

  const confirmDelete = (id: string) => {
    const ok = onDeleteSavedGame(id);
    if (!ok) {
      setActionError('Could not delete this game. Browser storage may be full or blocked.');
      return;
    }
    setActionError(null);
    setPendingDeleteId(null);
  };

  const copySavedGamePgn = async (game: SavedGame) => {
    const pgn = buildSavedGamePgn(game);
    const ok = await copyToClipboard(pgn);
    if (!ok) return;

    if (copiedToastTimerRef.current !== null) {
      window.clearTimeout(copiedToastTimerRef.current);
    }
    setCopiedId(game.id);
    copiedToastTimerRef.current = window.setTimeout(() => {
      copiedToastTimerRef.current = null;
      setCopiedId(null);
    }, 1800);
  };

  const downloadSavedGamePgn = (game: SavedGame) => {
    const ok = downloadTextFile(
      makeSavedGamePgnFilename(game),
      buildSavedGamePgn(game),
      'application/x-chess-pgn;charset=utf-8'
    );
    if (!ok) return;

    if (downloadedToastTimerRef.current !== null) {
      window.clearTimeout(downloadedToastTimerRef.current);
    }
    setDownloadedId(game.id);
    downloadedToastTimerRef.current = window.setTimeout(() => {
      downloadedToastTimerRef.current = null;
      setDownloadedId(null);
    }, 1800);
  };

  return (
    <div className="lib-panel">
      <div className="lib-search-wrap">
        <input
          className="lib-search"
          type="search"
          placeholder="Search players, openings, events…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search library"
        />
      </div>
      <div className="lib-filter-row">
        <select
          className="lib-filter-select"
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value as typeof reviewFilter)}
          aria-label="Filter by review status"
        >
          <option value="all">All reviews</option>
          <option value="reviewed">Reviewed</option>
          <option value="unreviewed">Unreviewed</option>
        </select>
        <select
          className="lib-filter-select"
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as typeof resultFilter)}
          aria-label="Filter by result"
        >
          <option value="all">All results</option>
          <option value="red">Red wins</option>
          <option value="black">Black wins</option>
          <option value="draw">Draw</option>
          <option value="ongoing">Ongoing</option>
        </select>
      </div>
      <div className="lib-summary-row">
        <span className="lib-summary-pill">
          <strong>{filteredSaved.length}</strong> saved
        </span>
        <span className="lib-summary-pill">
          <strong>{filteredHistorical.length}</strong> classics
        </span>
        {(q || reviewFilter !== 'all' || resultFilter !== 'all') ? (
          <button
            type="button"
            className="lib-clear-filters"
            onClick={() => {
              setSearch('');
              setReviewFilter('all');
              setResultFilter('all');
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {actionError ? (
        <div className="lib-action-error" role="alert" data-testid="library-action-error">
          {actionError}
        </div>
      ) : null}

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
                    data-testid={`rename-form-saved-${game.id}`}
                  >
                    <input
                      autoFocus
                      className="lib-rename-input"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Game name…"
                    />
                    <button type="submit" className="chip-btn">Save</button>
                    <button type="button" className="chip-btn" onClick={() => { setActionError(null); setEditingId(null); }}>Cancel</button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="lib-game-name-button"
                    onClick={() => startEdit(game)}
                    title="Rename saved game"
                  >
                    {game.label || `Game — ${formatDate(game.savedAt)}`}
                  </button>
                )}
                <div className="lib-card-actions lib-card-actions--inline">
                  <button
                    type="button"
                    className={`chip-btn ${copiedId === game.id ? 'chip-btn-primary' : ''}`}
                    onClick={() => copySavedGamePgn(game)}
                    title="Copy PGN to clipboard"
                    aria-label={copiedId === game.id ? 'Saved game PGN copied' : 'Copy saved game PGN'}
                    data-testid={`copy-pgn-saved-${game.id}`}
                  >
                    {copiedId === game.id ? <><IconCheck /> Copied</> : <><IconCopy /> PGN</>}
                  </button>
                  <button
                    type="button"
                    className={`chip-btn ${downloadedId === game.id ? 'chip-btn-primary' : ''}`}
                    onClick={() => downloadSavedGamePgn(game)}
                    title="Download PGN file"
                    aria-label={downloadedId === game.id ? 'Saved game PGN downloaded' : 'Download saved game PGN'}
                    data-testid={`download-pgn-saved-${game.id}`}
                  >
                    {downloadedId === game.id ? <><IconCheck /> Saved</> : <><IconDownload /> File</>}
                  </button>
                  <button
                    type="button"
                    className="chip-btn chip-btn-primary"
                    onClick={() => onLoadSavedGame(game)}
                    data-testid={`load-saved-${game.id}`}
                  >
                    <IconRefresh /> Load
                  </button>
                  {pendingDeleteId === game.id ? (
                    <>
                      <button
                        type="button"
                        className="chip-btn chip-btn-danger"
                        onClick={() => confirmDelete(game.id)}
                        data-testid={`confirm-delete-saved-${game.id}`}
                        aria-label="Confirm delete saved game"
                      >
                        Delete?
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => { setActionError(null); setPendingDeleteId(null); }}
                        aria-label="Cancel delete saved game"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="chip-btn chip-btn-danger"
                      onClick={() => {
                        setEditingId(null);
                        setActionError(null);
                        setPendingDeleteId(game.id);
                      }}
                      title="Delete"
                      aria-label="Delete saved game"
                      data-testid={`delete-saved-${game.id}`}
                    >
                      <IconX />
                    </button>
                  )}
                </div>
              </div>
              <div className="lib-card-meta">
                <span>{game.gameMode}</span>
                <span className="lib-dot">·</span>
                <span className={`lib-result lib-result--${game.result ?? 'ongoing'}`}>
                  {resultLabel(game.result ?? 'ongoing')}
                </span>
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
              {game.review ? (
                <div className="lib-review-meta">
                  <span className="lib-review-pill">
                    {game.review.summary.accuracy}% accuracy
                  </span>
                  <span className="lib-review-pill lib-review-pill-blunder">
                    {game.review.summary.blunderCount}B
                  </span>
                  <span className="lib-review-pill lib-review-pill-mistake">
                    {game.review.summary.mistakeCount}M
                  </span>
                  <span className="lib-review-pill lib-review-pill-inaccuracy">
                    {game.review.summary.inaccuracyCount}I
                  </span>
                  <span className="lib-review-date">
                    Reviewed {formatDate(game.review.summary.reviewedAt)}
                  </span>
                </div>
              ) : null}
            </div>
          ))
        )}
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
                  data-testid={`load-historical-${game.id}`}
                >
                  <IconRefresh /> Load
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
