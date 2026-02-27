import { useEffect } from 'react';
import { IconSkipBack, IconChevronLeft, IconChevronRight, IconSkipForward } from '../icons';

type Props = {
    canGoBack: boolean;
    canGoForward: boolean;
    onFirst: () => void;
    onPrev: () => void;
    onNext: () => void;
    onLast: () => void;
    canPrevVariation?: boolean;
    canNextVariation?: boolean;
    onPrevVariation?: () => void;
    onNextVariation?: () => void;
    variationLabel?: string;
    isAutoPlaying: boolean;
    onToggleAutoPlay: () => void;
    playbackSpeedMs: number;
    onPlaybackSpeedChange: (speedMs: number) => void;
    currentMoveIndex: number;
    totalMoves: number;
    onScrub: (index: number) => void;
};

const PLAYBACK_SPEEDS = [
    { label: '0.5x', ms: 1200 },
    { label: '1x', ms: 700 },
    { label: '2x', ms: 350 },
] as const;

export function WatchControls({
    canGoBack,
    canGoForward,
    onFirst,
    onPrev,
    onNext,
    onLast,
    canPrevVariation = false,
    canNextVariation = false,
    onPrevVariation,
    onNextVariation,
    variationLabel = '',
    isAutoPlaying,
    onToggleAutoPlay,
    playbackSpeedMs,
    onPlaybackSpeedChange,
    currentMoveIndex,
    totalMoves,
    onScrub,
}: Props) {
    // Keyboard shortcuts for fast game review.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            if (e.altKey && e.key === 'ArrowLeft' && onPrevVariation) {
                e.preventDefault();
                onPrevVariation();
                return;
            }
            if (e.altKey && e.key === 'ArrowRight' && onNextVariation) {
                e.preventDefault();
                onNextVariation();
                return;
            }
            if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); onFirst(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); onLast(); }
            if (e.key === ' ') { e.preventDefault(); onToggleAutoPlay(); }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onPrev, onNext, onFirst, onLast, onToggleAutoPlay, onPrevVariation, onNextVariation]);

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
            <div className="wc-play">
                <button
                    type="button"
                    className={`wc-btn ${isAutoPlaying ? 'wc-btn-pause' : 'wc-btn-resume'}`}
                    onClick={onToggleAutoPlay}
                    disabled={totalMoves === 0}
                    title={isAutoPlaying ? 'Pause review (Space)' : 'Play review (Space)'}
                    aria-label={isAutoPlaying ? 'Pause move playback' : 'Start move playback'}
                >
                    {isAutoPlaying ? 'Pause' : 'Play'}
                </button>
            </div>
            <div className="wc-speed">
                <span className="wc-speed-label">Speed</span>
                {PLAYBACK_SPEEDS.map((speed) => (
                    <button
                        key={speed.label}
                        type="button"
                        className={`wc-speed-pill ${playbackSpeedMs === speed.ms ? 'wc-speed-active' : ''}`}
                        onClick={() => onPlaybackSpeedChange(speed.ms)}
                        aria-label={`Set playback speed to ${speed.label}`}
                    >
                        {speed.label}
                    </button>
                ))}
            </div>
            <div className="wc-variation">
                <button
                    type="button"
                    className="wc-btn"
                    disabled={!canPrevVariation}
                    onClick={onPrevVariation}
                    title="Previous variation (Alt+Left)"
                    aria-label="Go to previous variation"
                >
                    Var-
                </button>
                <span className="wc-variation-label">{variationLabel}</span>
                <button
                    type="button"
                    className="wc-btn"
                    disabled={!canNextVariation}
                    onClick={onNextVariation}
                    title="Next variation (Alt+Right)"
                    aria-label="Go to next variation"
                >
                    Var+
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
