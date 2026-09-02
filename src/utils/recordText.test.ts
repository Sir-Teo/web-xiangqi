import { describe, expect, it } from 'vitest';
import { formatRecordText } from './recordText';
import { START_FEN, parseFenBoard, parseMove, type BoardState } from './xiangqi';

const ROOT = `${START_FEN} w - - 0 1`;

/** Replays a line from the start so each record carries its own board. */
function records(moves: string[], rootFen = ROOT) {
    let board = parseFenBoard(rootFen.split(' ')[0]);
    return moves.map((uci, index) => {
        const move = parseMove(uci)!;
        const piece = board[move.fromRank][move.fromFile];
        const captured = board[move.toRank][move.toFile];
        const next: BoardState = board.map((row) => row.slice());
        next[move.toRank][move.toFile] = piece;
        next[move.fromRank][move.fromFile] = '';
        board = next;
        return { uci, piece, captured, board: next, ply: index + 1 };
    });
}

describe('formatRecordText', () => {
    it('writes one move pair per line in Chinese', () => {
        expect(formatRecordText(records(['h2e2', 'h9g7', 'b0c2']), ROOT, 'chinese'))
            .toBe('1. 炮二平五 馬8進7\n2. 傌八進七');
    });

    it('writes WXF the way the move list does', () => {
        expect(formatRecordText(records(['h2e2', 'h9g7']), ROOT, 'wxf')).toBe('1. C2=5 H8+7');
    });

    it('falls back to coordinates in UCI style', () => {
        expect(formatRecordText(records(['h2e2', 'h9g7']), ROOT, 'uci')).toBe('1. H2E2 H9G7');
    });

    it('uses an ellipsis when the record starts with Black', () => {
        const blackFirst = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1';
        expect(formatRecordText(records(['h9g7', 'b0c2'], blackFirst), blackFirst, 'wxf'))
            .toBe('1. ... H8+7\n2. H8+7');
    });

    it('is empty for no moves', () => {
        expect(formatRecordText([], ROOT, 'chinese')).toBe('');
    });
});
