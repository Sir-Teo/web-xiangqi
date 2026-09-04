import { describe, expect, it } from 'vitest';
import {
    type SavedGame,
    normalizeSavedGame,
    normalizeSavedGames,
    normalizeSavedMoveTree,
} from './gameLibrary';

const MAX_SAVED_MOVES = 1024;

function game(overrides: Partial<Record<keyof SavedGame, unknown>> = {}) {
    return {
        id: 'g1',
        savedAt: 1_700_000_000_000,
        gameMode: 'PvP',
        moves: ['h2e2', 'h9g7'],
        ...overrides,
    };
}

describe('normalizing a saved game', () => {
    it('keeps a well-formed record and defaults the result', () => {
        const saved = normalizeSavedGame(game());
        expect(saved).toMatchObject({
            id: 'g1',
            gameMode: 'PvP',
            moves: ['h2e2', 'h9g7'],
            result: 'ongoing',
        });
    });

    it('refuses anything that is not a record', () => {
        for (const value of [null, undefined, 42, 'game', []]) {
            expect(normalizeSavedGame(value)).toBeNull();
        }
    });

    it('needs an id, a timestamp, a known mode, and something to show', () => {
        expect(normalizeSavedGame(game({ id: undefined }))).toBeNull();
        expect(normalizeSavedGame(game({ id: '' }))).toBeNull();
        expect(normalizeSavedGame(game({ savedAt: undefined }))).toBeNull();
        expect(normalizeSavedGame(game({ savedAt: 'yesterday' }))).toBeNull();
        expect(normalizeSavedGame(game({ savedAt: Number.NaN }))).toBeNull();
        expect(normalizeSavedGame(game({ gameMode: 'PvAlien' }))).toBeNull();
        expect(normalizeSavedGame(game({ moves: [] }))).toBeNull();
    });

    it('accepts a game with no moves when it has a tree or a custom start', () => {
        expect(normalizeSavedGame(game({ moves: [], moveTree: [{ uci: 'h2e2' }] }))).not.toBeNull();
        expect(normalizeSavedGame(game({
            moves: [],
            startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
        }))).not.toBeNull();
    });

    it('rejects a move list that is not a list of moves', () => {
        expect(normalizeSavedGame(game({ moves: 'h2e2' }))).toBeNull();
        expect(normalizeSavedGame(game({ moves: ['h2e2', 42] }))).toBeNull();
        expect(normalizeSavedGame(game({ moves: ['h2e2', 'not-a-move'] }))).toBeNull();
    });

    it('refuses a move list longer than the cap', () => {
        const tooMany = Array.from({ length: MAX_SAVED_MOVES + 1 }, () => 'h2e2');
        expect(normalizeSavedGame(game({ moves: tooMany }))).toBeNull();
    });

    it('keeps only results it knows', () => {
        expect(normalizeSavedGame(game({ result: 'red' }))?.result).toBe('red');
        expect(normalizeSavedGame(game({ result: 'draw' }))?.result).toBe('draw');
        expect(normalizeSavedGame(game({ result: 'red-ish' }))?.result).toBe('ongoing');
    });

    it('drops a label or opening that is not a string, and bounds long ones', () => {
        expect(normalizeSavedGame(game({ label: 42 }))?.label).toBeUndefined();
        const long = normalizeSavedGame(game({ label: 'x'.repeat(500) }))?.label;
        expect(long && long.length).toBeLessThanOrEqual(120);
    });

    it('drops a final evaluation that is not a finite number', () => {
        expect(normalizeSavedGame(game({ finalEval: 120 }))?.finalEval).toBe(120);
        expect(normalizeSavedGame(game({ finalEval: Number.NaN }))?.finalEval).toBeUndefined();
        expect(normalizeSavedGame(game({ finalEval: 'big' }))?.finalEval).toBeUndefined();
    });
});

