import { describe, expect, it } from 'vitest';
import {
    createRepetitionAnalyzer,
    describeRepetition,
    formatRepetitionHeadline,
    formatRepetitionRule,
    positionKey,
    shouldReportRepetition,
    type RepetitionPly,
} from './repetition';
import {
    START_FEN,
    isInCheck,
    parseFenBoard,
    validateMoveStr,
    type BoardState,
    type Side,
} from './xiangqi';

/**
 * Replay a line into the ply records repetition reads, refusing anything the
 * rules refuse.
 *
 * Validating here rather than moving pieces blindly is the point: the first
 * draft of these fixtures left the two generals facing down an open file, so
 * every position was a check and every cycle looked perpetual. A fixture that
 * cannot occur teaches nothing.
 */
function play(startFen: string, moves: string[]): { root: BoardState; rootSide: Side; line: RepetitionPly[] } {
    const [placement, sideChar] = startFen.trim().split(/\s+/);
    const root = parseFenBoard(placement);
    const rootSide: Side = sideChar === 'b' ? 'b' : 'w';
    let board = root;
    let side = rootSide;
    const line: RepetitionPly[] = [];
    for (const uci of moves) {
        const result = validateMoveStr(uci, board, side);
        if (!result.ok || !result.mv) throw new Error(`illegal move ${uci} for ${side}: ${result.reason}`);
        const mv = result.mv;
        const next = board.map((row) => row.slice());
        next[mv.toRank][mv.toFile] = board[mv.fromRank][mv.fromFile];
        next[mv.fromRank][mv.fromFile] = '';
        const nextSide: Side = side === 'w' ? 'b' : 'w';
        line.push({ board: next, sideToMove: nextSide, inCheck: isInCheck(next, nextSide) });
        board = next;
        side = nextSide;
    }
    return { root, rootSide, line };
}

function report(startFen: string, moves: string[]) {
    const { root, rootSide, line } = play(startFen, moves);
    return describeRepetition(root, rootSide, line);
}

describe('what counts as the same position', () => {
    it('ignores the move counters, which differ on every visit', () => {
        const board = parseFenBoard(START_FEN);
        expect(positionKey(board, 'w')).toBe(positionKey(board, 'w'));
        expect(positionKey(board, 'w').split(' ')).toHaveLength(2);
    });

    it('treats the same pieces with the other side to move as a different position', () => {
        const board = parseFenBoard(START_FEN);
        expect(positionKey(board, 'w')).not.toBe(positionKey(board, 'b'));
    });
});

describe('a quiet shuffle', () => {
    // A red chariot walks out and back while the black general steps sideways
    // in its palace. A red soldier on e5 keeps the two generals off the same
    // open file, so nothing here is a check.
    const SHUFFLE = '4k4/9/9/9/4P4/9/9/9/9/R3K3R w';
    const out = ['a0a1', 'e9d9'];
    const back = ['a1a0', 'd9e9'];

    it('does not report the first time round', () => {
        const first = report(SHUFFLE, [...out, ...back]);
        expect(first.occurrences).toBe(2);
        expect(first.verdict).toBe('unforced');
        expect(shouldReportRepetition(first)).toBe(false);
    });

    it('reports once the position has stood three times', () => {
        const third = report(SHUFFLE, [...out, ...back, ...out, ...back]);
        expect(third.occurrences).toBe(3);
        expect(third.verdict).toBe('unforced');
        expect(third.mustVary).toBeNull();
        expect(shouldReportRepetition(third)).toBe(true);
    });

    it('says it is a draw without claiming to have ruled out a chase', () => {
        const third = report(SHUFFLE, [...out, ...back, ...out, ...back]);
        expect(formatRepetitionHeadline(third)).toBe('Position repeated 3 times');
        expect(formatRepetitionRule(third)).toContain('draw');
        expect(formatRepetitionRule(third)).toContain('chasing');
    });
});

describe('perpetual check', () => {
    /**
     * Red chariot on e1 checks the black general up the empty e file. The
     * general steps to f9, the chariot follows to f1 and checks again, the
     * general returns, the chariot returns -- four plies, back where it
     * started, and both red moves were checks.
     *
     * The red general sits on d0 rather than e0 so that the black general
     * returning to e9 is not walking into a flying general, which would make
     * the third move illegal and the cycle impossible.
     */
    const PERPETUAL = '4k4/9/9/9/9/9/9/9/4R4/3K5 b';
    const CYCLE = ['e9f9', 'e1f1', 'f9e9', 'f1e1'];

    it('sees a check on every red move of the cycle', () => {
        const { line } = play(PERPETUAL, CYCLE);
        const redMoves = line.filter((ply) => ply.sideToMove === 'b');
        expect(redMoves).toHaveLength(2);
        expect(redMoves.every((ply) => ply.inCheck)).toBe(true);
    });

    it('names the side that is checking and says it has to vary', () => {
        const result = report(PERPETUAL, CYCLE);
        expect(result.occurrences).toBe(2);
        expect(result.verdict).toBe('red-perpetual-check');
        expect(result.mustVary).toBe('w');
    });

    it('is worth saying at once, rather than waiting for a third visit', () => {
        // The player it binds needs to know before they repeat into a loss.
        const result = report(PERPETUAL, CYCLE);
        expect(shouldReportRepetition(result)).toBe(true);
    });

    it('says the rule out loud, naming the side it binds', () => {
        const result = report(PERPETUAL, CYCLE);
        expect(formatRepetitionHeadline(result)).toBe('Red is checking perpetually');
        expect(formatRepetitionRule(result)).toContain('loss for the checking side');
        expect(formatRepetitionRule(result)).toContain('Red has to vary');
    });

    it('measures the cycle since the last visit, not the whole game', () => {
        // A quiet lap first, then the checking lap. The quiet moves are outside
        // the cycle and must not dilute it.
        const result = report(PERPETUAL, [...CYCLE, ...CYCLE]);
        expect(result.occurrences).toBe(3);
        expect(result.verdict).toBe('red-perpetual-check');
    });
});

