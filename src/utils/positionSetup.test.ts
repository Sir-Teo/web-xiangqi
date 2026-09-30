import { describe, expect, it } from 'vitest';
import { describeFenProblem, describeSetupProblem, emptyBoard, readFenBoard, setupFen } from './positionSetup';
import { START_FEN, START_POSITION_FEN, parseFenBoard } from './xiangqi';

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

describe('describeFenProblem', () => {
    it('accepts what the loader accepts', () => {
        expect(describeFenProblem(START_POSITION_FEN)).toBeNull();
        expect(describeFenProblem('  3k5/9/9/9/9/9/9/9/9/4KR3 b - - 0 1  ')).toBeNull();
        // Two fields is the whole requirement; the clocks are optional.
        expect(describeFenProblem('3k5/9/9/9/9/9/9/9/9/4KR3 b')).toBeNull();
    });

    it('names the three things that go wrong before a board exists', () => {
        expect(describeFenProblem('')).toMatch(/A FEN is the pieces/);
        // The placement alone, which is what `START_FEN` is: a board and no side.
        expect(describeFenProblem(START_FEN)).toMatch(/A FEN is the pieces/);
        expect(describeFenProblem('not a position at all')).toMatch(/piece layout is unreadable/);
        expect(describeFenProblem('3k5/9/9/9/9/9/9/9/9/4KR3 x')).toBe('The side to move must be "w" or "b", not "x".');
    });

    it('clips a side field that is really a bad paste', () => {
        const pasted = 'w<!doctype-html-not-a-fen-at-all>';
        expect(describeFenProblem(`3k5/9/9/9/9/9/9/9/9/4KR3 ${pasted}`))
            .toBe('The side to move must be "w" or "b", not "w<!doctype-h…".');
    });

    it('hands on the reason the editor would have given', () => {
        expect(describeFenProblem('3k5/9/9/9/9/9/9/9/9/4K1R2 b - - 0 1')).toBeNull();
        // A soldier on its own half, off its starting file.
        expect(describeFenProblem('3k5/9/9/9/9/9/1P7/9/9/4K4 w - - 0 1'))
            .toMatch(/must be on its starting file/);
        expect(describeFenProblem('3k5/9/9/9/9/9/9/9/9/3K5 w - - 0 1'))
            .toMatch(/generals face each other/);
    });

    /**
     * Damaged input reaches this through a paste, so it must always come back
     * with one usable sentence rather than a throw, an empty string, or the
     * parser's own wording about ranks and files.
     *
     * Not compared against the loader here: since this change the loader's
     * gate *is* this function, so such a test would only be asking it whether
     * it agrees with itself. What checks the wiring is the browser gate, which
     * pastes a bad FEN into the New Game field and reads what the field says.
     */
    it('answers every damaged paste with one sentence', () => {
        const seeds = [
            START_POSITION_FEN,
            '3k5/9/9/9/9/9/9/9/9/4KR3 b - - 0 1',
            '3k5/9/9/9/9/9/1P7/9/9/4K4 w - - 0 1',
            '3k5/9/9/9/9/9/9/9/9/3K5 w - - 0 1',
        ];
        const cases = new Set<string>([...seeds, '', 'not a position at all', '   ']);
        // Every single-character deletion and a digit inserted at each
        // position: enough damage to reach ranks that are short, long, or not
        // there at all, and side fields that are neither letter.
        for (const seed of seeds) {
            for (let i = 0; i < seed.length; i += 1) {
                cases.add(seed.slice(0, i) + seed.slice(i + 1));
                cases.add(`${seed.slice(0, i)}9${seed.slice(i)}`);
            }
        }
        const bad: string[] = [];
        for (const fen of cases) {
            let said: string | null;
            try {
                said = describeFenProblem(fen);
            } catch (error) {
                bad.push(`${JSON.stringify(fen)} threw ${error}`);
                continue;
            }
            if (said === null) continue;
            if (!said.trim() || !said.endsWith('.') || said.length > 120) {
                bad.push(`${JSON.stringify(fen)} -> ${JSON.stringify(said)}`);
            }
            // The parser's own wording, which counts from zero and says
            // "FEN board must contain 10 ranks", must not reach a reader.
            if (/FEN (board|rank)/.test(said)) bad.push(`${JSON.stringify(fen)} leaked the parser: ${said}`);
        }
        expect(bad).toEqual([]);
        expect(cases.size).toBeGreaterThan(300);
    });

    it('is the same verdict the editor shows for a board it can read', () => {
        // Two readers of "is this position legal": one from a FEN string, one
        // from a board the editor built. They must not disagree.
        for (const fen of [
            START_POSITION_FEN,
            '3k5/9/9/9/9/9/9/9/9/4KR3 b - - 0 1',
            '3k5/9/9/9/9/9/1P7/9/9/4K4 w - - 0 1',
            '3k5/9/9/9/9/9/9/9/9/3K5 w - - 0 1',
            '4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1',
            'C3k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1',
        ]) {
            const [placement, side] = fen.split(' ');
            expect(describeFenProblem(fen)).toBe(describeSetupProblem(parseFenBoard(placement), side as 'w' | 'b'));
        }
    });
});

