import { isComposingKey } from '../../utils/keyboard';
import { editorHistory } from '../../utils/editorHistory';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useReducer } from 'react';
import './Board.css';
import './BoardEditor.css';
import { START_FEN, parseFenBoard, type BoardState, type Side } from '../../utils/xiangqi';
import { describeFenProblem, describeSetupProblem, emptyBoard, setupFen } from '../../utils/positionSetup';
import { copyToClipboard } from '../../utils/gameExport';
import { pieceLabel, type PieceStyle } from '../../utils/pieceStyle';
import { IconX } from '../icons';
import { keepTabWithin } from '../../utils/focusTrap';

export type EditorBrush = string | 'erase';

const RED_PIECES = ['K', 'A', 'B', 'N', 'R', 'C', 'P'] as const;
const BLACK_PIECES = ['k', 'a', 'b', 'n', 'r', 'c', 'p'] as const;
const NAMES: Record<string, string> = {
    K: 'Red general', A: 'Red advisor', B: 'Red elephant', N: 'Red horse', R: 'Red chariot', C: 'Red cannon', P: 'Red soldier',
    k: 'Black general', a: 'Black advisor', b: 'Black elephant', n: 'Black horse', r: 'Black chariot', c: 'Black cannon', p: 'Black soldier',
};
const FILE_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
const RANKS_TOP_DOWN = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] as const;
const FILES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

function leftFor(file: number) {
    return `${(file / 8) * 100}%`;
}
function topFor(rank: number) {
    return `${((9 - rank) / 9) * 100}%`;
}

export interface BoardEditorProps {
    initialBoard: BoardState;
    initialSide: Side;
    /** The same set the board draws, so the palette reads like the board. */
    pieceStyle?: PieceStyle;
    onCancel: () => void;
    onApply: (fen: string) => void;
}

/**
 * Set a position up by hand: the endgame from a book, a composed problem, the
 * position a friend described over the phone.
 *
 * Pick a piece from the palette and click the points to put it down; the same
 * piece on a point already holding it takes it off, and the erase brush clears
 * whatever is there. The rules of the set are checked as you go and the
 * problem is named beside the board, so Done is only offered for a position a
 * game could reach. Red is always drawn at the bottom here: the editor is a
 * diagram, and diagrams are printed one way.
 */
