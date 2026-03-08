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
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (_) {
        return false;
    }
}
