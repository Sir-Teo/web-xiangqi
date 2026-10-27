import { isComposingKey } from '../../utils/keyboard';
import { boardFileLabel } from '../../utils/boardCoordinates';
import type { XiangqiNotationStyle } from '../../utils/xiangqiNotation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './Board.css';
import type { BoardState } from '../../utils/xiangqi';
import { nextPieceIdentityState, type PieceIdentityState } from '../../utils/pieceIdentity';
import { pieceLabel, type PieceStyle } from '../../utils/pieceStyle';
import { BoardArrows } from './BoardArrows';
import type { BoardArrow } from '../../utils/boardArrows';

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
/**
 * How far a mouse must travel before a press becomes a drag rather than a
 * click. Small, because a drag that needs a deliberate shove feels broken, but
 * not zero: a hand resting on a mouse moves a pixel or two while clicking, and
 * treating that as a drag would swallow the click that follows it.
 */
const DRAG_THRESHOLD_PX = 4;

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

/**
 * Where the board's single tab stop sits before anyone has moved focus.
 *
 * The first occupied square in render order, which is where Tab used to land
 * on the way into the board -- so the entry point is unchanged, there is just
 * one of it now.
 */
function firstOccupiedSquare(
    board: BoardState,
    ranks: readonly number[],
    files: readonly number[],
    preferred?: (file: number, rank: number) => boolean
): { file: number; rank: number } | null {
    let first: { file: number; rank: number } | null = null;
    for (const rank of ranks) {
        for (const file of files) {
            if (!board[rank]?.[file]) continue;
            if (!preferred || preferred(file, rank)) return { file, rank };
            first ??= { file, rank };
        }
    }
    return first;
}

interface BoardProps {
    board: BoardState;
    /**
     * The side whose pieces may be dragged, or null when none may be.
     *
     * One prop rather than two, because the board needs the same answer for
     * both halves of the question: dragging is only offered for a piece that
     * could actually move (its owner is to play) and only while the caller is
     * accepting moves at all -- not during the engine's turn, and not after
     * the game has ended. The caller already knows both; the board should not
     * have to infer either.
     */
    draggableSide?: 'w' | 'b' | null;
    /** Characters or WXF letters on the pieces; see `utils/pieceStyle`. */
    pieceStyle?: PieceStyle;
    notationStyle?: XiangqiNotationStyle;
    selected: { file: number, rank: number } | null;
    validTargets: { file: number, rank: number, capture: boolean }[];
    onSquareClick: (file: number, rank: number) => void;
    /** Leave Escape to the caller's dialog when selection cannot be canceled. */
    onCancelSelection?: () => void;
    orientation?: BoardOrientation;
    inCheck?: boolean;
    highlights?: Array<{ file: number; rank: number }>;
    onToggleHighlight?: (square: { file: number; rank: number }) => void;
    onAddArrow?: (
        from: { file: number; rank: number },
        to: { file: number; rank: number }
    ) => void;
    /* The one declaration of this shape lives with the function that builds
       them. It was written out three times -- here, in `BoardArrows`, and in
       `utils/boardArrows` -- with the six-member `kind` union spelled out in
       each. Nothing was unsound about that: adding a seventh kind failed the
       build, checked rather than assumed, with a TS2322 at the call site in
       `App.tsx` comparing two structural types member by member. It just made
       the compiler explain a mismatch between two copies of one idea instead
       of naming the thing that changed. */
    arrows?: BoardArrow[];
}