describe('classifying a cycle', () => {
    // Built directly rather than replayed: these are statements about how the
    // cycle is read, and the board they came from does not matter.
    const board = parseFenBoard(START_FEN);
    const ply = (mover: Side, inCheck: boolean): RepetitionPly => ({
        board,
        sideToMove: mover === 'w' ? 'b' : 'w',
        inCheck,
    });

    it('stops calling it perpetual as soon as one move in the cycle is quiet', () => {
        // Exactly the out the rules give the checker: vary once.
        const line = [ply('w', true), ply('b', false), ply('w', false), ply('b', false)];
        expect(describeRepetition(board, 'w', line).verdict).toBe('unforced');
    });

    it('reads a cycle where both sides check throughout as mutual, and drawn', () => {
        const line = [ply('w', true), ply('b', true), ply('w', true), ply('b', true)];
        const result = describeRepetition(board, 'w', line);
        expect(result.verdict).toBe('mutual-perpetual-check');
        expect(result.mustVary).toBeNull();
        expect(formatRepetitionRule(result)).toContain('draw');
    });

    it('binds black when black is the one checking', () => {
        const line = [ply('w', false), ply('b', true), ply('w', false), ply('b', true)];
        const result = describeRepetition(board, 'w', line);
        expect(result.verdict).toBe('black-perpetual-check');
        expect(result.mustVary).toBe('b');
        expect(formatRepetitionHeadline(result)).toBe('Black is checking perpetually');
    });
});

describe('nothing to report', () => {
    it('reports a single occurrence for a fresh position', () => {
        const fresh = report(`${START_FEN} w`, ['h2e2']);
        expect(fresh.occurrences).toBe(1);
        expect(fresh.verdict).toBe('unforced');
        expect(shouldReportRepetition(fresh)).toBe(false);
    });

    it('reports the root position itself as a single occurrence', () => {
        const board = parseFenBoard(START_FEN);
        const result = describeRepetition(board, 'w', []);
        expect(result.occurrences).toBe(1);
        expect(shouldReportRepetition(result)).toBe(false);
    });
});


describe('reusing immutable board snapshots', () => {
    it('matches uncached reports through navigation, branches and a new root', () => {
        const analyze = createRepetitionAnalyzer();
        for (const [fen, moves] of [
            [`${START_FEN} w`, ['a0a1', 'a9a8', 'a1a0', 'a8a9', 'a0a1', 'a9a8', 'a1a0', 'a8a9']],
            ['4k4/9/9/9/9/9/9/9/4R4/3K5 b', ['e9f9', 'e1f1', 'f9e9', 'f1e1']],
        ] as [string, string[]][]) {
            const { root, rootSide, line } = play(fen, moves);
            for (const end of [line.length, 0, 2, 1, line.length - 1, line.length]) {
                const prefix = line.slice(0, end);
                expect(analyze(root, rootSide, prefix)).toEqual(describeRepetition(root, rootSide, prefix));
            }
            const alternate = play(fen, moves.slice(0, 2)).line;
            expect(analyze(root, rootSide, alternate)).toEqual(describeRepetition(root, rootSide, alternate));
        }
    });

    it('does not confuse turns or reuse verdicts after check flags change', () => {
        const root = parseFenBoard(START_FEN);
        const analyze = createRepetitionAnalyzer();
        const line: RepetitionPly[] = [
            { board: root, sideToMove: 'b', inCheck: true },
            { board: root, sideToMove: 'w', inCheck: false },
        ];
        expect(analyze(root, 'w', line)).toEqual({ occurrences: 2, verdict: 'red-perpetual-check', mustVary: 'w' });
        const quiet = line.map(ply => ({ ...ply, inCheck: false }));
        expect(analyze(root, 'w', quiet)).toEqual({ occurrences: 2, verdict: 'unforced', mustVary: null });
        expect(analyze(root, 'b', quiet)).toEqual(describeRepetition(root, 'b', quiet));
    });

    it('reads replacement boards and keeps the uncached API safe for mutable input', () => {
        const root = parseFenBoard(START_FEN);
        const analyze = createRepetitionAnalyzer();
        expect(analyze(root, 'w', [{ board: root, sideToMove: 'w', inCheck: false }]).occurrences).toBe(2);
        const changed = root.map(row => [...row]);
        changed[1][0] = changed[0][0]; changed[0][0] = '';
        const line: RepetitionPly[] = [{ board: changed, sideToMove: 'w', inCheck: false }];
        expect(analyze(root, 'w', line).occurrences).toBe(1);
        changed[0][0] = changed[1][0]; changed[1][0] = '';
        expect(describeRepetition(root, 'w', line).occurrences).toBe(2);
    });
});
