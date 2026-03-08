import type { GameResult } from '../hooks/useXiangqi';

interface GameOverModalProps {
  result: GameResult;
  onNewGame: () => void;
  onReview: () => void;
}

const RESULT_CONFIG: Record<NonNullable<GameResult>, { title: string; subtitle: string; color: string }> = {
  'red-wins':   { title: 'Red Wins',   subtitle: 'Checkmate',    color: '#c0392b' },
  'black-wins': { title: 'Black Wins', subtitle: 'Checkmate',    color: '#1a1a2e' },
  'draw':       { title: 'Draw',       subtitle: 'By Repetition', color: '#6b7280' },
};

export function GameOverModal({ result, onNewGame, onReview }: GameOverModalProps) {
  if (!result) return null;
  const cfg = RESULT_CONFIG[result];

  return (
    <div className="game-over-backdrop" onClick={onReview}>
      <div className="game-over-modal" onClick={e => e.stopPropagation()}>
        <div className="game-over-icon" style={{ background: cfg.color }}>
          {result === 'red-wins' ? '將' : result === 'black-wins' ? '帥' : '＝'}
        </div>
        <h2 className="game-over-title">{cfg.title}</h2>
        <p className="game-over-subtitle">{cfg.subtitle}</p>
        <div className="game-over-actions">
          <button className="game-over-btn game-over-btn-primary" onClick={onNewGame}>
            New Game
          </button>
          <button className="game-over-btn game-over-btn-secondary" onClick={onReview}>
            Review
          </button>
        </div>
      </div>
    </div>
  );
}