describe('validating a stored start position', () => {
    const legal = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

    it('accepts a legal position', () => {
        expect(normalizeSavedGame(game({ startFen: legal }))?.startFen).toBe(legal);
    });

    it('rejects a position with the wrong number of generals', () => {
        expect(normalizeSavedGame(game({ startFen: '4k4/9/9/9/9/9/9/9/9/9 w - - 0 1' }))).toBeNull();
        expect(normalizeSavedGame(game({ startFen: '4k4/9/9/9/9/9/9/9/4K3K/9 w - - 0 1' }))).toBeNull();
    });

    it('rejects a general outside its palace', () => {
        expect(normalizeSavedGame(game({ startFen: '4k4/9/9/9/9/9/9/9/9/K8 w - - 0 1' }))).toBeNull();
    });

    it('rejects generals facing each other down an open file', () => {
        expect(normalizeSavedGame(game({ startFen: '3k5/9/9/9/9/9/9/9/9/3K5 w - - 0 1' }))).toBeNull();
    });

    it('rejects a position where the side not to move is already in check', () => {
        // Generals on different files so the flying-general rule is not what
        // decides these; a rook off to the side keeps the first one legal.
        expect(normalizeSavedGame(game({ startFen: '3k5/9/9/9/9/9/9/9/9/4K3R w - - 0 1' }))).not.toBeNull();
        // Same position, rook swung onto the black general's open file: Black
        // is in check with Red to move, which no legal position reaches.
        expect(normalizeSavedGame(game({ startFen: '3k5/9/9/9/9/9/9/9/9/3RK4 w - - 0 1' }))).toBeNull();
    });

    it('rejects a malformed FEN rather than throwing', () => {
        expect(normalizeSavedGame(game({ startFen: 'nonsense' }))).toBeNull();
        expect(normalizeSavedGame(game({ startFen: '4k4' }))).toBeNull();
        expect(normalizeSavedGame(game({ startFen: '4k4/9/9/9/9/9/9/9/9/4K4 x - - 0 1' }))).toBeNull();
    });
});

describe('what a review keeps through the library', () => {
    const reviewed = (keyMoment: Record<string, unknown>, annotation: Record<string, unknown>) => game({
        review: {
            summary: {
                totalMoves: 2,
                accuracy: 70,
                bestCount: 1, goodCount: 1, inaccuracyCount: 0, mistakeCount: 0, blunderCount: 0,
                reviewedAt: 1_700_000_000_000,
                lineSignature: 'h2e2 h9g7',
                keyMoments: [{
                    nodeId: 'n1', moveIndex: 0, jumpTarget: 0, ply: 1, side: 'red',
                    quality: 'blunder', swing: 400, winPercentLoss: 30,
                    evalBefore: 20, evalAfter: -380, playedMove: 'h2e2', note: 'x',
                    ...keyMoment,
                }],
            },
            annotations: [{
                nodeId: 'n1', moveIndex: 0, quality: 'blunder',
                evalScore: -380, swing: 400, winPercentLoss: 30,
                ...annotation,
            }],
        },
    });

    /**
     * Every field on a key moment is whitelisted here, so a new one does not
     * arrive for free. A review read back without its line showed the move the
     * engine preferred and not what it was for -- so the same review looked
     * different after a trip through the library than it did when it ran.
     */
    it('keeps the engine line on a key moment and on its annotation', () => {
        const normalized = normalizeSavedGame(reviewed(
            { bestMove: 'b0c2', bestLine: ['b0c2', 'b9c7', 'h0g2'] },
            { bestMove: 'b0c2', bestLine: ['b0c2', 'b9c7', 'h0g2'] },
        ));
        expect(normalized?.review?.summary.keyMoments[0].bestLine).toEqual(['b0c2', 'b9c7', 'h0g2']);
        expect(normalized?.review?.annotations[0].bestLine).toEqual(['b0c2', 'b9c7', 'h0g2']);
    });

    /** A line from a different search than the recommendation is not that move's line. */
    it('drops a line that does not start with the move it is filed under', () => {
        const normalized = normalizeSavedGame(reviewed(
            { bestMove: 'b0c2', bestLine: ['h2e2', 'h9g7'] },
            { bestMove: 'b0c2', bestLine: ['h2e2', 'h9g7'] },
        ));
        expect(normalized?.review?.summary.keyMoments[0].bestLine).toBeUndefined();
        expect(normalized?.review?.annotations[0].bestLine).toBeUndefined();
    });

    /** A review written before the field existed still loads. */
    it('reads a review that carries no line at all', () => {
        const normalized = normalizeSavedGame(reviewed({ bestMove: 'b0c2' }, { bestMove: 'b0c2' }));
        expect(normalized?.review?.summary.keyMoments).toHaveLength(1);
        expect(normalized?.review?.summary.keyMoments[0].bestLine).toBeUndefined();
    });

    it('does not let junk in a stored line reach a reader', () => {
        const normalized = normalizeSavedGame(reviewed(
            { bestMove: 'b0c2', bestLine: ['b0c2', 'not-a-move', 'h0g2'] },
            { bestMove: 'b0c2', bestLine: 'b0c2 b9c7' },
        ));
        expect(normalized?.review?.summary.keyMoments[0].bestLine).toEqual(['b0c2']);
        expect(normalized?.review?.annotations[0].bestLine).toBeUndefined();
    });
});

