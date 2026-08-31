import { describe, expect, it } from 'vitest';
import { MOVE_RULE_HINTS, UNKNOWN_MOVE_RULE_HINT, formatMoveRuleHint } from './moveRuleHints';
import {
    START_FEN,
    parseFenBoard,
    validateMoveStr,
    validatePieceMove,
    type BoardState,
    type Side,
} from './xiangqi';

/**
 * Every reason the rules engine can give, discovered rather than listed.
 *
 * A hand-written list of reasons would pass forever after someone adds a new
 * one, and the new one would reach a player as the engine's own words. So this
 * plays the board instead: every square to every square, in positions chosen to
 * exercise each piece, collecting whatever `validatePieceMove` says.
 */
function collectRejectionReasons(): Set<string> {
    const reasons = new Set<string>();
    const positions: Array<{ fen: string; side: Side }> = [
        { fen: START_FEN, side: 'w' },
        { fen: START_FEN, side: 'b' },
        // Pieces off their home squares: crossed pawns, a cannon with a screen,
        // horses with and without a leg, generals facing down an open file.
        { fen: 'r1bakab1r/9/1cn2cn2/p1p1p1p1p/9/2P6/P3P1P1P/1CN2CN2/9/R1BAKAB1R', side: 'w' },
        { fen: 'r1bakab1r/9/1cn2cn2/p1p1p1p1p/9/2P6/P3P1P1P/1CN2CN2/9/R1BAKAB1R', side: 'b' },
        { fen: '4k4/9/9/9/9/9/9/9/9/4K4', side: 'w' },
        { fen: '4k4/9/9/9/9/9/9/9/9/4K4', side: 'b' },
        { fen: '3ak4/4a4/4b4/9/9/9/9/4B4/4A4/3AK4', side: 'w' },
        { fen: '2bakab2/9/9/p1p1p1p1p/9/9/P1P1P1P1P/9/9/2BAKAB2', side: 'w' },
        // Four positions built for reasons the ordinary ones cannot reach:
        // an elephant advanced to c4, which is the only way it can try to cross
        // the river; an elephant whose eye is blocked by its own soldier; a
        // general standing at the edge of its palace with somewhere illegal to
        // step; and a soldier pinned down the file by a chariot.
        { fen: '4k4/9/9/9/4p4/2B6/9/9/9/4K4', side: 'w' },
        { fen: '3k5/9/9/9/9/9/9/9/3P5/2B1K4', side: 'w' },
        { fen: '3k5/9/9/9/9/9/9/4K4/9/9', side: 'w' },
        { fen: '3kr4/9/9/9/4P4/9/9/9/9/4K4', side: 'w' },
    ];

    for (const { fen, side } of positions) {
        let board: BoardState;
        try { board = parseFenBoard(fen); } catch { continue; }
        for (let fromRank = 0; fromRank < 10; fromRank += 1) {
            for (let fromFile = 0; fromFile < 9; fromFile += 1) {
                for (let toRank = 0; toRank < 10; toRank += 1) {
                    for (let toFile = 0; toFile < 9; toFile += 1) {
                        const result = validatePieceMove(
                            board,
                            { fromFile, fromRank, toFile, toRank, raw: '' },
                            side
                        );
                        if (!result.ok && result.reason) reasons.add(result.reason);
                    }
                }
            }
        }
        // Out of bounds is only reachable through a move object the coordinate
        // loops cannot build.
        const outside = validatePieceMove(board, { fromFile: -1, fromRank: 0, toFile: 0, toRank: 0, raw: '' }, side);
        if (!outside.ok && outside.reason) reasons.add(outside.reason);
        const unreadable = validateMoveStr('not-a-move', board, side);
        if (!unreadable.ok && unreadable.reason) reasons.add(unreadable.reason);
    }
    return reasons;
}

describe('the sentence under a refused move', () => {
    const reasons = collectRejectionReasons();

    it('finds enough of the rule set to be worth asserting against', () => {
        // A guard on the guard: if the positions above stopped exercising the
        // pieces, this test would pass by finding nothing.
        const found = [...reasons];
        expect(found.length).toBeGreaterThanOrEqual(15);
        for (const expected of [
            'horse leg blocked', 'elephant eye blocked', 'elephant cannot cross river',
            'cannon capture needs one screen', 'rook path blocked', 'advisor must stay in palace',
            'generals cannot face each other', 'move leaves general in check', 'pawn move is illegal',
            'general must stay in palace',
        ]) {
            expect(found, `never produced "${expected}"`).toContain(expected);
        }
    });

    it('has a written sentence for every reason the engine can give', () => {
        // Asked of the record, not of the output: one hint reads exactly like
        // the capitalised reason ("Generals cannot face each other."), so
        // comparing strings would call a written sentence a fallthrough.
        for (const reason of reasons) {
            expect(Object.keys(MOVE_RULE_HINTS), `"${reason}" has no sentence`).toContain(reason);
        }
    });

    it('does not carry sentences for reasons the engine cannot give', () => {
        // Not a failure, but worth seeing: a key here that nothing produces is
        // either dead or a reason the sweep above stopped reaching.
        const unreachable = Object.keys(MOVE_RULE_HINTS).filter((reason) => !reasons.has(reason));
        expect(unreachable, `unreachable hints: ${unreachable.join(', ')}`).toEqual([]);
    });

    it('never says "rook", which is not a piece in this game', () => {
        for (const reason of reasons) {
            expect(formatMoveRuleHint(reason).toLowerCase()).not.toContain('rook');
        }
    });

    it('writes a sentence, not a fragment', () => {
        for (const reason of reasons) {
            const hint = formatMoveRuleHint(reason);
            expect(hint, reason).toMatch(/^[A-Z]/);
            expect(hint, reason).toMatch(/\.$/);
        }
    });

    it('says something useful when there is no reason at all', () => {
        expect(formatMoveRuleHint(undefined)).toBe(UNKNOWN_MOVE_RULE_HINT);
        expect(formatMoveRuleHint('')).toBe(UNKNOWN_MOVE_RULE_HINT);
    });
});
