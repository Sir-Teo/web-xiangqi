import { memo, useEffect } from 'react';
import type { GameMode } from '../../App';
import {
    IconSkipBack, IconChevronLeft, IconChevronRight, IconSkipForward,
    IconPlay, IconPause, IconStepForward
} from '../icons';

export type AiSpeed = 'slow' | 'normal' | 'fast' | 'step';

export const AI_SPEED_MS: Record<Exclude<AiSpeed, 'step'>, number> = {
    slow: 1500,
    normal: 800,
    fast: 150,
};

const SPEEDS: { id: AiSpeed; label: string }[] = [
    { id: 'slow', label: 'Slow' },
    { id: 'normal', label: 'Normal' },
    { id: 'fast', label: 'Fast' },
    { id: 'step', label: 'Step' },
];

type Props = {
    // Navigation
    canGoBack: boolean;
    canGoForward: boolean;
    onFirst: () => void;
    onPrev: () => void;
    onNext: () => void;
    onLast: () => void;
    // AI play control
    gameMode: GameMode;
    paused: boolean;
    onPause: () => void;
    onResume: () => void;
    onStep: () => void;
    // Speed
    aiSpeed: AiSpeed;
    onSpeedChange: (s: AiSpeed) => void;
    // Move scrubber
    currentMoveIndex: number;
    totalMoves: number;
    onScrub: (index: number) => void;
};

export const WatchControls = memo(function WatchControls({
    canGoBack,
    canGoForward,
    onFirst,
    onPrev,
    onNext,
    onLast,
    gameMode,
    paused,
    onPause,
    onResume,
    onStep,
    aiSpeed,
    onSpeedChange,
    currentMoveIndex,
    totalMoves,
    onScrub,
}: Props) {
    const aiActive = gameMode !== 'PvP';
    const stepMode = aiSpeed === 'step';

    // Keyboard shortcuts
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented) return;
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); onFirst(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); onLast(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onPrev, onNext, onFirst, onLast]);

    return (
        <div className="watch-controls">
            {/* ── Navigation ── */}
            <div className="wc-nav">
                <button
                    type="button"
                    className="wc-btn"
                    onClick={onFirst}
                    disabled={!canGoBack}
                    title="First position (↑)"
                    aria-label="Go to first position"
                >
                    <IconSkipBack />
                </button>
                <button
                    type="button"
                    className="wc-btn"
                    onClick={onPrev}
                    disabled={!canGoBack}
                    title="Previous move (←)"
                    aria-label="Go to previous move"
                >
                    <IconChevronLeft />
                </button>
                <button
                    type="button"
                    className="wc-btn"
                    onClick={onNext}
                    disabled={!canGoForward}
                    title="Next move (→)"
                    aria-label="Go to next move"
                >
                    <IconChevronRight />
                </button>
                <button
                    type="button"
                    className="wc-btn"
                    onClick={onLast}
                    disabled={!canGoForward}
                    title="Last position (↓)"
                    aria-label="Go to last position"
                >
                    <IconSkipForward />
                </button>
            </div>

            {/* ── Play / Pause / Step (AI modes only) ── */}
            {aiActive && (
                <div className="wc-play">
                    {stepMode && paused ? (
                        <button
                            type="button"
                            className="wc-btn wc-btn-step"
                            onClick={onStep}
                            title="Advance one AI move"
                            aria-label="Advance one AI move"
                        >
                            <IconStepForward /> Step
                        </button>
                    ) : paused ? (
                        <button
                            type="button"
                            className="wc-btn wc-btn-resume"
                            onClick={onResume}
                            title="Resume AI"
                            aria-label="Resume AI game"
                        >
                            <IconPlay /> Resume
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="wc-btn wc-btn-pause"
                            onClick={onPause}
                            title="Pause & analyze"
                            aria-label="Pause AI game"
                        >
                            <IconPause /> Pause
                        </button>
                    )}
                </div>
            )}

            {/* ── Speed selector (AI modes only) ── */}
            {aiActive && (
                <div className="wc-speed">
                    <span className="wc-speed-label">Speed</span>
                    {SPEEDS.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            className={`wc-speed-pill ${aiSpeed === id ? 'wc-speed-active' : ''}`}
                            onClick={() => onSpeedChange(id)}
                            aria-label={`Set speed to ${label}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Paused indicator ── */}
            {paused && aiActive && (
                <span className="wc-paused-label">
                    <IconPause /> Analyzing
                </span>
            )}

            {/* ── Move scrubber ── */}
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
});

WatchControls.displayName = 'WatchControls';
