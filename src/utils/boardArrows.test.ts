import { describe, expect, it } from 'vitest';
import { buildBoardArrows, createBoardArrowSelector, type BoardArrow, type BoardArrowInput } from './boardArrows';

const sq = (file: number, rank: number) => ({ file, rank });
const userArrow: BoardArrow = { from: sq(0, 0), to: sq(0, 1), color: '#60a5fa', kind: 'user' };

function input(overrides: Partial<BoardArrowInput> = {}): BoardArrowInput {
    return {
        showArrows: true,
        lastMove: null,
        threatMove: null,
        hintMove: null,
        drillAsking: false,
        engineEnabled: true,
        analysisPvLines: [],
        spotlightPvIndex: null,
        spotlightPvLine: null,
        openingCandidates: [],
        assistMode: 'coach',
        userArrows: [],
        ...overrides,
    };
}

const kinds = (arrows: BoardArrow[]) => arrows.map((a) => a.kind);

describe('stable board-arrow selection', () => {
    it('reuses drawings across score updates and changes deeper in the PV', () => {
        const select = createBoardArrowSelector();
        const first = select(input({ analysisPvLines: [{ moves: ['h2e2', 'h9g7'] }] }));
        expect(select(input({ analysisPvLines: [{ moves: ['h2e2', 'b9c7', 'h0g2'] }] }))).toBe(first);
        expect(select(input({ analysisPvLines: [{ moves: ['b2e2'] }] }))).not.toBe(first);
    });
    it.each([
        { color: '#ff0000' }, { opacity: 0.3 }, { strokeWidth: 8 }, { kind: 'threat' as const },
        { from: sq(1, 0) }, { to: sq(1, 1) },
    ])('redraws changes in user-arrow appearance: %j', change => {
        const select = createBoardArrowSelector();
        const first = select(input({ userArrows: [userArrow] }));
        expect(select(input({ userArrows: [{ ...userArrow, ...change }] }))).not.toBe(first);
    });
    it('preserves paint order and refreshes spotlight styling', () => {
        const select = createBoardArrowSelector();
        const secondArrow = { ...userArrow, color: '#ff0000' };
        const first = select(input({ userArrows: [userArrow, secondArrow] }));
        expect(select(input({ userArrows: [secondArrow, userArrow] }))).not.toBe(first);
        const normal = select(input({ analysisPvLines: [{ moves: ['h2e2'] }] }));
        const focused = select(input({ analysisPvLines: [{ moves: ['h2e2'] }], spotlightPvIndex: 0, spotlightPvLine: { moves: ['h2e2'] } }));
        expect(focused).not.toBe(normal);
        expect(focused[0].kind).toBe('engine-focus');
    });
    it('keeps caches independent and does not mutate a previous drawing', () => {
        const select = createBoardArrowSelector(), other = createBoardArrowSelector();
        const first = select(input({ analysisPvLines: [{ moves: ['h2e2'] }] }));
        first.forEach(arrow => { Object.freeze(arrow.from); Object.freeze(arrow.to); Object.freeze(arrow); }); Object.freeze(first);
        expect(other(input({ analysisPvLines: [{ moves: ['h2e2'] }] }))).not.toBe(first);
        expect(select(input({ showArrows: false }))).toEqual([]);
        expect(select(input({ analysisPvLines: [{ moves: ['b2e2'] }] }))[0].from.file).toBe(1);
        expect(first[0].from.file).toBe(7);
    });
});

