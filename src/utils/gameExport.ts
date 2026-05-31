import type { MoveRecord } from '../hooks/useXiangqi';
import type { GameResult } from '../hooks/useXiangqi';
import type { GameMode } from '../App';

const RESULT_TAG: Record<NonNullable<GameResult>, string> = {
    'red-wins':   '1-0',
    'black-wins': '0-1',
    'draw':       '1/2-1/2',
};

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
    } = {}
): string {
    const result = options.result ? RESULT_TAG[options.result] : '*';
    const date = options.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');

    const tags = [
        `[Variant "Xiangqi"]`,
        `[Date "${date}"]`,
        options.gameMode ? `[Event "${options.gameMode}"]` : null,
        options.opening ? `[Opening "${options.opening}"]` : null,
        `[Result "${result}"]`,
    ].filter(Boolean).join('\n');

    // Build move text: "1. e2e4 e9e8 2. ..."
    const movePairs: string[] = [];
    for (let i = 0; i < moves.length; i++) {
        const record = moves[i];
        const moveNum = Math.floor(i / 2) + 1;
        if (i % 2 === 0) {
            movePairs.push(`${moveNum}. ${record.uci}`);
        } else {
            movePairs[movePairs.length - 1] += ` ${record.uci}`;
        }
    }

    const moveText = movePairs.join(' ');
    return `${tags}\n\n${moveText}${moveText ? ' ' : ''}${result}\n`;
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
    } = {}
): string {
    const result = options.result ? RESULT_TAG[options.result] : '*';
    const date = options.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');

    const tags = [
        `[Variant "Xiangqi"]`,
        `[Date "${date}"]`,
        options.gameMode ? `[Event "${options.gameMode}"]` : null,
        options.label ? `[White "${options.label}"]` : null,
        options.opening ? `[Opening "${options.opening}"]` : null,
        `[Result "${result}"]`,
    ].filter(Boolean).join('\n');

    const movePairs: string[] = [];
    for (let i = 0; i < uciMoves.length; i++) {
        const moveNum = Math.floor(i / 2) + 1;
        if (i % 2 === 0) {
            movePairs.push(`${moveNum}. ${uciMoves[i]}`);
        } else {
            movePairs[movePairs.length - 1] += ` ${uciMoves[i]}`;
        }
    }

    const moveText = movePairs.join(' ');
    return `${tags}\n\n${moveText}${moveText ? ' ' : ''}${result}\n`;
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
