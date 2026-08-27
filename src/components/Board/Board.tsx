import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import './Board.css';
import type { BoardState } from '../../utils/xiangqi';
import { BoardArrows } from './BoardArrows';

export type BoardOrientation = 'red' | 'black';

// Module-level helpers — defined once, never re-created on render
function leftFor(file: number, orientation: BoardOrientation) {
    const visualFile = orientation === 'black' ? 8 - file : file;
    return `${(visualFile / 8) * 100}%`;
}
function topFor(rank: number, orientation: BoardOrientation) {
    return orientation === 'black'
        ? `${(rank / 9) * 100}%`
        : `${((9 - rank) / 9) * 100}%`;
}

const RANKS_RED   = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] as const;
const RANKS_BLACK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const FILES_RED   = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
const FILES_BLACK = [8, 7, 6, 5, 4, 3, 2, 1, 0] as const;

const PIECE_LABELS: Record<string, string> = {
    K: "帥", A: "仕", B: "相", N: "傌", R: "俥", C: "炮", P: "兵",
    k: "將", a: "士", b: "象", n: "馬", r: "車", c: "砲", p: "卒"
};

const PIECE_NAMES: Record<string, string> = {
    K: 'red general',
    A: 'red advisor',
    B: 'red elephant',
    N: 'red horse',
    R: 'red chariot',
    C: 'red cannon',
    P: 'red soldier',
    k: 'black general',
    a: 'black advisor',
    b: 'black elephant',
    n: 'black horse',
    r: 'black chariot',
    c: 'black cannon',
    p: 'black soldier',
};

const FILE_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
const BOARD_RANKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const BOARD_FILES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
const TOUCH_MARKER_DELAY_MS = 480;
const TOUCH_MARKER_MOVE_TOLERANCE_PX = 10;

function formatSquareName(file: number, rank: number) {
    return `${FILE_LABELS[file]}${rank}`;
}

function formatSquareAriaLabel(
    file: number,
    rank: number,
    piece: string,
    isSelected: boolean,
    target?: { capture: boolean },
    isHighlighted = false
) {
    const parts = [formatSquareName(file, rank)];
    parts.push(piece ? PIECE_NAMES[piece] ?? piece : 'empty');
    if (isSelected) parts.push('selected');
    // A marker is drawn on the square but was announced nowhere, so a reader
    // could place one with Shift+Enter and never hear that it landed.
    if (isHighlighted) parts.push('highlighted');
    if (target) parts.push(target.capture ? 'legal capture' : 'legal move');
    return parts.join(', ');
}

function squareFromElement(element: Element | null) {
    const squareElement = element?.closest<HTMLElement>('[data-file][data-rank]');
    if (!squareElement) return null;
    return {
        file: parseInt(squareElement.dataset.file!, 10),
        rank: parseInt(squareElement.dataset.rank!, 10),
    };
}

function clampSquare(value: number, max: number) {
    return Math.max(0, Math.min(max, value));
}

interface BoardProps {
    board: BoardState;
    selected: { file: number, rank: number } | null;
    validTargets: { file: number, rank: number, capture: boolean }[];
    onSquareClick: (file: number, rank: number) => void;
    orientation?: BoardOrientation;
    inCheck?: boolean;
    highlights?: Array<{ file: number; rank: number }>;
    onToggleHighlight?: (square: { file: number; rank: number }) => void;
    onAddArrow?: (
        from: { file: number; rank: number },
        to: { file: number; rank: number }
    ) => void;
    arrows?: Array<{
        from: { file: number; rank: number };
        to: { file: number; rank: number };
        color: string;
        kind?: 'last' | 'engine' | 'engine-focus' | 'book' | 'user';
        opacity?: number;
        strokeWidth?: number;
    }>;
}

