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