export const Board = React.memo(function Board({
    board,
    draggableSide = null,
    pieceStyle = 'traditional',
    notationStyle = 'uci',
    selected,
    validTargets,
    onSquareClick,
    onCancelSelection,
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
    /**
     * The board is one composite widget with arrow keys inside it, so it gets
     * one tab stop, not one per square.
     *
     * Every occupied square used to be `tabIndex={0}`, which made 32 of the
     * page's 130 tab stops board squares -- a quarter of the tab order --
     * even though the arrow keys already walk the grid. Reaching the move list
     * from the toolbar meant Tab thirty-two times through pieces.
     *
     * The stop follows focus, so tabbing out and back returns you to the
     * square you were on rather than to the corner.
     */
    const [rovingSquare, setRovingSquare] = useState<{ file: number; rank: number } | null>(null);
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
    /**
     * Dragging a piece, which is the interaction every comparable board has and
     * this one did not.
     *
     * Added strictly beside click-to-move rather than instead of it. The piece
     * is not selected on `pointerdown` -- doing that would make the `click`
     * that follows a plain click a *second* call on the same square, which
     * `onSquareClick` reads as "deselect". Selection happens the moment the
     * pointer crosses the drag threshold, so a press that never moves is still
     * an ordinary click and every existing path is untouched.
     *
     * Mouse only, on purpose. A touch drag needs `touch-action: none` on the
     * squares, which would take the board out of the page's scrolling, and the
     * long press is already spoken for by board markers. Tapping a piece and
     * tapping its destination is the better phone interaction anyway.
     */
    const dragStartRef = useRef<{
        pointerId: number;
        file: number;
        rank: number;
        clientX: number;
        clientY: number;
        started: boolean;
    } | null>(null);
    const [drag, setDrag] = useState<{ file: number; rank: number; dx: number; dy: number } | null>(null);
    /**
     * Identity per piece, so the stylesheet's `left`/`top` transition has a
     * DOM node to carry. Keyed by square, a move unmounts one element and
     * mounts another, and a new element has nothing to transition from — the
     * 300ms slide in `Board.css` had never once fired. See `pieceIdentity.ts`.
     *
     * Called during render rather than in an effect because the key has to be
     * right in the same commit that moves the piece; `nextPieceIdentityState`
     * returns its input unchanged for a board it has already seen, so a
     * repeated render (React's development double-invoke among them) produces
     * the same ids.
     */
    const pieceIdentityRef = useRef<PieceIdentityState | null>(null);
    pieceIdentityRef.current = nextPieceIdentityState(pieceIdentityRef.current, board);
    const pieceIds = pieceIdentityRef.current.ids;
    const movedTo = pieceIdentityRef.current.movedTo;

    /**
     * The pieces to draw, in a stable order.
     *
     * Sorted on the id, which never changes for a piece, so the only thing a
     * move does to this list is change one entry's square. Ranks and files
     * decide where a piece is drawn, not where it sits in the DOM -- every
     * piece is absolutely positioned, and the one case where paint order shows
     * is a cannon crossing its screen, which `.piece.moving` lifts instead.
     */
    const renderedPieces = useMemo(() => {
        const list: Array<{ id: string; file: number; rank: number; piece: string }> = [];
        for (let rank = 0; rank < 10; rank += 1) {
            for (let file = 0; file < 9; file += 1) {
                const piece = board[rank]?.[file];
                if (!piece) continue;
                list.push({ id: pieceIds[rank][file] || `sq-${file}-${rank}`, file, rank, piece });
            }
        }
        list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return list;
    }, [board, pieceIds]);

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

    const canDragFrom = useCallback((file: number, rank: number) => {
        if (!draggableSide) return false;
        const piece = board[rank]?.[file];
        if (!piece) return false;
        return (piece === piece.toUpperCase() ? 'w' : 'b') === draggableSide;
    }, [board, draggableSide]);

    const endDrag = useCallback(() => {
        dragStartRef.current = null;
        setDrag((previous) => (previous ? null : previous));
    }, []);

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

    const handleHitboxFocus = useCallback((file: number, rank: number) => {
        setRovingSquare((previous) => (
            previous?.file === file && previous?.rank === rank ? previous : { file, rank }
        ));
    }, []);

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
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isComposingKey(event.nativeEvent)) return;
        if (event.key === 'Escape' && !event.shiftKey && selected && onCancelSelection) {
            event.preventDefault();
            event.stopPropagation();
            if (dragStartRef.current) {
                endDrag();
                suppressNextClickRef.current = true;
            }
            onCancelSelection();
            return;
        }
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
            case 'Home':
                nextFile = orientation === 'red' ? 0 : 8;
                break;
            case 'End':
                nextFile = orientation === 'red' ? 8 : 0;
                break;
            default:
                return;
        }

        event.preventDefault();
        focusSquare(clampSquare(nextFile, 8), clampSquare(nextRank, 9));
    }, [endDrag, focusSquare, onCancelSelection, onSquareClick, onToggleHighlight, orientation, selected]);

    const handleMarkerPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, file: number, rank: number) => {
        // A cancelled gesture may never produce a click. Its suppression must
        // not swallow the first click of a new gesture.
        suppressNextClickRef.current = false;
        if (event.button === 2 && (onToggleHighlight || onAddArrow)) {
            event.preventDefault();
            markerDragStartRef.current = { file, rank };
            return;
        }

        if (event.pointerType === 'mouse' && event.button === 0 && canDragFrom(file, rank)) {
            // Capture before the first movement: it may already be outside
            // every hitbox, including outside the board entirely.
            event.currentTarget.setPointerCapture(event.pointerId);
            // Armed, not started. Whether this is a drag or a click is not yet
            // known, and it is the pointer's next few pixels that decide.
            dragStartRef.current = {
                pointerId: event.pointerId,
                file,
                rank,
                clientX: event.clientX,
                clientY: event.clientY,
                started: false,
            };
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
    }, [canDragFrom, cancelTouchMarker, onAddArrow, onToggleHighlight]);

    const handleMarkerPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const dragStart = dragStartRef.current;
        if (dragStart && dragStart.pointerId === event.pointerId) {
            if ((event.buttons & 1) === 0) {
                endDrag();
                return;
            }
            const dx = event.clientX - dragStart.clientX;
            const dy = event.clientY - dragStart.clientY;
            if (!dragStart.started) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
                dragStart.started = true;
                // Selecting here is what puts the legal destinations on the
                // board, and it is skipped when this piece is already the
                // selected one, because `onSquareClick` reads a second call on
                // the same square as "deselect".
                if (!(selected?.file === dragStart.file && selected?.rank === dragStart.rank)) {
                    onSquareClick(dragStart.file, dragStart.rank);
                }
            }
            setDrag({ file: dragStart.file, rank: dragStart.rank, dx, dy });
            return;
        }

        const active = touchMarkerPointerRef.current;
        if (!active || active.pointerId !== event.pointerId || active.triggered) return;
        const moved = Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY);
        if (moved > TOUCH_MARKER_MOVE_TOLERANCE_PX) {
            cancelTouchMarker();
        }
    }, [cancelTouchMarker, endDrag, onSquareClick, selected]);

    const handleMarkerPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>, file: number, rank: number) => {
        const dragStart = dragStartRef.current;
        if (dragStart && dragStart.pointerId === event.pointerId) {
            const wasDragging = dragStart.started;
            endDrag();
            if (wasDragging) {
                // The click that follows the drag would land on the square the
                // piece was picked up from and read as "deselect", undoing the
                // selection the drop just used.
                suppressNextClickRef.current = true;
                // The pieces layer takes no pointer events, so the topmost
                // element under the cursor is the destination square itself.
                const dropped = squareFromElement(document.elementFromPoint(event.clientX, event.clientY));
                if (dropped && (dropped.file !== dragStart.file || dropped.rank !== dragStart.rank)) {
                    onSquareClick(dropped.file, dropped.rank);
                }
                // Dropped back where it started, or outside the board: the
                // piece returns and stays selected, which is what a cancelled
                // drag should leave behind.
                return;
            }
        }

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
    }, [cancelTouchMarker, endDrag, onAddArrow, onSquareClick, onToggleHighlight]);

    const handleMarkerPointerCancel = useCallback(() => {
        markerDragStartRef.current = null;
        endDrag();
        cancelTouchMarker();
    }, [cancelTouchMarker, endDrag]);

    useEffect(() => {
        window.addEventListener('blur', handleMarkerPointerCancel);
        return () => window.removeEventListener('blur', handleMarkerPointerCancel);
    }, [handleMarkerPointerCancel]);

    const handleContextMenu = useCallback((event: React.MouseEvent) => {
        if (!onToggleHighlight && !onAddArrow) return;
        event.preventDefault();
    }, [onAddArrow, onToggleHighlight]);
    // Preference order: wherever focus was last left, then the selected piece,
    // then the default landing square. A board with no pieces at all has no tab
    // stop, which is correct -- there is nothing on it to reach.
    // A piece the reader can move, where there is one: reading order starts in
    // the far corner, which is the opponent's, so a keyboard player's first
    // Enter picked up a piece that could not move.
    const fallbackRovingSquare = firstOccupiedSquare(board, ranks, files, draggableSide ? canDragFrom : undefined);
    const tabStopSquare = rovingSquare ?? selected ?? fallbackRovingSquare;

    const squareKeyshortcuts = (onToggleHighlight
        ? 'Enter Space Shift+Enter Shift+Space ArrowUp ArrowDown ArrowLeft ArrowRight Home End'
        : 'Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight Home End') + (onCancelSelection ? ' Escape' : '');

    return (
        <div className="xiangqi-board-container" data-orientation={orientation}>
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
                                {boardFileLabel(file, orientation === 'red' ? 'black' : 'red', notationStyle)}
                            </span>
                            <span
                                className="coord-label coord-file coord-file-bottom"
                                style={{ left: leftFor(file, orientation) }}
                            >
                                {boardFileLabel(file, orientation, notationStyle)}
                            </span>
                        </React.Fragment>
                    ))}
                    {notationStyle === 'uci' && BOARD_RANKS.map(rank => (
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
                <div
                    className="hitboxes-layer"
                    onClick={handleHitboxClick}
                    ref={hitboxesRef}
                    data-dragging={drag ? 'true' : undefined}
                >
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
                                    data-draggable={canDragFrom(file, rank) ? 'true' : undefined}
                                    aria-label={formatSquareAriaLabel(file, rank, piece, isSelected, target, highlightedSquares.has(`${file}:${rank}`))}
                                    aria-keyshortcuts={squareKeyshortcuts}
                                    tabIndex={tabStopSquare?.file === file && tabStopSquare?.rank === rank ? 0 : -1}
                                    onFocus={() => handleHitboxFocus(file, rank)}
                                    onKeyDown={(event) => handleHitboxKeyDown(event, file, rank)}
                                    onPointerDown={(event) => handleMarkerPointerDown(event, file, rank)}
                                    onPointerMove={handleMarkerPointerMove}
                                    onPointerUp={(event) => handleMarkerPointerUp(event, file, rank)}
                                    onPointerCancel={handleMarkerPointerCancel}
                                    onLostPointerCapture={handleMarkerPointerCancel}
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

                    {/* Pieces, in a flat list ordered by identity rather than
                        by square -- both halves are load-bearing, and each was
                        measured failing on its own.

                        Flat, because React scopes keys to the array they sit
                        in: with one sub-array per rank, a piece changing rank
                        crosses between two sibling arrays and is remounted
                        however stable its key is. With that alone, a same-rank
                        move animated and every other move did not.

                        Ordered by identity, because a list ordered by square
                        makes a move an array *reorder*, and React then moves
                        the DOM node as well as restyling it. That was directional
                        -- stepping back animated, stepping forward jumped the
                        whole way on the first frame. An identity order never
                        reorders: a move changes only `left`/`top`, which is
                        exactly what the transition is written against. */}
                    {renderedPieces.map(({ id, file, rank, piece }) => {
                        const isSelected = selected?.file === file && selected?.rank === rank;
                        const isRed = piece === piece.toUpperCase();
                        const colorClass = isRed ? 'red' : 'black';
                        // A cannon captures over a screen, so the one piece that
                        // slides across an occupied square is lifted above it
                        // for the length of the slide.
                        const isMoving = movedTo?.file === file && movedTo?.rank === rank;
                        const isDragging = drag?.file === file && drag?.rank === rank;

                        return (
                            <div
                                key={id}
                                className={`piece ${colorClass} ${pieceStyle === 'letters' ? 'piece-letter' : ''} ${isSelected ? 'selected' : ''} ${isMoving ? 'moving' : ''} ${isDragging ? 'dragging' : ''}`}
                                style={{
                                    left: leftFor(file, orientation),
                                    top: topFor(rank, orientation),
                                    // Offset from where the piece sits rather
                                    // than an absolute position, so it keeps
                                    // the point it was grabbed by instead of
                                    // snapping its centre to the cursor.
                                    ...(isDragging
                                        ? ({ '--drag-x': `${drag.dx}px`, '--drag-y': `${drag.dy}px` } as React.CSSProperties)
                                        : null),
                                }}
                            >
                                {pieceLabel(piece, pieceStyle)}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

Board.displayName = 'Board';
