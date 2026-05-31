import type { MoveRecord } from '../hooks/useXiangqi';
import type { GameResult } from '../hooks/useXiangqi';
import type { GameMode } from '../App';
import { START_FEN } from './xiangqi';

const RESULT_TAG: Record<NonNullable<GameResult>, string> = {
    'red-wins':   '1-0',
    'black-wins': '0-1',
    'draw':       '1/2-1/2',
};

const DEFAULT_START_POSITION_FEN = `${START_FEN} w - - 0 1`;

type PgnSide = 'w' | 'b';

interface PgnStartPosition {
    fen: string;
    sideToMove: PgnSide;
    fullmove: number;
    isCustom: boolean;
}

function normalizeFen(fen?: string): string {
    return String(fen || '').trim().replace(/\s+/g, ' ');
}

function parsePgnStartPosition(startFen?: string): PgnStartPosition {
    const fen = normalizeFen(startFen) || DEFAULT_START_POSITION_FEN;
    const parts = fen.split(/\s+/);
    const sideToMove: PgnSide = parts[1] === 'b' ? 'b' : 'w';
    const parsedFullmove = Number(parts[5]);
    const fullmove = Number.isFinite(parsedFullmove) && parsedFullmove > 0
        ? Math.trunc(parsedFullmove)
        : 1;

    return {
        fen,
        sideToMove,
        fullmove,
        isCustom: fen !== DEFAULT_START_POSITION_FEN,
    };
}

function escapeTagValue(value: string): string {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, ' ');
}

function tagLine(name: string, value: string): string {
    return `[${name} "${escapeTagValue(value)}"]`;
}

function buildMoveText(uciMoves: string[], startPosition: PgnStartPosition, result: string): string {
    const movePairs: string[] = [];
    let sideToMove = startPosition.sideToMove;
    let moveNumber = startPosition.fullmove;

    for (const uci of uciMoves) {
        if (sideToMove === 'w') {
            movePairs.push(`${moveNumber}. ${uci}`);
        } else {
            const whiteHalfMovePrefix = `${moveNumber}. `;
            if (movePairs.length > 0 && movePairs[movePairs.length - 1].startsWith(whiteHalfMovePrefix)) {
                movePairs[movePairs.length - 1] += ` ${uci}`;
            } else {
                movePairs.push(`${moveNumber}... ${uci}`);
            }
            moveNumber += 1;
        }

        sideToMove = sideToMove === 'w' ? 'b' : 'w';
    }

    const moveText = movePairs.join(' ');
    return `${moveText}${moveText ? ' ' : ''}${result}`;
}

/**
 * Exports a game as a minimal PGN string using UCI (ICCS-compatible) move notation.
 * Compatible with analysis boards that accept Variant "Xiangqi".
 */
export function exportPgn(
    moves: MoveRecord[],
    options: {
        gameMode?: GameMode;
        opening?: string;
        result?: GameResult;
        date?: string;
        startFen?: string;
    } = {}
): string {
    const result = options.result ? RESULT_TAG[options.result] : '*';
    const date = options.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const startPosition = parsePgnStartPosition(options.startFen);

    const tags = [
        tagLine('Variant', 'Xiangqi'),
        tagLine('Date', date),
        options.gameMode ? tagLine('Event', options.gameMode) : null,
        options.opening ? tagLine('Opening', options.opening) : null,
        startPosition.isCustom ? tagLine('SetUp', '1') : null,
        startPosition.isCustom ? tagLine('FEN', startPosition.fen) : null,
        tagLine('Result', result),
    ].filter(Boolean).join('\n');

    return `${tags}\n\n${buildMoveText(moves.map((move) => move.uci), startPosition, result)}\n`;
}

/**
 * Exports a game from raw UCI move strings (e.g. from game library).
 */
export function exportPgnFromUci(
    uciMoves: string[],
    options: {
        gameMode?: GameMode;
        opening?: string;
        result?: GameResult;
        label?: string;
        date?: string;
        startFen?: string;
    } = {}
): string {
    const result = options.result ? RESULT_TAG[options.result] : '*';
    const date = options.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const startPosition = parsePgnStartPosition(options.startFen);

    const tags = [
        tagLine('Variant', 'Xiangqi'),
        tagLine('Date', date),
        options.gameMode ? tagLine('Event', options.gameMode) : null,
        options.label ? tagLine('White', options.label) : null,
        options.opening ? tagLine('Opening', options.opening) : null,
        startPosition.isCustom ? tagLine('SetUp', '1') : null,
        startPosition.isCustom ? tagLine('FEN', startPosition.fen) : null,
        tagLine('Result', result),
    ].filter(Boolean).join('\n');

    return `${tags}\n\n${buildMoveText(uciMoves, startPosition, result)}\n`;
}

/**
 * Copies text to clipboard, returning a promise that resolves to true on success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    const value = String(text);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    try {
        if (clipboard?.writeText) {
            await clipboard.writeText(value);
            return true;
        }
    } catch (_) {
        // Fall through to the selection-based fallback below.
    }

    return copyToClipboardWithSelection(value);
}

/**
 * Downloads plain text through a temporary object URL.
 */
export function downloadTextFile(filename: string, text: string, mimeType = 'text/plain;charset=utf-8'): boolean {
    if (
        typeof document === 'undefined' ||
        !document.body ||
        typeof Blob === 'undefined' ||
        typeof URL === 'undefined' ||
        typeof URL.createObjectURL !== 'function'
    ) {
        return false;
    }

    const blob = new Blob([String(text)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'web-xiangqi-export.txt';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);

    try {
        anchor.click();
        return true;
    } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

function copyToClipboardWithSelection(text: string): boolean {
    if (typeof document === 'undefined' || !document.body) return false;

    const previousActive = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const selection = document.getSelection?.();
    const ranges: Range[] = [];
    if (selection) {
        for (let i = 0; i < selection.rangeCount; i += 1) {
            ranges.push(selection.getRangeAt(i));
        }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.padding = '0';
    textarea.style.border = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();

    try {
        return Boolean(document.execCommand?.('copy'));
    } catch (_) {
        return false;
    } finally {
        textarea.remove();
        if (selection) {
            selection.removeAllRanges();
            for (const range of ranges) {
                selection.addRange(range);
            }
        }
        previousActive?.focus({ preventScroll: true });
    }
}
