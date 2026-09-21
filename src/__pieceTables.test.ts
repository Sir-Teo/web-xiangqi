import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pieceLabel, RED_GENERAL_GLYPH, BLACK_GENERAL_GLYPH } from './utils/pieceStyle';
import { formatMoveRecordLabel, formatMoveRecordTitle } from './utils/moveNotation';
import { formatChineseMove, formatWxfMove } from './utils/xiangqiNotation';
import { PIECE_NAMES as MATERIAL_NAMES, type PieceCode } from './utils/material';
import { legalMovesFrom, squareToUci, type BoardState } from './utils/xiangqi';

/**
 * The same fourteen pieces, written down in six places.
 *
 * `pieceStyle` draws them on the board, `moveNotation` writes them in the move
 * list and speaks them, `xiangqiNotation` writes them in WXF and Chinese,
 * `material` names them in the capture tray, `Board.tsx` names them for a
 * screen reader, and `App.tsx` says what each one does in coach mode. Six
 * tables, one idea, and nothing held them together -- so 傌 could become 馬 on
 * one surface and stay 傌 on the other, or `B` could be drawn as an elephant
 * and written as a bishop's letter, and every existing test would pass.
 *
 * None of them can simply be merged: they are different *kinds* of thing (a
 * glyph, a letter, a name, a sentence) and two of them are component-local by
 * design. What can be held is that they agree about which piece is which, so
 * that is what this asserts -- behaviourally where the table is reachable, and
 * by reading the source where it is not, which is what `__deadClassNames` and
 * `__cssTokens` already do for the same reason.
 */
const CODES: PieceCode[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P', 'k', 'a', 'b', 'n', 'r', 'c', 'p'];

/** A board with the piece somewhere it can legally move, and both generals clear. */
function boardFor(code: PieceCode): { board: BoardState; at: { file: number; rank: number } } {
    const board: BoardState = Array.from({ length: 10 }, () => Array(9).fill(''));
    board[0][3] = 'K';
    board[9][5] = 'k';
    const home: Record<PieceCode, [number, number]> = {
        K: [3, 0], A: [4, 1], B: [2, 0], N: [4, 5], R: [0, 5], C: [0, 4], P: [4, 3],
        k: [5, 9], a: [4, 8], b: [2, 9], n: [4, 4], r: [8, 5], c: [8, 4], p: [4, 6],
    };
    const [file, rank] = home[code];
    board[rank][file] = code;
    return { board, at: { file, rank } };
}

/** A table a component keeps to itself, read the only way a test can read it. */
function sourceTable(file: string, declaration: string): Record<string, string> | null {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = source.indexOf(declaration);
    if (start < 0) return null;
    const open = source.indexOf('{', start);
    const close = source.indexOf('};', open);
    if (open < 0 || close < 0) return null;
    const entries: Record<string, string> = {};
    for (const match of source.slice(open + 1, close).matchAll(/([A-Za-z]):\s*'([^']*)'/g)) {
        entries[match[1]] = match[2];
    }
    return entries;
}

describe('every table of the fourteen pieces agrees which is which', () => {
    for (const code of CODES) {
        it(`draws, writes and names ${code} as one piece`, () => {
            const { board, at } = boardFor(code);
            const side = code === code.toUpperCase() ? 'w' : 'b';
            const targets = legalMovesFrom(board, at.file, at.rank, side);
            expect(targets.length, `${code} has no legal move in its fixture`).toBeGreaterThan(0);
            const uci = squareToUci(at.file, at.rank) + squareToUci(targets[0].file, targets[0].rank);

            // The glyph on the board is the glyph in the record and in the list.
            const drawn = pieceLabel(code, 'traditional');
            expect(formatChineseMove(board, uci), `Chinese record for ${code}`).toMatch(new RegExp(`^${drawn}`));
            expect(formatMoveRecordLabel({ uci, piece: code }), `move list label for ${code}`).toMatch(new RegExp(`^${drawn}`));

            // The letter on the board is the letter WXF writes. None of these
            // fixtures stacks a piece, so no marker precedes it.
            const letter = pieceLabel(code, 'letters');
            expect(formatWxfMove(board, uci), `WXF for ${code}`).toMatch(new RegExp(`^${letter}`));

            // The name in the capture tray is the name a move is spoken with.
            expect(formatMoveRecordTitle({ uci, piece: code })).toMatch(new RegExp(`^${MATERIAL_NAMES[code]}`));
        });
    }

    it('names the general that is drawn', () => {
        expect(RED_GENERAL_GLYPH).toBe(pieceLabel('K', 'traditional'));
        expect(BLACK_GENERAL_GLYPH).toBe(pieceLabel('k', 'traditional'));
    });

    it('gives the board and the capture tray the same name for each piece', () => {
        const boardNames = sourceTable('./components/Board/Board.tsx', 'const PIECE_NAMES');
        expect(boardNames, 'the board name table could not be read').not.toBeNull();
        for (const code of CODES) {
            expect(boardNames![code]?.toLowerCase(), `board name for ${code}`).toBe(MATERIAL_NAMES[code].toLowerCase());
        }
    });

    it('leaves no piece without a coach hint', () => {
        const hints = sourceTable('./App.tsx', 'const PIECE_MOVE_HINTS');
        expect(hints, 'the coach hint table could not be read').not.toBeNull();
        for (const code of CODES) {
            expect(hints![code], `coach hint for ${code}`).toBeTruthy();
        }
    });
});
