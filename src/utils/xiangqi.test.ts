import { describe, expect, it } from 'vitest';
import {
    START_FEN,
    attacksSquare,
    boardToFen,
    inBounds,
    hasCrossedRiver,
    inPalace,
    kingsFacing,
    legalMovesFrom,
    parseFenBoard,
    parseMove,
    squareToUci,
    uciToSquare,
    validateMoveStr,
} from './xiangqi';

/** Ranks run bottom-to-top: rank 0 is Red's back rank, rank 9 is Black's. */
function board(fen: string) {
    return parseFenBoard(fen);
}

function legal(fen: string, move: string, side: 'w' | 'b' = 'w') {
    return validateMoveStr(move, board(fen), side).ok;
}

function reason(fen: string, move: string, side: 'w' | 'b' = 'w') {
    return validateMoveStr(move, board(fen), side).reason;
}

describe('board coordinates', () => {
    it('reads the opening position the right way up', () => {
        const state = board(START_FEN);
        expect(state[0][0]).toBe('R');
        expect(state[0][4]).toBe('K');
        expect(state[9][0]).toBe('r');
        expect(state[9][4]).toBe('k');
        expect(state[3][0]).toBe('P');
        expect(state[6][0]).toBe('p');
    });

    it('round-trips a placement through the FEN writer', () => {
        expect(boardToFen(board(START_FEN), 'w').split(' ')[0]).toBe(START_FEN);
    });

    it('rejects a malformed placement rather than guessing', () => {
        expect(() => board('rnbakabnr/9/9')).toThrow(/10 ranks/);
        expect(() => board('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNRR')).toThrow();
        expect(() => board('xnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR')).toThrow(/invalid piece/);
    });

    it('maps squares to and from UCI names', () => {
        expect(squareToUci(0, 0)).toBe('a0');
        expect(squareToUci(8, 9)).toBe('i9');
        expect(uciToSquare('e3')).toEqual({ file: 4, rank: 3 });
        expect(uciToSquare('z3')).toBeNull();
        expect(parseMove('h2e2')).toMatchObject({ fromFile: 7, fromRank: 2, toFile: 4, toRank: 2 });
        expect(parseMove('h2e')).toBeNull();
    });

    /**
     * The guards themselves, which only a wrong caller reaches.
     *
     * Every test above hands these well-formed input, so the length test in
     * `uciToSquare` and the upper bounds in `inBounds` could each be removed
     * or loosened and the suite would not notice -- and the thing on the far
     * side of `inBounds` is `state[rank][file]`, which throws on rank 10
     * rather than returning a wrong answer.
     */
    it('turns away input that is off the board or not a square', () => {
        expect(uciToSquare('')).toBeNull();
        expect(uciToSquare('e')).toBeNull();
        expect(uciToSquare('e33')).toBeNull();
        expect(uciToSquare('ee')).toBeNull();

        expect(inBounds(0, 0)).toBe(true);
        expect(inBounds(8, 9)).toBe(true);
        expect(inBounds(9, 0)).toBe(false);
        expect(inBounds(0, 10)).toBe(false);
        expect(inBounds(-1, 0)).toBe(false);
        expect(inBounds(0, -1)).toBe(false);

        // A target off the board is refused before the board is indexed.
        const state = board('3k5/9/9/9/9/9/9/9/9/4K4');
        expect(attacksSquare(state, 4, 0, 'K', 4, 10)).toBe(false);
        expect(attacksSquare(state, 4, 0, 'K', 9, 0)).toBe(false);
        expect(attacksSquare(state, 4, 0, '', 4, 1)).toBe(false);
    });

    /**
     * Both bounds of both palaces, not one corner of each.
     *
     * This used to check Red's rank bound and Black's *file* bound, which
     * leaves Black's ranks unstated -- and `rank >= 7 && rank <= 9` rewritten
     * as `||` is true for every rank on the board, so a black general or
     * advisor could stand anywhere on files 3-5 and the whole suite passed.
     */
    it('knows where the palaces and the river are', () => {
        for (const file of [3, 4, 5]) {
            for (const rank of [0, 1, 2]) expect(inPalace('w', file, rank), `w ${file},${rank}`).toBe(true);
            for (const rank of [3, 4, 5, 6, 7, 8, 9]) expect(inPalace('w', file, rank), `w ${file},${rank}`).toBe(false);
            for (const rank of [7, 8, 9]) expect(inPalace('b', file, rank), `b ${file},${rank}`).toBe(true);
            for (const rank of [0, 1, 2, 3, 4, 5, 6]) expect(inPalace('b', file, rank), `b ${file},${rank}`).toBe(false);
        }
        // And no file outside 3-5 is in either palace, at any rank.
        for (const file of [0, 1, 2, 6, 7, 8]) {
            for (const rank of [0, 1, 2, 7, 8, 9]) {
                expect(inPalace('w', file, rank), `w ${file},${rank}`).toBe(false);
                expect(inPalace('b', file, rank), `b ${file},${rank}`).toBe(false);
            }
        }
        expect(hasCrossedRiver('w', 5)).toBe(true);
        expect(hasCrossedRiver('w', 4)).toBe(false);
        expect(hasCrossedRiver('b', 4)).toBe(true);
        expect(hasCrossedRiver('b', 5)).toBe(false);
    });
});