export const Board = React.memo(function Board({
    board,
    selected,
    validTargets,
    onSquareClick,
    orientation = 'red',
    inCheck = false,
    highlights = [],
    onToggleHighlight,
    onAddArrow,
    arrows = [],
}: BoardProps) {
    const ranks = orientation === 'black' ? RANKS_BLACK : RANKS_RED;
    const files = orientation === 'black' ? FILES_BLACK : FILES_RED;
    const hitboxesRef = useRef<HTMLDivElement | null>(null);
    const markerDragStartRef = useRef<{ file: number; rank: number } | null>(null);
    const touchMarkerTimerRef = useRef<number | null>(null);
    const touchMarkerPointerRef = useRef<{
        pointerId: number;
        file: number;
        rank: number;
        clientX: number;
        clientY: number;
        triggered: boolean;
    } | null>(null);
    const suppressNextClickRef = useRef(false);
    const targetBySquare = useMemo(() => {
        const map = new Map<string, { capture: boolean }>();
        for (const target of validTargets) {
            map.set(`${target.file}:${target.rank}`, { capture: target.capture });
        }
        return map;
    }, [validTargets]);

    const highlightedSquares = useMemo(() => {
        const set = new Set<string>();
        for (const highlight of highlights) set.add(`${highlight.file}:${highlight.rank}`);
        return set;
    }, [highlights]);

    const clearTouchMarkerTimer = useCallback(() => {
        if (touchMarkerTimerRef.current !== null) {
            window.clearTimeout(touchMarkerTimerRef.current);
            touchMarkerTimerRef.current = null;
        }
    }, []);

    const cancelTouchMarker = useCallback(() => {
        clearTouchMarkerTimer();
        touchMarkerPointerRef.current = null;
    }, [clearTouchMarkerTimer]);

    useEffect(() => cancelTouchMarker, [cancelTouchMarker]);

    const handleHitboxClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
        }
        const square = squareFromElement(e.target as Element);
        if (!square) return;
        onSquareClick(square.file, square.rank);
    }, [onSquareClick]);

    const focusSquare = useCallback((file: number, rank: number) => {
        const target = hitboxesRef.current?.querySelector<HTMLButtonElement>(
            `.hitbox[data-file="${file}"][data-rank="${rank}"]`
        );
        target?.focus({ preventScroll: true });
    }, []);

    const handleHitboxKeyDown = useCallback((
        event: React.KeyboardEvent<HTMLButtonElement>,
        file: number,
        rank: number
    ) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            if (event.shiftKey && onToggleHighlight) {
                onToggleHighlight({ file, rank });
                return;
            }
            onSquareClick(file, rank);
            return;
        }

        let nextFile = file;
        let nextRank = rank;

        switch (event.key) {
            case 'ArrowLeft':
                nextFile += orientation === 'black' ? 1 : -1;
                break;
            case 'ArrowRight':
                nextFile += orientation === 'black' ? -1 : 1;
                break;
            case 'ArrowUp':
                nextRank += orientation === 'black' ? -1 : 1;
                break;
            case 'ArrowDown':
                nextRank += orientation === 'black' ? 1 : -1;
                break;
            default:
                return;
        }

        event.preventDefault();
        focusSquare(clampSquare(nextFile, 8), clampSquare(nextRank, 9));
    }, [focusSquare, onSquareClick, onToggleHighlight, orientation]);

    const handleMarkerPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, file: number, rank: number) => {
        if (event.button === 2 && (onToggleHighlight || onAddArrow)) {
            event.preventDefault();
            markerDragStartRef.current = { file, rank };
            return;
        }

        if (event.pointerType === 'mouse' || event.button !== 0 || !onToggleHighlight) return;
        cancelTouchMarker();
        const pointerId = event.pointerId;
        touchMarkerPointerRef.current = {
            pointerId,
            file,
            rank,
            clientX: event.clientX,
            clientY: event.clientY,
            triggered: false,
        };
        touchMarkerTimerRef.current = window.setTimeout(() => {
            const active = touchMarkerPointerRef.current;
            if (!active || active.pointerId !== pointerId) return;
            active.triggered = true;
            suppressNextClickRef.current = true;
            onToggleHighlight({ file: active.file, rank: active.rank });
        }, TOUCH_MARKER_DELAY_MS);
    }, [cancelTouchMarker, onAddArrow, onToggleHighlight]);

    const handleMarkerPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const active = touchMarkerPointerRef.current;
        if (!active || active.pointerId !== event.pointerId || active.triggered) return;
        const moved = Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY);
        if (moved > TOUCH_MARKER_MOVE_TOLERANCE_PX) {
            cancelTouchMarker();
        }
    }, [cancelTouchMarker]);

    const handleMarkerPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>, file: number, rank: number) => {
        if (event.button === 2 && (onToggleHighlight || onAddArrow)) {
            event.preventDefault();
            const start = markerDragStartRef.current;
            markerDragStartRef.current = null;
            if (!start) return;
            const end = squareFromElement(document.elementFromPoint(event.clientX, event.clientY)) ?? { file, rank };
            if (start.file === end.file && start.rank === end.rank) {
                onToggleHighlight?.(end);
                return;
            }
            onAddArrow?.(start, end);
            return;
        }

        const active = touchMarkerPointerRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const triggered = active.triggered;
        cancelTouchMarker();
        if (triggered) {
            event.preventDefault();
        }
    }, [cancelTouchMarker, onAddArrow, onToggleHighlight]);

    const handleMarkerPointerCancel = useCallback(() => {
        markerDragStartRef.current = null;
        cancelTouchMarker();
    }, [cancelTouchMarker]);

    const handleContextMenu = useCallback((event: React.MouseEvent) => {
        if (!onToggleHighlight && !onAddArrow) return;
        event.preventDefault();
    }, [onAddArrow, onToggleHighlight]);
    const squareKeyshortcuts = onToggleHighlight
        ? 'Enter Space Shift+Enter Shift+Space ArrowUp ArrowDown ArrowLeft ArrowRight'
        : 'Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight';

    return (
        <div className="xiangqi-board-container">
            <div className="xiangqi-board" onContextMenu={handleContextMenu}>
                {/* Single SVG for all grid lines + palace diagonals.
                    ViewBox "0 0 8 9" matches piece coordinate system exactly:
                    left=(file/8)*100% ↔ x=file, top=(rank/9)*100% ↔ y=rank-row.
                    vector-effect: non-scaling-stroke keeps lines crisp at any size. */}
                <svg className="board-svg-grid" viewBox="0 0 8 9" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                    {/* 10 horizontal lines (rank rows 0–9) */}
                    {([0,1,2,3,4,5,6,7,8,9] as const).map(y => (
                        <line key={`h${y}`} x1={0} y1={y} x2={8} y2={y} className="grid-line" />
                    ))}
                    {/* Outer vertical lines — full height */}
                    <line x1={0} y1={0} x2={0} y2={9} className="grid-line" />
                    <line x1={8} y1={0} x2={8} y2={9} className="grid-line" />
                    {/* Inner vertical lines — split at river (y 4→5) */}
                    {([1,2,3,4,5,6,7] as const).map(x => (
                        <React.Fragment key={`v${x}`}>
                            <line x1={x} y1={0} x2={x} y2={4} className="grid-line" />
                            <line x1={x} y1={5} x2={x} y2={9} className="grid-line" />
                        </React.Fragment>
                    ))}
                    {/* Palace diagonal lines (board is symmetric; same coords both orientations) */}
                    <line x1={3} y1={0} x2={5} y2={2} className="palace-line" />
                    <line x1={5} y1={0} x2={3} y2={2} className="palace-line" />
                    <line x1={3} y1={7} x2={5} y2={9} className="palace-line" />
                    <line x1={5} y1={7} x2={3} y2={9} className="palace-line" />
                </svg>

                {/* The river dividing the board */}
                <div className="river" aria-hidden="true">
                    <span className="river-text">楚{'\u3000'}河</span>
                    <span className="river-text river-text-flipped">漢{'\u3000'}界</span>
                </div>

                <div className="coords-layer" aria-hidden="true">
                    {BOARD_FILES.map(file => (
                        <React.Fragment key={`coord-file-${file}`}>
                            <span
                                className="coord-label coord-file coord-file-top"
                                style={{ left: leftFor(file, orientation) }}
                            >
                                {FILE_LABELS[file]}
                            </span>
                            <span
                                className="coord-label coord-file coord-file-bottom"
                                style={{ left: leftFor(file, orientation) }}
                            >
                                {FILE_LABELS[file]}
                            </span>
                        </React.Fragment>
                    ))}
                    {BOARD_RANKS.map(rank => (
                        <React.Fragment key={`coord-rank-${rank}`}>
                            <span
                                className="coord-label coord-rank coord-rank-left"
                                style={{ top: topFor(rank, orientation) }}
                            >
                                {rank}
                            </span>
                            <span
                                className="coord-label coord-rank coord-rank-right"
                                style={{ top: topFor(rank, orientation) }}
                            >
                                {rank}
                            </span>
                        </React.Fragment>
                    ))}
                </div>

                {/* Invisible Hitbox Layer for clicking the exact intersections */}
                <div className="hitboxes-layer" onClick={handleHitboxClick} ref={hitboxesRef}>
                    {ranks.map(rank => (
                        files.map(file => {
                            const piece = board[rank][file];
                            const isSelected = selected?.file === file && selected?.rank === rank;
                            const target = targetBySquare.get(`${file}:${rank}`);
                            return (
                                <button
                                    key={`hitbox-${file}-${rank}`}
                                    type="button"
                                    className="hitbox"
                                    style={{ left: leftFor(file, orientation), top: topFor(rank, orientation) }}
                                    data-file={file}
                                    data-rank={rank}
                                    aria-label={formatSquareAriaLabel(file, rank, piece, isSelected, target, highlightedSquares.has(`${file}:${rank}`))}
                                    aria-keyshortcuts={squareKeyshortcuts}
                                    tabIndex={piece || isSelected || target ? 0 : -1}
                                    onKeyDown={(event) => handleHitboxKeyDown(event, file, rank)}
                                    onPointerDown={(event) => handleMarkerPointerDown(event, file, rank)}
                                    onPointerMove={handleMarkerPointerMove}
                                    onPointerUp={(event) => handleMarkerPointerUp(event, file, rank)}
                                    onPointerCancel={handleMarkerPointerCancel}
                                />
                            );
                        })
                    ))}
                </div>

                {inCheck && (
                    <div className="check-overlay">
                        <span className="check-badge">CHECK</span>
                    </div>
                )}

                {/* Arrow overlay */}
                {arrows.length > 0 && (
                    <BoardArrows arrows={arrows} orientation={orientation} />
                )}

                {/* The piece layer */}
                <div className="pieces-layer" aria-hidden="true">
                    {/* User analysis markers */}
                    {highlights.map(highlight => (
                        <div
                            key={`marker-${highlight.file}-${highlight.rank}`}
                            className="marker-highlight"
                            style={{ left: leftFor(highlight.file, orientation), top: topFor(highlight.rank, orientation) }}
                        />
                    ))}

                    {/* Valid Target overlays */}
                    {validTargets.map(target => {
                        if (target.capture) {
                            return (
                                <div
                                    key={`target-${target.file}-${target.rank}`}
                                    className="target-ring"
                                    style={{ left: leftFor(target.file, orientation), top: topFor(target.rank, orientation) }}
                                />
                            );
                        } else {
                            return (
                                <div
                                    key={`target-${target.file}-${target.rank}`}
                                    className="target-dot"
                                    style={{ left: leftFor(target.file, orientation), top: topFor(target.rank, orientation) }}
                                />
                            );
                        }
                    })}

                    {/* Pieces */}
                    {ranks.map(rank => (
                        files.map(file => {
                            const piece = board[rank][file];
                            if (!piece) return null;

                            const isSelected = selected?.file === file && selected?.rank === rank;
                            const isRed = piece === piece.toUpperCase();
                            const colorClass = isRed ? 'red' : 'black';

                            return (
                                <div
                                    key={`piece-${file}-${rank}`}
                                    className={`piece ${colorClass} ${isSelected ? 'selected' : ''}`}
                                    style={{ left: leftFor(file, orientation), top: topFor(rank, orientation) }}
                                >
                                    {PIECE_LABELS[piece] || piece}
                                </div>
                            );
                        })
                    ))}
                </div>
            </div>
        </div>
    );
});

Board.displayName = 'Board';