export function BoardEditor({ initialBoard, initialSide, pieceStyle = 'traditional', onCancel, onApply }: BoardEditorProps) {
    const [history, dispatch] = useReducer(editorHistory, { past: [], present: { board: initialBoard, side: initialSide }, future: [] });
    const { board, side } = history.present;
    const setBoard = useCallback((value: BoardState | ((board: BoardState) => BoardState)) => {
        dispatch({ type: 'edit', update: p => ({ ...p, board: typeof value === 'function' ? value(p.board) : value }) });
    }, []);
    const setSide = useCallback((value: Side) => dispatch({ type: 'edit', update: p => ({ ...p, side: value }) }), []);
    const letterClass = pieceStyle === 'letters' ? ' piece-letter' : '';
    const [brush, setBrush] = useState<EditorBrush>('K');
    /**
     * The FEN box, which the editor used to print and nothing more.
     *
     * A position is set up here for one of two reasons: it came from somewhere
     * -- a book diagram, a puzzle, a message -- or it is going somewhere. The
     * text was selectable in theory and a dead end in practice: no way to put
     * one in, and taking one out meant pressing Done first and finding the
     * board's own copy button. The two directions are the same field, so it is
     * the same field here.
     *
     * `null` means "show the board". A draft is what the reader typed, kept
     * until they load it or touch the board, because a half-typed FEN must not
     * be overwritten by the board on every keystroke and must not be mistaken
     * for the position either.
     */
    const [fenDraft, setFenDraft] = useState<string | null>(null);
    const [fenNotice, setFenNotice] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const copiedTimerRef = useRef<number | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const [focusedSquare, setFocusedSquare] = useState({ file: 0, rank: 9 });
    const keyboardHelpId = useId();

    const problem = useMemo(() => describeSetupProblem(board, side), [board, side]);
    const fen = useMemo(() => setupFen(board, side), [board, side]);

    useEffect(() => () => {
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    }, []);

    /** Any edit to the board means the field is describing the board again. */
    const followBoard = useCallback(() => {
        setFenDraft(null);
        setFenNotice(null);
    }, []);

    const loadFenDraft = useCallback(() => {
        const text = (fenDraft ?? fen).trim().replace(/\s+/g, ' ');
        const parts = text.split(' ');
        let next: BoardState;
        try {
            next = parseFenBoard(parts[0]);
        } catch {
            setFenNotice('That is not a position this board can read.');
            return;
        }
        // The side is taken when the FEN names one and left alone when it does
        // not, so a bare placement row loads without silently flipping the turn.
        const nextSide: Side = parts[1] === 'b' ? 'b' : parts[1] === 'w' ? 'w' : side;
        dispatch({ type: 'edit', update: () => ({ board: next, side: nextSide }) });
        setFenDraft(null);
        // Not an error: the editor exists to fix a position, and refusing to
        // show one because it is not legal yet would defeat that. The problem
        // line below says what is wrong with it, as it does for any other edit.
        setFenNotice(null);
    }, [fen, fenDraft, side]);

    const applyPosition = () => {
        const draft = fenDraft?.trim().replace(/\s+/g, ' ');
        const candidate = draft === undefined ? fen : draft.includes(' ') ? draft : `${draft} ${side} - - 0 1`;
        const issue = describeFenProblem(candidate);
        if (issue) { setFenNotice(issue); return; }
        onApply(candidate);
    };

    const copyFen = useCallback(async () => {
        const ok = await copyToClipboard(fen);
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
        setCopied(ok);
        setFenNotice(ok ? null : 'The clipboard refused it. Select the text and copy it by hand.');
        if (!ok) return;
        copiedTimerRef.current = window.setTimeout(() => {
            copiedTimerRef.current = null;
            setCopied(false);
        }, 1800);
    }, [fen]);

    /**
     * `App` inerts every shell child that holds no open dialog, and inerting an
     * ancestor of the focused element blurs it to `document.body`. So by the
     * time this runs, `document.activeElement` may be `body` rather than the
     * control that opened us -- and focusing `body` on close is how the opener
     * got lost. Record it, but never hand focus to `body`: the effect in
     * `App.tsx` that removed `inert` has already put focus back where it was.
     */
    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        dialogRef.current?.querySelector<HTMLElement>('[data-editor-first]')?.focus({ preventScroll: true });
        return () => {
            if (!previouslyFocused || previouslyFocused === document.body) return;
            if (previouslyFocused.isConnected) previouslyFocused.focus({ preventScroll: true });
        };
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isComposingKey(event)) return;
            keepTabWithin(dialogRef.current, event);
            const target = event.target;
            if ((event.metaKey || event.ctrlKey) && !event.altKey && !(target instanceof HTMLElement && (target.matches('input, textarea') || target.isContentEditable))) {
                const key = event.key.toLowerCase();
                if (key === 'z' || key === 'y') {
                    event.preventDefault(); event.stopPropagation(); followBoard();
                    dispatch({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' });
                    return;
                }
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [onCancel, followBoard]);

    const paint = useCallback((file: number, rank: number) => {
        followBoard();
        setBoard((previous) => {
            const next = previous.map((row) => row.slice());
            const current = next[rank][file];
            next[rank][file] = brush === 'erase' || current === brush ? '' : brush;
            return next;
        });
    }, [brush, followBoard, setBoard]);

    const handleBoardClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const target = (event.target as Element).closest<HTMLElement>('[data-file][data-rank]');
        if (!target) return;
        paint(Number(target.dataset.file), Number(target.dataset.rank));
    }, [paint]);

    const handleSquareKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, file: number, rank: number) => {
        if (event.altKey || event.metaKey || (event.ctrlKey && event.key !== 'Home' && event.key !== 'End')) return;
        let nextFile = file;
        let nextRank = rank;
        switch (event.key) {
            case 'ArrowLeft': nextFile--; break;
            case 'ArrowRight': nextFile++; break;
            case 'ArrowUp': nextRank++; break;
            case 'ArrowDown': nextRank--; break;
            case 'Home': nextFile = 0; if (event.ctrlKey) nextRank = 9; break;
            case 'End': nextFile = 8; if (event.ctrlKey) nextRank = 0; break;
            default: return; // Native Enter/Space clicks apply the brush once.
        }
        event.preventDefault();
        event.stopPropagation();
        dialogRef.current?.querySelector<HTMLButtonElement>(
            `.hitbox[data-file="${Math.max(0, Math.min(8, nextFile))}"][data-rank="${Math.max(0, Math.min(9, nextRank))}"]`
        )?.focus();
    };

    const brushButton = (piece: string) => (
        <button
            key={piece}
            type="button"
            className={`board-editor-brush ${piece === piece.toUpperCase() ? 'board-editor-brush-red' : ''}${letterClass}`}
            onClick={() => setBrush(piece)}
            aria-pressed={brush === piece}
            aria-label={`${NAMES[piece]} brush`}
            title={NAMES[piece]}
            data-testid={`editor-brush-${piece}`}
        >
            {pieceLabel(piece, pieceStyle)}
        </button>
    );

    return (
        <>
            <div className="board-editor-backdrop" onClick={onCancel} aria-hidden="true" />
            <div
                className="board-editor"
                role="dialog"
                aria-modal="true"
                aria-label="Set up a position"
                ref={dialogRef}
                data-testid="board-editor"
            >
                <div className="xiangqi-board-container board-editor-board">
                    <div className="xiangqi-board">
                        <svg className="board-svg-grid" viewBox="0 0 8 9" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                            {([0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((y) => (
                                <line key={`h${y}`} x1={0} y1={y} x2={8} y2={y} className="grid-line" />
                            ))}
                            <line x1={0} y1={0} x2={0} y2={9} className="grid-line" />
                            <line x1={8} y1={0} x2={8} y2={9} className="grid-line" />
                            {([1, 2, 3, 4, 5, 6, 7] as const).map((x) => (
                                <React.Fragment key={`v${x}`}>
                                    <line x1={x} y1={0} x2={x} y2={4} className="grid-line" />
                                    <line x1={x} y1={5} x2={x} y2={9} className="grid-line" />
                                </React.Fragment>
                            ))}
                            <line x1={3} y1={0} x2={5} y2={2} className="palace-line" />
                            <line x1={5} y1={0} x2={3} y2={2} className="palace-line" />
                            <line x1={3} y1={7} x2={5} y2={9} className="palace-line" />
                            <line x1={5} y1={7} x2={3} y2={9} className="palace-line" />
                        </svg>
                        <div className="river" aria-hidden="true">
                            <span className="river-text">楚{'　'}河</span>
                            <span className="river-text river-text-flipped">漢{'　'}界</span>
                        </div>
                        <div className="hitboxes-layer" onClick={handleBoardClick} role="grid" aria-label="Position board" aria-describedby={keyboardHelpId}>
                            {RANKS_TOP_DOWN.map((rank) => <div role="row" key={rank}>{FILES.map((file) => {
                                const piece = board[rank][file];
                                return (
                                    <div role="gridcell" key={file}><button
                                        type="button"
                                        className="hitbox"
                                        style={{ left: leftFor(file), top: topFor(rank) }}
                                        data-file={file}
                                        data-rank={rank}
                                        data-brush={brush === 'erase' ? 'erase' : undefined}
                                        aria-label={`${FILE_LABELS[file]}${rank}, ${piece ? NAMES[piece] : 'empty'}. ${brush === 'erase' || piece === brush ? 'Clear' : `Place ${NAMES[brush]}`}`}
                                        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Control+Home Control+End Enter Space"
                                        tabIndex={focusedSquare.file === file && focusedSquare.rank === rank ? 0 : -1}
                                        onFocus={() => setFocusedSquare({ file, rank })}
                                        onKeyDown={event => handleSquareKeyDown(event, file, rank)}
                                    /></div>
                                );
                            })}</div>)}
                        </div>
                        <div className="pieces-layer" aria-hidden="true">
                            {RANKS_TOP_DOWN.map((rank) => FILES.map((file) => {
                                const piece = board[rank][file];
                                if (!piece) return null;
                                const isRed = piece === piece.toUpperCase();
                                return (
                                    <div
                                        key={`piece-${file}-${rank}`}
                                        className={`piece ${isRed ? 'red' : 'black'}${letterClass}`}
                                        style={{ left: leftFor(file), top: topFor(rank) }}
                                    >
                                        {pieceLabel(piece, pieceStyle)}
                                    </div>
                                );
                            }))}
                        </div>
                    </div>
                </div>

                <div className="board-editor-side">
                    <div className="board-editor-row board-editor-titlebar">
                        <h2>Set up a position</h2>
                        <button type="button" className="settings-close-btn" onClick={onCancel} aria-label="Close the editor">
                            <IconX />
                        </button>
                    </div>
                    <div className="board-editor-palette" role="group" aria-label="Piece to place">
                        {RED_PIECES.map(brushButton)}
                        <button
                            type="button"
                            className="board-editor-brush board-editor-brush-erase"
                            onClick={() => setBrush('erase')}
                            aria-pressed={brush === 'erase'}
                            aria-label="Erase brush"
                            title="Clear a point"
                            data-testid="editor-brush-erase"
                            data-editor-first
                        >
                            ✕
                        </button>
                        {BLACK_PIECES.map(brushButton)}
                    </div>
                    <p id={keyboardHelpId} className="board-editor-keyboard-help">Arrow keys move between squares. Enter or Space places or removes a piece. Tab moves to the controls.</p>
                    <div className="board-editor-row" role="group" aria-label="Position history">
                        <button type="button" className="pill-btn" disabled={!history.past.length} onClick={() => { followBoard(); dispatch({ type: 'undo' }); }} data-testid="editor-undo">Undo</button>
                        <button type="button" className="pill-btn" disabled={!history.future.length} onClick={() => { followBoard(); dispatch({ type: 'redo' }); }} data-testid="editor-redo">Redo</button>
                    </div>
                    <div className="board-editor-row" role="group" aria-label="Side to move">
                        <button type="button" className={`pill-btn ${side === 'w' ? 'pill-btn-active' : ''}`} onClick={() => { followBoard(); setSide('w'); }} aria-pressed={side === 'w'} data-testid="editor-side-red">Red to move</button>
                        <button type="button" className={`pill-btn ${side === 'b' ? 'pill-btn-active' : ''}`} onClick={() => { followBoard(); setSide('b'); }} aria-pressed={side === 'b'} data-testid="editor-side-black">Black to move</button>
                    </div>
                    <div className="board-editor-row">
                        <button type="button" className="pill-btn" onClick={() => { followBoard(); setBoard(parseFenBoard(START_FEN)); }} data-testid="editor-start">Start position</button>
                        <button type="button" className="pill-btn" onClick={() => { followBoard(); setBoard(emptyBoard()); }} data-testid="editor-clear">Clear board</button>
                    </div>
                    <p className="board-editor-problem" role="status" data-ok={problem ? undefined : 'true'} data-testid="editor-problem">
                        {problem ?? 'The position is legal. Done loads it onto the board.'}
                    </p>
                    <div className="board-editor-fen-row">
                        <label className="sr-only" htmlFor="board-editor-fen">Position as FEN</label>
                        <input
                            id="board-editor-fen"
                            className="board-editor-fen"
                            data-testid="editor-fen"
                            type="text"
                            spellCheck={false}
                            autoComplete="off"
                            value={fenDraft ?? fen}
                            /* Same pairing `.new-game-fen-input` uses for the same job: the
                               notice below is a live region, which announces once and is gone,
                               while these two are what a reader gets when they come back to the
                               field to fix it. */
                            aria-invalid={fenNotice ? true : undefined}
                            aria-describedby={fenNotice ? 'board-editor-fen-notice' : undefined}
                            onChange={(event) => { setFenDraft(event.target.value); setFenNotice(null); }}
                            onKeyDown={(event) => { if (!isComposingKey(event.nativeEvent) && event.key === 'Enter') { event.preventDefault(); loadFenDraft(); } }}
                        />
                        <button type="button" className="pill-btn" onClick={loadFenDraft} data-testid="editor-fen-load">Load</button>
                        <button type="button" className="pill-btn" onClick={() => void copyFen()} data-testid="editor-fen-copy">
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                    {fenNotice ? <p id="board-editor-fen-notice" className="board-editor-fen-notice" role="status" data-testid="editor-fen-notice">{fenNotice}</p> : null}
                    <div className="board-editor-row">
                        <button type="button" className="gc-btn" onClick={onCancel}>Cancel</button>
                        <button
                            type="button"
                            className="gc-btn new-game-start-btn"
                            onClick={applyPosition}
                            disabled={fenDraft === null && problem !== null}
                            title={fenDraft !== null ? 'Validate and load the typed FEN' : problem ?? 'Load this position'}
                            data-testid="editor-done"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
