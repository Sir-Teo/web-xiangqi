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
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!result) return;
    const focusPrimaryAction = () => {
      if (modalRef.current?.contains(document.activeElement)) return;
      primaryButtonRef.current?.focus({ preventScroll: true });
    };
    focusPrimaryAction();
    const frame = window.requestAnimationFrame(focusPrimaryAction);
    const retryTimer = window.setTimeout(focusPrimaryAction, 80);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onReview();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = Array.from(
          modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!active || !modalRef.current?.contains(active)) {
          event.preventDefault();
          first.focus();
          return;
        }

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
          return;
        }

        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retryTimer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onReview, result]);

  if (!result) return null;
  const cfg = RESULT_CONFIG[result];

  return (
    <div className="game-over-backdrop">
      <div
        className="game-over-modal"
        ref={modalRef}
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
