import { useEffect } from 'react';
import { IconSkipBack, IconChevronLeft, IconChevronRight, IconSkipForward } from '../icons';

type Props = {
    canGoBack: boolean;
    canGoForward: boolean;
    onFirst: () => void;
    onPrev: () => void;
    onNext: () => void;
    onLast: () => void;
    currentMoveIndex: number;
    totalMoves: number;
    onScrub: (index: number) => void;
};

export function WatchControls({
    canGoBack,
    canGoForward,
    onFirst,
    onPrev,
    onNext,
    onLast,
    currentMoveIndex,
    totalMoves,
    onScrub,
}: Props) {
    // Keyboard shortcuts (← →)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); onFirst(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); onLast(); }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onPrev, onNext, onFirst, onLast]);

    return (
        <div className="watch-controls">
            <div className="wc-nav">
                <button type="button" className="wc-btn" onClick={onFirst} disabled={!canGoBack} title="First position" aria-label="Go to first position">
                    <IconSkipBack />
                </button>
                <button type="button" className="wc-btn" onClick={onPrev} disabled={!canGoBack} title="Previous move (←)" aria-label="Go to previous move">
                    <IconChevronLeft />
                </button>
                <button type="button" className="wc-btn" onClick={onNext} disabled={!canGoForward} title="Next move (→)" aria-label="Go to next move">
                    <IconChevronRight />
                </button>
                <button type="button" className="wc-btn" onClick={onLast} disabled={!canGoForward} title="Last position" aria-label="Go to last position">
                    <IconSkipForward />
                </button>
            </div>
            <div className="wc-timeline">
                <div className="wc-meta">
                    <span>Move</span>
                    <strong>{Math.max(0, currentMoveIndex + 1)} / {totalMoves}</strong>
                </div>
                <input
                    type="range"
                    className="wc-scrubber"
                    min={0}
                    max={Math.max(totalMoves, 1)}
                    value={currentMoveIndex + 1}
                    onChange={(e) => onScrub(Number(e.target.value) - 1)}
                    disabled={totalMoves === 0}
                    aria-label="Jump to move"
                />
            </div>
        </div>
    );
}
