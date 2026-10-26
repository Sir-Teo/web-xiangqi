import type { XiangqiNotationStyle } from '../utils/xiangqiNotation';
import { lazy, Suspense, useEffect, useRef } from 'react';
import type { SavedGame } from '../utils/gameLibrary';
import type { PieceStyle } from '../utils/pieceStyle';
import { keepTabWithin } from '../utils/focusTrap';
import { LazyPanelBoundary } from './LazyPanelBoundary';
import './StudyPracticeDialog.css';
import { IconX } from './icons';

const Practice = lazy(() => import('./StudyPractice').then(module => ({ default: module.StudyPractice })));

export function StudyPracticeDialog({ game, pieceStyle, notationStyle, onClose }: { game: SavedGame; pieceStyle: PieceStyle; notationStyle?: XiangqiNotationStyle; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLButtonElement>('header button')?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      keepTabWithin(dialog.current, event);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [onClose]);
  return <>
    <div className="study-practice-backdrop" onClick={onClose} aria-hidden="true" />
    <div className="study-practice-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="study-practice-title" data-testid="study-practice-dialog">
      <header><h2 id="study-practice-title">Practice study</h2>
        <button type="button" aria-label="Close study practice" onClick={onClose}><IconX width={18} height={18} /></button></header>
      <p className="study-practice-study-name">{game.label || game.opening || 'Saved game'}</p>
      <LazyPanelBoundary><Suspense fallback={<p role="status">Loading study practice…</p>}>
        <Practice game={game} pieceStyle={pieceStyle} notationStyle={notationStyle} />
      </Suspense></LazyPanelBoundary>
    </div>
  </>;
}
