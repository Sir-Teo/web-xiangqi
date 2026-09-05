import { describe, expect, it } from 'vitest';
import {
    DHTMLXQ_START_BINIT,
    boardFromBinit,
    isDhtmlXqRecord,
    movesFromMovelist,
    parseDhtmlXqRecord,
} from './dhtmlxq';
import { START_FEN, parseFenBoard, validateMoveStr, type BoardState, type Side } from './xiangqi';

/**
 * The movelist a dpxq.com game page carries, quoted from one. Replaying it
 * through the rules engine is the only test worth having: a wrong axis, a
 * wrong origin or a wrong direction all produce a move the rules refuse
 * within a ply or two.
 */
const MOVELIST = '26256364192770621707102209190010694720421915808179671202151022108988811188581114585510226665646555656254273554356535232406052425352514242524422477870205878372428303223407084246674634460848466748436786';

function replay(moves: string[], startFen = `${START_FEN} w`) {
    const [placement, side] = startFen.split(/\s+/);
    let board: BoardState = parseFenBoard(placement);
    let toMove: Side = side === 'b' ? 'b' : 'w';
    for (const [index, uci] of moves.entries()) {
        const result = validateMoveStr(uci, board, toMove);
        if (!result.ok) throw new Error(`move ${index + 1} ${uci} refused: ${result.reason}`);
        const next = board.map((row) => [...row]);
        next[result.mv!.toRank][result.mv!.toFile] = result.piece!;
        next[result.mv!.fromRank][result.mv!.fromFile] = '';
        board = next;
        toMove = toMove === 'w' ? 'b' : 'w';
    }
    return board;
}

describe('the movelist', () => {
    it('reads four digits as one move, x from the left and y from the top', () => {
        // 兵七进一, the most played first move, then a black soldier answering it.
        expect(movesFromMovelist('26256364')).toEqual(['c3c4', 'g6g5']);
    });

    it('replays a whole game from a dpxq.com page through the rules engine', () => {
        const moves = movesFromMovelist(MOVELIST);
        expect(moves.length).toBe(MOVELIST.length / 4);
        expect(() => replay(moves)).not.toThrow();
    });

    it('stops at the first pair that is not a square', () => {
        expect(movesFromMovelist('2625x364')).toEqual(['c3c4']);
        expect(movesFromMovelist('262')).toEqual([]);
    });
});

describe('the start position', () => {
    it('reads the opening array back as the opening array', () => {
        expect(boardFromBinit(DHTMLXQ_START_BINIT)).toEqual(parseFenBoard(START_FEN));
    });

    it('leaves out a piece written as 99 and refuses a board without both generals', () => {
        // Red with only its general and a chariot, Black with only its general.
        const digits = Array(32).fill('99');
        digits[0] = '89'; // red chariot i0
        digits[4] = '49'; // red general e0
        digits[20] = '40'; // black general e9
        const board = boardFromBinit(digits.join(''));
        expect(board?.[0][8]).toBe('R');
        expect(board?.[0][4]).toBe('K');
        expect(board?.[9][4]).toBe('k');
        expect(board?.flat().filter(Boolean).length).toBe(3);

        digits[20] = '99';
        expect(boardFromBinit(digits.join(''))).toBeNull();
    });

    it('refuses anything that is not 64 digits, or two pieces on one point', () => {
        expect(boardFromBinit('123')).toBeNull();
        expect(boardFromBinit(`89${DHTMLXQ_START_BINIT.slice(2, 62)}89`)).toBeNull();
    });
});

describe('a whole record', () => {
    const record = [
        '[DhtmlXQ]',
        '[DhtmlXQ_title]Test game[/DhtmlXQ_title]',
        `[DhtmlXQ_binit]${DHTMLXQ_START_BINIT}[/DhtmlXQ_binit]`,
        `[DhtmlXQ_movelist]${MOVELIST}[/DhtmlXQ_movelist]`,
        '[DhtmlXQ_comment0]Before the game.[/DhtmlXQ_comment0]',
        '[DhtmlXQ_comment3]A quiet move,||with a second line.[/DhtmlXQ_comment3]',
        '[/DhtmlXQ]',
    ].join('\n');

    it('is recognised by its tags', () => {
        expect(isDhtmlXqRecord(record)).toBe(true);
        expect(isDhtmlXqRecord('1. C2=5 H8+7')).toBe(false);
        expect(parseDhtmlXqRecord('1. C2=5 H8+7')).toBeNull();
    });

    it('carries the moves, the title and the notes, and no FEN for the opening array', () => {
        const parsed = parseDhtmlXqRecord(record);
        expect(parsed?.moves.length).toBe(MOVELIST.length / 4);
        expect(parsed?.startFen).toBeUndefined();
        expect(parsed?.title).toBe('Test game');
        expect(parsed?.comments.get(0)).toBe('Before the game.');
        expect(parsed?.comments.get(3)).toBe('A quiet move,\nwith a second line.');
    });

    it('takes the side to move from the first move of a set-up position', () => {
        const digits = Array(32).fill('99');
        digits[0] = '89'; // red chariot i0
        digits[4] = '49'; // red general e0
        digits[20] = '30'; // black general d9, off Red's file
        digits[16] = '00'; // black chariot a9
        const binit = digits.join('');
        // Black's chariot moves first: a9 to a8 is (0,0) to (0,1).
        const black = parseDhtmlXqRecord(`[DhtmlXQ_binit]${binit}[/DhtmlXQ_binit][DhtmlXQ_movelist]0001[/DhtmlXQ_movelist]`);
        expect(black?.startFen).toMatch(/ b - - 0 1$/);
        expect(black?.moves).toEqual(['a9a8']);
        expect(() => replay(black!.moves, black!.startFen)).not.toThrow();

        // A diagram with no moves is Red to move.
        const diagram = parseDhtmlXqRecord(`[DhtmlXQ_binit]${binit}[/DhtmlXQ_binit]`);
        expect(diagram?.moves).toEqual([]);
        expect(diagram?.startFen).toMatch(/ w - - 0 1$/);
    });

    it('is nothing without either a position or a move', () => {
        expect(parseDhtmlXqRecord('[DhtmlXQ_movelist][/DhtmlXQ_movelist]')).toBeNull();
    });
});