describe('buildBoardArrows', () => {
    it('draws nothing at all when arrows are off, the reader own arrows included', () => {
        const arrows = buildBoardArrows(input({
            showArrows: false,
            lastMove: { from: sq(7, 2), to: sq(4, 2), color: '#10b981' },
            threatMove: 'h2e2',
            userArrows: [userArrow],
        }));
        expect(arrows).toEqual([]);
    });

    it('draws the last move in the quality colour it was given', () => {
        const arrows = buildBoardArrows(input({ lastMove: { from: sq(7, 2), to: sq(4, 2), color: '#ef4444' } }));
        expect(arrows).toEqual([
            { from: sq(7, 2), to: sq(4, 2), color: '#ef4444', kind: 'last', opacity: 0.82, strokeWidth: 5 },
        ]);
    });

    it('draws a threat and a hint from their UCI moves', () => {
        const arrows = buildBoardArrows(input({ threatMove: 'h2e2', hintMove: 'b0c2' }));
        expect(kinds(arrows)).toEqual(['threat', 'engine-focus']);
        expect(arrows[0].from).toEqual(sq(7, 2));
        expect(arrows[0].to).toEqual(sq(4, 2));
        expect(arrows[1].from).toEqual(sq(1, 0));
        expect(arrows[1].to).toEqual(sq(2, 2));
    });

    it('ignores a move it cannot read rather than drawing a broken arrow', () => {
        expect(buildBoardArrows(input({ threatMove: 'zz99' }))).toEqual([]);
        expect(buildBoardArrows(input({ hintMove: '' }))).toEqual([]);
    });

    it('appends the reader own arrows after everything the app drew', () => {
        const arrows = buildBoardArrows(input({ threatMove: 'h2e2', userArrows: [userArrow] }));
        expect(kinds(arrows)).toEqual(['threat', 'user']);
    });

    describe('while a drill is asking', () => {
        const asking = input({
            drillAsking: true,
            lastMove: { from: sq(7, 2), to: sq(4, 2), color: '#10b981' },
            threatMove: 'b0c2',
            hintMove: 'b2e2',
            analysisPvLines: [{ moves: ['h0g2'] }, { moves: ['b0c2'] }],
            openingCandidates: [{ move: 'h2e2' }],
            spotlightPvLine: { moves: ['h0g2'] },
            spotlightPvIndex: 0,
            userArrows: [userArrow],
        });

        it('withholds every engine and book arrow, because a question with its answer drawn is not a question', () => {
            expect(kinds(buildBoardArrows(asking))).not.toContain('engine');
            expect(kinds(buildBoardArrows(asking))).not.toContain('book');
        });

        it('keeps what the reader had already asked to see', () => {
            expect(kinds(buildBoardArrows(asking))).toEqual(['last', 'threat', 'engine-focus', 'user']);
        });

        it('would have drawn those engine arrows if it were not asking', () => {
            // The guard on the guard: the same input with the drill idle has to
            // differ, or the assertions above pass for the wrong reason.
            expect(kinds(buildBoardArrows({ ...asking, drillAsking: false }))).toContain('engine');
        });
    });

    describe('the opening book', () => {
        const candidates = [{ move: 'h2e2' }, { move: 'b0c2' }, { move: 'h0g2' }, { move: 'b2e2' }];

        it('speaks when the engine has no move to show', () => {
            const arrows = buildBoardArrows(input({ openingCandidates: candidates }));
            expect(kinds(arrows)).toEqual(['book', 'book']);
        });

        it('stays quiet when the engine is already answering the same question', () => {
            const arrows = buildBoardArrows(input({ openingCandidates: candidates, analysisPvLines: [{ moves: ['h0g2'] }] }));
            expect(kinds(arrows)).toEqual(['engine']);
        });

        it('is not silenced by a line that has no first move', () => {
            const arrows = buildBoardArrows(input({ openingCandidates: candidates, analysisPvLines: [{ moves: [] }] }));
            expect(kinds(arrows)).toEqual(['book', 'book']);
        });

        it('shows three suggestions to pro and two to coach', () => {
            expect(buildBoardArrows(input({ openingCandidates: candidates, assistMode: 'pro' }))).toHaveLength(3);
            expect(buildBoardArrows(input({ openingCandidates: candidates, assistMode: 'coach' }))).toHaveLength(2);
        });

        it('draws the first suggestion strongly enough to read as the first', () => {
            const [first, second] = buildBoardArrows(input({ openingCandidates: candidates }));
            expect(first.opacity).toBeGreaterThan(second.opacity!);
            expect(first.strokeWidth).toBeGreaterThan(second.strokeWidth!);
            expect(first.color).not.toBe(second.color);
        });
    });

    describe('engine lines', () => {
        const lines = [{ moves: ['h2e2'] }, { moves: ['b0c2'] }, { moves: ['h0g2'] }, { moves: ['b2e2'] }];

        it('draws the best move and the next two alternatives, and no further', () => {
            const arrows = buildBoardArrows(input({ analysisPvLines: lines }));
            expect(arrows).toHaveLength(3);
            expect(arrows[0].strokeWidth).toBeGreaterThan(arrows[1].strokeWidth!);
        });

        it('leaves a spotlit line to be drawn once, in its own colour, last', () => {
            const arrows = buildBoardArrows(input({
                analysisPvLines: lines,
                spotlightPvIndex: 1,
                spotlightPvLine: lines[1],
            }));
            expect(kinds(arrows)).toEqual(['engine', 'engine', 'engine-focus']);
            // b0c2 is line 1: drawn as the focus, never as a muted alternative.
            const focus = arrows[arrows.length - 1];
            expect(focus.from).toEqual(sq(1, 0));
            expect(arrows.filter((a) => a.from.file === 1 && a.from.rank === 0)).toHaveLength(1);
        });

        it('skips the best-move arrow when the best move is the spotlit one', () => {
            const arrows = buildBoardArrows(input({
                analysisPvLines: lines,
                spotlightPvIndex: 0,
                spotlightPvLine: lines[0],
            }));
            expect(kinds(arrows)).toEqual(['engine', 'engine', 'engine-focus']);
            expect(arrows.filter((a) => a.from.file === 7 && a.from.rank === 2)).toHaveLength(1);
        });

        it('draws none of them when the engine is off, whatever lines are passed', () => {
            const arrows = buildBoardArrows(input({
                engineEnabled: false,
                analysisPvLines: lines,
                spotlightPvIndex: 1,
                spotlightPvLine: lines[1],
                openingCandidates: [{ move: 'b2e2' }],
            }));
            // The book is free to speak: there is no engine move to disagree with.
            expect(kinds(arrows)).toEqual(['book']);
        });
    });
});
