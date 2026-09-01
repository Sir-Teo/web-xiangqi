import { describe, expect, it } from 'vitest';
import { passMoveFen } from './threatPosition';
import { START_FEN, isInCheck, parseFenBoard } from './xiangqi';

const OPENING = `${START_FEN} w - - 0 1`;

describe('passing the move to the other side', () => {
    it('hands Red the move to Black and leaves everything else alone', () => {
        expect(passMoveFen(OPENING)).toBe(`${START_FEN} b - - 0 1`);
    });

    it('starts a new full move when Black passes, because the next turn is Red', () => {
        expect(passMoveFen(`${START_FEN} b - - 0 7`)).toBe(`${START_FEN} w - - 0 8`);
        expect(passMoveFen(`${START_FEN} w - - 0 7`)).toBe(`${START_FEN} b - - 0 7`);
    });

    it('keeps the halfmove clock, which the engine adjudicates from', () => {
        // Not decoration: the same endgame reads mate in 3 at 0 and 0.00 at 119,
        // so a threat evaluated at a different clock is about a different game.
        expect(passMoveFen(`${START_FEN} w - - 119 60`)).toBe(`${START_FEN} b - - 119 60`);
    });

    it('refuses to pass when the side to move is in check', () => {
        // A minimal pair: the same position with the chariot one file over, so
        // the only thing that differs between them is the check. Both carry a
        // soldier on e5 because without it the generals face down the open
        // e-file and the control is refused for the *other* reason -- which is
        // how this test first passed while proving nothing.
        const redInCheck = '3ak4/9/9/9/4p4/9/9/9/4r4/3AKA3 w - - 4 12';
        const noCheck = '3ak4/9/9/9/4p4/9/9/9/3r5/3AKA3 w - - 4 12';
        expect(isInCheck(parseFenBoard(redInCheck.split(' ')[0]), 'w')).toBe(true);
        expect(isInCheck(parseFenBoard(noCheck.split(' ')[0]), 'w')).toBe(false);
        expect(passMoveFen(noCheck)).not.toBeNull();
        expect(passMoveFen(redInCheck)).toBeNull();
    });

    it('refuses to pass when the generals face each other', () => {
        const facing = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1';
        const blocked = '4k4/9/9/9/4P4/9/9/9/9/4K4 w - - 0 1';
        expect(passMoveFen(blocked)).not.toBeNull();
        expect(passMoveFen(facing)).toBeNull();
    });

    it('refuses a position it cannot read', () => {
        expect(passMoveFen('')).toBeNull();
        expect(passMoveFen('not a fen at all')).toBeNull();
        expect(passMoveFen(START_FEN)).toBeNull();                 // no side field
        expect(passMoveFen(`${START_FEN} x - - 0 1`)).toBeNull();   // no such side
        expect(passMoveFen('rubbish/9/9/9/9/9/9/9/9/9 w - - 0 1')).toBeNull();
    });

    it('falls back to move one rather than writing a FEN that lies', () => {
        expect(passMoveFen(`${START_FEN} w - - 0 zero`)).toBe(`${START_FEN} b - - 0 1`);
        expect(passMoveFen(`${START_FEN} b - - 0 -3`)).toBe(`${START_FEN} w - - 0 2`);
    });

    it('produces a position the rules engine still accepts', () => {
        const passed = passMoveFen(OPENING);
        expect(passed).not.toBeNull();
        const board = parseFenBoard(passed!.split(' ')[0]);
        // Neither side may be in check in the passed position -- the side to
        // move being safe is incidental, the side *not* to move being safe is
        // the whole reason the pass was allowed.
        expect(isInCheck(board, 'w')).toBe(false);
        expect(isInCheck(board, 'b')).toBe(false);
    });

    it('passes twice back to where it started, board and clock intact', () => {
        const once = passMoveFen(`${START_FEN} w - - 5 3`);
        const twice = passMoveFen(once!);
        expect(twice).toBe(`${START_FEN} w - - 5 4`);
    });
});
