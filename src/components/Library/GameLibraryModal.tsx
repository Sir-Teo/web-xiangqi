import { useState } from 'react';
import type { SavedGame } from '../../utils/gameLibrary';
import { IconX, IconRefresh, IconCheck } from '../icons';
import { exportPgnFromUci, copyToClipboard } from '../../utils/gameExport';
import './GameLibraryModal.css';

interface GameLibraryModalProps {
    games: SavedGame[];
    onClose: () => void;
    onLoadGame: (game: SavedGame) => void;
    onDeleteGame: (id: string) => void;
    onRenameGame: (id: string, label: string) => void;
}

function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatMoves(moves: string[]): string {
    return `${moves.length} ${moves.length === 1 ? 'move' : 'moves'}`;
}

export function GameLibraryModal({
    games,
    onClose,
    onLoadGame,
    onDeleteGame,
    onRenameGame,
}: GameLibraryModalProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editLabel, setEditLabel] = useState('');
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const handleCopyPgn = async (game: SavedGame) => {
        const pgn = exportPgnFromUci(game.moves, {
            gameMode: game.gameMode,
            opening: game.opening,
            label: game.label,
            startFen: game.startFen,
        });
        const ok = await copyToClipboard(pgn);
        if (ok) {
            setCopiedId(game.id);
            setTimeout(() => setCopiedId(null), 2000);
        }
    };

    const startEdit = (game: SavedGame) => {
        setEditingId(game.id);
        setEditLabel(game.label ?? '');
    };

    const commitEdit = (id: string) => {
        onRenameGame(id, editLabel.trim());
        setEditingId(null);
    };

    return (
        <>
            <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />
            <div className="settings-body library-modal" role="dialog" aria-modal="true" aria-label="Game Library">
                <div className="settings-header">
                    <h2>Game Library</h2>
                    <button
                        className="settings-close-btn"
                        type="button"
                        onClick={onClose}
                        aria-label="Close library"
                    >
                        <IconX />
                    </button>
                </div>

                {games.length === 0 ? (
                    <div className="library-empty">
                        <p>No saved games yet.</p>
                        <p className="library-hint">Use the <strong>Save Game</strong> button to save the current game.</p>
                    </div>
                ) : (
                    <div className="library-list">
                        {games.map((game) => (
                            <div key={game.id} className="library-item">
                                <div className="library-item-header">
                                    {editingId === game.id ? (
                                        <form
                                            onSubmit={(e) => { e.preventDefault(); commitEdit(game.id); }}
                                            className="library-rename-form"
                                        >
                                            <input
                                                autoFocus
                                                className="library-rename-input"
                                                value={editLabel}
                                                onChange={(e) => setEditLabel(e.target.value)}
                                                placeholder="Game name…"
                                            />
                                            <button type="submit" className="chip-btn">Save</button>
                                            <button type="button" className="chip-btn" onClick={() => setEditingId(null)}>Cancel</button>
                                        </form>
                                    ) : (
                                        <span
                                            className="library-game-name"
                                            onClick={() => startEdit(game)}
                                            title="Click to rename"
                                        >
                                            {game.label || `Game — ${formatDate(game.savedAt)}`}
                                        </span>
                                    )}
                                    <div className="library-item-actions">
                                        <button
                                            type="button"
                                            className="chip-btn"
                                            onClick={() => handleCopyPgn(game)}
                                            title="Copy PGN to clipboard"
                                        >
                                            {copiedId === game.id ? <IconCheck /> : 'PGN'}
                                        </button>
                                        <button
                                            type="button"
                                            className="chip-btn chip-btn-primary"
                                            onClick={() => onLoadGame(game)}
                                            title="Load this game"
                                        >
                                            <IconRefresh /> Load
                                        </button>
                                        {pendingDeleteId === game.id ? (
                                            <>
                                                <button
                                                    type="button"
                                                    className="chip-btn chip-btn-danger"
                                                    onClick={() => { onDeleteGame(game.id); setPendingDeleteId(null); }}
                                                    title="Confirm delete"
                                                    autoFocus
                                                    onBlur={() => setPendingDeleteId(null)}
                                                >
                                                    Confirm?
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                className="chip-btn chip-btn-danger"
                                                onClick={() => setPendingDeleteId(game.id)}
                                                title="Delete"
                                            >
                                                <IconX />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="library-item-meta">
                                    <span>{game.gameMode}</span>
                                    <span>{formatMoves(game.moves)}</span>
                                    {game.opening && <span className="library-opening">{game.opening}</span>}
                                    {typeof game.finalEval === 'number' && (
                                        <span className={`library-eval ${game.finalEval > 0 ? 'positive' : 'negative'}`}>
                                            {game.finalEval > 0 ? '+' : ''}{(game.finalEval / 100).toFixed(2)}
                                        </span>
                                    )}
                                    <span className="library-date">{formatDate(game.savedAt)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}
