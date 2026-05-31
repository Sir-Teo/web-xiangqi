import { useEffect, useRef } from 'react';
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
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!result) return;
    const frame = window.requestAnimationFrame(() => {
      primaryButtonRef.current?.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onReview();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onReview, result]);

  if (!result) return null;
  const cfg = RESULT_CONFIG[result];

  return (
    <div className="game-over-backdrop">
      <div
        className="game-over-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-over-title"
        aria-describedby="game-over-subtitle"
      >
        <div className="game-over-icon" style={{ background: cfg.color }} aria-hidden="true">
          {result === 'red-wins' ? '將' : result === 'black-wins' ? '帥' : '＝'}
        </div>
        <h2 className="game-over-title" id="game-over-title">{cfg.title}</h2>
        <p className="game-over-subtitle" id="game-over-subtitle">{cfg.subtitle}</p>
        <div className="game-over-actions">
          <button
            className="game-over-btn game-over-btn-primary"
            type="button"
            onClick={onNewGame}
            ref={primaryButtonRef}
          >
            New Game
          </button>
          <button
            className="game-over-btn game-over-btn-secondary"
            type="button"
            onClick={onReview}
          >
            Review
          </button>
        </div>
      </div>
    </div>
  );
}