describe('cannon', () => {
    // Red cannon on e0, Black pawn on e5, kings out of each other's way.
    const noScreen = '5k3/9/9/9/4p4/9/9/9/9/3KC4';
    const oneScreen = '5k3/9/9/9/4p4/9/9/4p4/9/3KC4';

    it('cannot capture without a screen to jump', () => {
        expect(legal(noScreen, 'e0e5')).toBe(false);
    });

    it('captures over exactly one screen', () => {
        expect(legal(oneScreen, 'e0e5')).toBe(true);
    });

    it('moves to an empty square only along a clear line', () => {
        expect(legal(oneScreen, 'e0e1')).toBe(true);
        // e2 holds the screen, so e4 is not reachable as a quiet move.
        expect(legal(oneScreen, 'e0e4')).toBe(false);
    });
});

describe('horse', () => {
    const free = '5k3/9/9/9/9/9/9/9/9/3KN4';
    const hobbled = '5k3/9/9/9/9/9/9/9/4P4/3KN4';

    it('makes its two-then-one move when the leg is clear', () => {
        expect(legal(free, 'e0d2')).toBe(true);
        expect(legal(free, 'e0f2')).toBe(true);
    });

    it('is blocked by a piece on the leg', () => {
        expect(legal(hobbled, 'e0d2')).toBe(false);
        expect(legal(hobbled, 'e0f2')).toBe(false);
    });

    it('refuses a move that is not the horse shape', () => {
        expect(legal(free, 'e0e2')).toBe(false);
        expect(legal(free, 'e0g2')).toBe(false);
    });
});

describe('elephant', () => {
    const onRank4 = '5k3/9/9/9/9/4B4/9/9/9/3K5';
    const blockedEye = '5k3/9/9/9/9/4B4/5p3/9/9/3K5';

    it('steps two points diagonally on its own side', () => {
        expect(legal(onRank4, 'e4g2')).toBe(true);
        expect(legal(onRank4, 'e4c2')).toBe(true);
    });

    it('never crosses the river', () => {
        expect(legal(onRank4, 'e4g6')).toBe(false);
        expect(legal(onRank4, 'e4c6')).toBe(false);
    });

    it('is blocked when its eye is occupied', () => {
        expect(legal(blockedEye, 'e4g2')).toBe(false);
    });
});

describe('advisor', () => {
    const inPalaceFen = '4k4/9/9/9/9/9/9/9/4A4/5K3';

    it('steps one point diagonally inside the palace', () => {
        expect(legal(inPalaceFen, 'e1d0')).toBe(true);
        expect(legal(inPalaceFen, 'e1d2')).toBe(true);
    });

    it('does not move straight', () => {
        expect(legal(inPalaceFen, 'e1e2')).toBe(false);
    });

    it('stays inside the palace', () => {
        // c2 is diagonally reachable in shape but outside the palace files.
        expect(legal('4k4/9/9/9/9/9/9/3A5/9/5K3', 'd2c3')).toBe(false);
    });
});

