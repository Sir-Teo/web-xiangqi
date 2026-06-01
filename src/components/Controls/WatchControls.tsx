import { memo, useEffect } from 'react';
import type { GameMode } from '../../App';
import {
    IconSkipBack, IconChevronLeft, IconChevronRight, IconSkipForward,
    IconPlay, IconPause, IconStepForward
} from '../icons';

export type AiSpeed = 'slow' | 'normal' | 'fast' | 'step';

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
    shortcutsEnabled?: boolean;
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
    shortcutsEnabled = true,
}: Props) {
    const aiActive = gameMode !== 'PvP';
    const stepMode = aiSpeed === 'step';
    const totalMoveCount = Math.max(0, totalMoves);
    const currentPly = Math.max(0, Math.min(currentMoveIndex + 1, totalMoveCount));
    const scrubberValue = currentPly;
    const scrubberMax = Math.max(totalMoveCount, 1);
    const moveCountNoun = totalMoveCount === 1 ? 'move' : 'moves';
    const scrubberValueText = totalMoveCount === 0
        ? 'No moves'
        : currentPly <= 0
            ? `Start position, 0 of ${totalMoveCount} ${moveCountNoun}`
            : `Move ${currentPly} of ${totalMoveCount} ${moveCountNoun}`;
    const timelineText = totalMoveCount === 0
        ? 'No moves'
        : currentPly <= 0
            ? `Start / ${totalMoveCount}`
            : `${currentPly} / ${totalMoveCount}`;

    // Keyboard shortcuts
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!shortcutsEnabled) return;
            if (e.defaultPrevented) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const target = e.target instanceof HTMLElement ? e.target : null;
            const tag = target?.tagName;
            if (
                tag === 'INPUT' ||
                tag === 'SELECT' ||
                tag === 'TEXTAREA' ||
                target?.isContentEditable ||
                target?.closest('[role="dialog"]')
            ) {
                return;
            }
            if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); onFirst(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); onLast(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onPrev, onNext, onFirst, onLast, shortcutsEnabled]);

    return (
        <div className="watch-controls">
            {/* ── Navigation ── */}
            <div className="wc-nav" role="group" aria-label="Move navigation">
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
                <div className="wc-play" role="group" aria-label="AI playback controls">
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
                <div className="wc-speed" role="group" aria-labelledby="watch-speed-label">
                    <span className="wc-speed-label" id="watch-speed-label">Speed</span>
                    {SPEEDS.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            className={`wc-speed-pill ${aiSpeed === id ? 'wc-speed-active' : ''}`}
                            onClick={() => onSpeedChange(id)}
                            aria-label={`Set speed to ${label}`}
                            aria-pressed={aiSpeed === id}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Paused indicator ── */}
            {paused && aiActive && (
                <span className="wc-paused-label">
                    <IconPause /> Paused
                </span>
            )}

            {/* ── Move scrubber ── */}
            <div className="wc-timeline">
                <div className="wc-meta">
                    <span>Move</span>
                    <strong aria-live="polite">{timelineText}</strong>
                </div>
                <input
                    type="range"
                    className="wc-scrubber"
                    min={0}
                    max={scrubberMax}
                    value={scrubberValue}
                    onChange={(e) => onScrub(Math.max(0, Number(e.target.value)) - 1)}
                    disabled={totalMoveCount === 0}
                    aria-label={`Jump to move: ${scrubberValueText}`}
                    aria-valuetext={scrubberValueText}
                />
            </div>
        </div>
    );
});

WatchControls.displayName = 'WatchControls';