describe('normalizing a variation tree', () => {
    it('leaves an absent tree absent and rejects a non-array', () => {
        expect(normalizeSavedMoveTree(undefined)).toBeUndefined();
        expect(normalizeSavedMoveTree('tree')).toBeNull();
        expect(normalizeSavedMoveTree({ uci: 'h2e2' })).toBeNull();
    });

    it('keeps nesting and drops the children key when there are none', () => {
        const tree = normalizeSavedMoveTree([
            { uci: 'h2e2', children: [{ uci: 'h9g7' }] },
        ]);
        expect(tree).toEqual([{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }]);
        expect(normalizeSavedMoveTree([{ uci: 'h2e2', children: [] }])).toEqual([{ uci: 'h2e2' }]);
    });

    it('rejects a node without a usable move, at any depth', () => {
        expect(normalizeSavedMoveTree([{ uci: 'bogus' }])).toBeNull();
        expect(normalizeSavedMoveTree([{ uci: 'h2e2', children: [{ uci: 42 }] }])).toBeNull();
        expect(normalizeSavedMoveTree([{ uci: 'h2e2', children: 'h9g7' }])).toBeNull();
        expect(normalizeSavedMoveTree([null])).toBeNull();
    });

    it('refuses a tree with more nodes than the cap', () => {
        // One long chain, counted across the whole walk rather than per branch.
        let node: Record<string, unknown> = { uci: 'h2e2' };
        for (let depth = 0; depth < MAX_SAVED_MOVES + 5; depth += 1) {
            node = { uci: 'h2e2', children: [node] };
        }
        expect(normalizeSavedMoveTree([node])).toBeNull();
    });
});

describe('normalizing a list of games', () => {
    it('keeps the good ones and drops the rest', () => {
        const games = normalizeSavedGames([
            game(),
            game({ id: 'g2' }),
            null,
            game({ gameMode: 'Nope' }),
            'not a game',
        ]);
        expect(games.map(saved => saved.id)).toEqual(['g1', 'g2']);
    });

    it('reads a non-array as an empty library', () => {
        expect(normalizeSavedGames(null)).toEqual([]);
        expect(normalizeSavedGames({ games: [] })).toEqual([]);
    });
});

describe('the invariant every panel downstream relies on', () => {
    /** Every number anywhere in a value, with the path that reached it. */
    function nonFiniteNumbersIn(value: unknown, path = ''): string[] {
        if (typeof value === 'number') return Number.isFinite(value) ? [] : [path || '(root)'];
        if (!value || typeof value !== 'object') return [];
        return Object.entries(value as Record<string, unknown>)
            .flatMap(([key, child]) => nonFiniteNumbersIn(child, path ? `${path}.${key}` : key));
    }

    const withEveryNumberBroken = (bad: number) => ({
        id: 'g1',
        savedAt: Date.now(),
        gameMode: 'PvP',
        moves: ['h2e2', 'h9g7'],
        result: 'red',
        finalEval: bad,
        review: {
            summary: {
                totalMoves: 2,
                accuracy: bad,
                averageCentipawnLoss: bad,
                redAccuracy: bad,
                blackAccuracy: bad,
                redAverageCentipawnLoss: bad,
                blackAverageCentipawnLoss: bad,
                bestCount: 1, goodCount: 1, inaccuracyCount: 0, mistakeCount: 0, blunderCount: 0,
                reviewedAt: Date.now(),
                lineSignature: 'h2e2 h9g7',
                keyMoments: [{
                    nodeId: 'n1', moveIndex: 0, jumpTarget: 0, ply: 1, side: 'red',
                    quality: 'blunder', swing: bad, winPercentLoss: bad,
                    evalBefore: bad, evalAfter: bad, playedMove: 'h2e2', note: 'x',
                }],
                engine: { tier: 'high', baseDepth: bad, baseMoveTimeMs: bad },
            },
            annotations: [{
                nodeId: 'n1', moveIndex: 0, quality: 'blunder',
                evalScore: bad, swing: bad, winPercentLoss: bad,
            }],
        },
    });

    // Nine `typeof x === 'number'` checks across LibraryPanel and App render
    // these figures. That test narrows the type but admits NaN, so it is only
    // safe because nothing non-finite gets this far -- which is this.
    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'lets no %p reach a reader, anywhere in the record',
        (bad) => {
            const normalized = normalizeSavedGame(withEveryNumberBroken(bad));
            // Dropping the record entirely would also satisfy the invariant.
            if (normalized === null) return;
            expect(nonFiniteNumbersIn(normalized)).toEqual([]);
        }
    );

    it('would notice if the sweep stopped looking', () => {
        // A guard on the guard: the helper must actually find one.
        expect(nonFiniteNumbersIn({ a: { b: [1, Number.NaN] } })).toEqual(['a.b.1']);
        expect(nonFiniteNumbersIn({ a: 1, b: 'two' })).toEqual([]);
    });
});
