import { describe, expect, it } from 'vitest';
import { describeMoveNumber } from './moveNumbering';

const FROM_THE_OPENING = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
/** A study pasted at Black's twentieth move, which is where the offset bites. */
const BLACK_AT_MOVE_20 = '4kabn1/3ca1r2/n3b4/p5p1p/2r1p4/2P4c1/P3P1P1P/BC6B/3CK3R/RN1A1A1N1 b - - 16 20';

describe('what number a move is called', () => {
    it('numbers the first two plies of a game as one move', () => {
        expect(describeMoveNumber(FROM_THE_OPENING, 1)).toEqual({ moveNumber: 1, side: 'w', label: '1.' });
        expect(describeMoveNumber(FROM_THE_OPENING, 2)).toEqual({ moveNumber: 1, side: 'b', label: '1...' });
    });

    it('advances the number on Red, not on Black', () => {
        expect(describeMoveNumber(FROM_THE_OPENING, 3).moveNumber).toBe(2);
        expect(describeMoveNumber(FROM_THE_OPENING, 4).moveNumber).toBe(2);
        expect(describeMoveNumber(FROM_THE_OPENING, 5).moveNumber).toBe(3);
    });

    it('agrees with the move list on the ply that started this', () => {
        // A 40-ply game from the opening: the breadcrumb used to call this
        // move 39 while the move list beneath it called the same move 20.
        expect(describeMoveNumber(FROM_THE_OPENING, 39).label).toBe('20.');
        expect(describeMoveNumber(FROM_THE_OPENING, 40).label).toBe('20...');
    });

    it('counts from the root FEN when a study does not start at move one', () => {
        // Without the offset this would read `1...`, and the whole point of a
        // pasted position is that its moves keep the numbers the record uses.
        expect(describeMoveNumber(BLACK_AT_MOVE_20, 1)).toEqual({ moveNumber: 20, side: 'b', label: '20...' });
        expect(describeMoveNumber(BLACK_AT_MOVE_20, 2)).toEqual({ moveNumber: 21, side: 'w', label: '21.' });
        expect(describeMoveNumber(BLACK_AT_MOVE_20, 3)).toEqual({ moveNumber: 21, side: 'b', label: '21...' });
    });

    it('starts a Red-to-move custom position on Red', () => {
        const redAtMove12 = '4k4/9/9/9/4P4/9/9/9/9/4K4 w - - 0 12';
        expect(describeMoveNumber(redAtMove12, 1)).toEqual({ moveNumber: 12, side: 'w', label: '12.' });
        expect(describeMoveNumber(redAtMove12, 2)).toEqual({ moveNumber: 12, side: 'b', label: '12...' });
    });

    it('falls back to move one when the FEN carries no usable counter', () => {
        // `plyOffsetFromRootFen` returns 0 for these, so a record still gets a
        // number rather than NaN reaching a label.
        for (const fen of ['', 'not a fen', 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w']) {
            expect(describeMoveNumber(fen, 1)).toEqual({ moveNumber: 1, side: 'w', label: '1.' });
        }
    });

    it('treats a missing or nonsense ply as the first one', () => {
        expect(describeMoveNumber(FROM_THE_OPENING, 0).label).toBe('1.');
        expect(describeMoveNumber(FROM_THE_OPENING, Number.NaN).label).toBe('1.');
        expect(describeMoveNumber(FROM_THE_OPENING, -4).label).toBe('1.');
    });

    it('alternates sides for a hundred plies without drifting', () => {
        for (let ply = 1; ply <= 100; ply += 1) {
            const { side, moveNumber } = describeMoveNumber(FROM_THE_OPENING, ply);
            expect(side).toBe(ply % 2 === 1 ? 'w' : 'b');
            expect(moveNumber).toBe(Math.ceil(ply / 2));
        }
    });
});