describe('readFenBoard', () => {
    it('draws the board behind a FEN that breaks a rule of the game', () => {
        // The point of the function: these are all refused, and all showable.
        for (const [fen, pieces] of [
            ['3k5/9/9/9/9/9/9/9/9/3K5 w - - 0 1', 2],
            ['3k5/9/9/9/9/9/1P7/9/9/4K4 w - - 0 1', 3],
            ['4k4/4R4/9/9/9/9/9/9/9/4K4 w - - 0 1', 3],
        ] as const) {
            expect(describeFenProblem(fen)).not.toBeNull();
            const read = readFenBoard(fen);
            expect(read, fen).not.toBeNull();
            expect(read!.board.flat().filter(Boolean)).toHaveLength(pieces);
        }
    });

    it('has nothing to draw when the layout itself will not parse', () => {
        expect(readFenBoard('not a position at all')).toBeNull();
        expect(readFenBoard('')).toBeNull();
        expect(readFenBoard('   ')).toBeNull();
        expect(readFenBoard('3k5/9/9/9/9/9/9/9/9')).toBeNull();
        expect(readFenBoard('3k5/9/9/9/9/9/9/9/9/4KZ3 w')).toBeNull();
    });

    it('falls back to Red when the side field is the unreadable part', () => {
        // The editor has a toggle for the side; it has nothing for no board.
        expect(readFenBoard('3k5/9/9/9/9/9/9/9/9/4K4 xyz')?.sideToMove).toBe('w');
        expect(readFenBoard('3k5/9/9/9/9/9/9/9/9/4K4')?.sideToMove).toBe('w');
        expect(readFenBoard('3k5/9/9/9/9/9/9/9/9/4K4 b')?.sideToMove).toBe('b');
    });

    it('reads the same board the legality check judged', () => {
        // Two readers of one string; if they part company the editor opens on
        // a different position from the one that was refused.
        const fen = '3k5/9/9/9/9/9/1P7/9/9/4K4 w - - 0 1';
        const read = readFenBoard(fen)!;
        expect(describeSetupProblem(read.board, read.sideToMove)).toBe(describeFenProblem(fen));
    });
});

describe('FEN move counters', () => {
    const layout = START_POSITION_FEN.split(' ')[0];
    it.each(['-12', '1.5', 'Infinity', 'NaN', '1e3', '0x10', '1000001', '9007199254740993'])('rejects invalid counters %s instead of silently resetting them', token => {
        expect(describeFenProblem(`${layout} w - - ${token} 1`)).toMatch(/halfmove clock/);
        expect(describeFenProblem(`${layout} w - - 0 ${token}`)).toMatch(/fullmove number/);
    });
    it('requires positive fullmove numbers and permits omitted counters', () => {
        expect(describeFenProblem(`${layout} w - - 0 0`)).toMatch(/fullmove number/);
        for (const suffix of ['w', 'w - -', 'w - - 0 1', 'b - - 999999 1000000']) {
            expect(describeFenProblem(`${layout} ${suffix}`)).toBeNull();
        }
    });
});