describe('pawn', () => {
    const beforeRiver = '3k5/9/9/9/9/9/4P4/9/9/4K4';
    const afterRiver = '3k5/9/9/9/4P4/9/9/9/9/4K4';

    it('only goes forward before crossing the river', () => {
        expect(legal(beforeRiver, 'e3e4')).toBe(true);
        expect(legal(beforeRiver, 'e3d3')).toBe(false);
        expect(legal(beforeRiver, 'e3f3')).toBe(false);
    });

    it('may go sideways once across, but never back', () => {
        expect(legal(afterRiver, 'e5e6')).toBe(true);
        expect(legal(afterRiver, 'e5d5')).toBe(true);
        expect(legal(afterRiver, 'e5f5')).toBe(true);
        expect(legal(afterRiver, 'e5e4')).toBe(false);
    });
});

describe('the generals', () => {
    const facingRisk = '3k5/9/9/9/9/9/9/9/9/4K4';

    it('will not step onto the file the other general is on', () => {
        expect(legal(facingRisk, 'e0d0')).toBe(false);
        expect(reason(facingRisk, 'e0d0')).toMatch(/face each other/);
        expect(legal(facingRisk, 'e0e1')).toBe(true);
    });

    it('reads an open file between the generals as facing', () => {
        expect(kingsFacing(board('3k5/9/9/9/9/9/9/9/9/3K5'))).toBe(true);
        expect(kingsFacing(board('3k5/9/9/9/9/9/9/9/3P5/3K5'))).toBe(false);
        expect(kingsFacing(board('3k5/9/9/9/9/9/9/9/9/4K4'))).toBe(false);
    });

    it('stays inside its own palace', () => {
        expect(legal(facingRisk, 'e0e3')).toBe(false);
        expect(legal('3k5/9/9/9/9/9/9/4K4/9/9', 'e2e3')).toBe(false);
    });

    /**
     * The same for Black, which was only ever asserted for Red.
     *
     * Every general test above starts from a board where Black's general is
     * already at the back of its palace and is never asked to leave it, so
     * `rank >= 7 && rank <= 9` rewritten as `||` -- true for every rank there
     * is -- passed the whole suite. Red's floor was covered; Black's was not.
     *
     * The red general sits on f0 in both boards so that a lateral step by
     * Black is refused for being outside the palace and not for putting the
     * two generals on one file, which is a different rule with its own test.
     */
    it('holds the Black general and its advisors in the far palace too', () => {
        // Black general on d7, the near rank of its palace.
        const general = '9/9/3k5/9/9/9/9/9/9/5K3';
        expect(legal(general, 'd7d8', 'b')).toBe(true);
        expect(legal(general, 'd7e7', 'b')).toBe(true);
        expect(legal(general, 'd7d6', 'b')).toBe(false);
        expect(legal(general, 'd7c7', 'b')).toBe(false);

        // Advisor on e7: its four diagonals are d8 and f8 inside, d6 and f6
        // one rank past the palace.
        const advisor = '3k5/9/4a4/9/9/9/9/9/9/5K3';
        expect(legal(advisor, 'e7d8', 'b')).toBe(true);
        expect(legal(advisor, 'e7f8', 'b')).toBe(true);
        expect(legal(advisor, 'e7d6', 'b')).toBe(false);
        expect(legal(advisor, 'e7f6', 'b')).toBe(false);
    });
});

describe('legal move enumeration', () => {
    it('offers a cornered rook its whole file and rank', () => {
        const moves = legalMovesFrom(board('5k3/9/9/9/9/9/9/9/9/R2K5'), 0, 0, 'w');
        const squares = moves.map(move => squareToUci(move.file, move.rank)).sort();
        // Up the a-file, and across to c0 where the red king blocks it.
        expect(squares).toContain('a9');
        expect(squares).toContain('c0');
        expect(squares).not.toContain('d0');
        expect(squares).not.toContain('e0');
    });

    it('gives nothing for an empty square or the wrong side', () => {
        const state = board(START_FEN);
        expect(legalMovesFrom(state, 4, 4, 'w')).toEqual([]);
        expect(legalMovesFrom(state, 0, 0, 'b')).toEqual([]);
    });
});
