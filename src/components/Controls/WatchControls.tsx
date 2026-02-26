import React, { useEffect, useCallback } from 'react';
import { IconSkipBack, IconChevronLeft, IconChevronRight, IconSkipForward } from '../icons';

type Props = {
    canGoBack: boolean;
    canGoForward: boolean;
    onFirst: () => void;
    onPrev: () => void;
    onNext: () => void;
    onLast: () => void;
};

export function WatchControls({
    canGoBack,
    canGoForward,
    onFirst,
    onPrev,
    onNext,
    onLast,
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
        </div>
    );
}
