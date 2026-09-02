import { describe, expect, it } from 'vitest';
import { describeSetupProblem, emptyBoard, setupFen } from './positionSetup';
import { START_FEN, parseFenBoard } from './xiangqi';

function withPieces(pieces: Array<[string, number, number]>) {
    const board = emptyBoard();
    for (const [piece, file, rank] of pieces) board[rank][file] = piece;
    return board;
}

describe('describeSetupProblem', () => {
    it('accepts the start position and a bare-kings ending', () => {
        expect(describeSetupProblem(parseFenBoard(START_FEN), 'w')).toBeNull();
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 3, 9]]), 'w')).toBeNull();
    });

    it('wants one general a side, inside its palace', () => {
        expect(describeSetupProblem(withPieces([['k', 3, 9]]), 'w')).toBe('Red needs exactly one general.');
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['K', 3, 0], ['k', 3, 9]]), 'w')).toBe('Red needs exactly one general.');
        expect(describeSetupProblem(withPieces([['K', 4, 3], ['k', 3, 9]]), 'w')).toMatch(/Red general must stay inside its palace/);
    });

    it('holds advisors, elephants and soldiers to their points', () => {
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 3, 9], ['A', 4, 0]]), 'w')).toMatch(/Red advisor can only stand/);
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 3, 9], ['a', 4, 8]]), 'w')).toBeNull();
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 3, 9], ['B', 4, 5]]), 'w')).toMatch(/Red elephant can only stand/);
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 3, 9], ['b', 4, 7]]), 'w')).toBeNull();
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 3, 9], ['P', 0, 1]]), 'w')).toMatch(/behind its own starting rank/);
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 3, 9], ['P', 1, 3]]), 'w')).toMatch(/must be on its starting file/);
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 3, 9], ['P', 1, 6]]), 'w')).toBeNull();
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 3, 9], ['p', 1, 3]]), 'w')).toBeNull();
    });

    it('caps each piece at what the set holds', () => {
        const board = withPieces([['K', 4, 0], ['k', 3, 9], ['R', 0, 0], ['R', 8, 0], ['R', 0, 1]]);
        expect(describeSetupProblem(board, 'w')).toBe('Red can have at most 2 chariots.');
    });

    it('refuses facing generals and a check against the side that is not to move', () => {
        expect(describeSetupProblem(withPieces([['K', 4, 0], ['k', 4, 9]]), 'w')).toMatch(/face each other/);
        const check = withPieces([['K', 4, 0], ['k', 3, 9], ['R', 3, 0]]);
        expect(describeSetupProblem(check, 'w')).toBe("Black's general is in check, but it is Red's move.");
        expect(describeSetupProblem(check, 'b')).toBeNull();
    });
});

describe('setupFen', () => {
    it('writes fresh clocks', () => {
        expect(setupFen(withPieces([['K', 4, 0], ['k', 3, 9]]), 'b')).toBe('3k5/9/9/9/9/9/9/9/9/4K4 b - - 0 1');
    });
});
