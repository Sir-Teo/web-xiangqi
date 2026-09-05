import { describe, expect, it } from 'vitest';
import {
    AI_DEPTH_LIMIT,
    AI_STRENGTH_LABELS,
    type AiCandidateLine,
    type AiStrength,
    WORKER_SAFE_MAX_DEPTH,
    chooseAiMoveFromPv,
    FULL_STRENGTH_DEPTH,
    FULL_STRENGTH_MOVE_TIME_MS,
    buildAiGoCommand,
    describeAiStrength,
    getAiSearchConfig,
    isAiStrength,
} from './aiOpponent';

const STRENGTHS: AiStrength[] = [1, 2, 3, 4, 5, 6];
/** The rungs held under the worker-safe depth; Full strength is budgeted by time instead. */
const LADDER: AiStrength[] = [1, 2, 3, 4, 5];

function line(move: string, score: number, multipv: number, searchTag: string | null = 'tag'): AiCandidateLine {
    return { moves: [move], score, multipv, searchTag };
}

function choose(strength: AiStrength, pvLines: AiCandidateLine[], random = () => 0) {
    return chooseAiMoveFromPv({
        fallbackMove: 'h2e2',
        fallbackScore: 100,
        pvLines,
        searchTag: 'tag',
        strength,
        random,
    });
}

describe('strength settings', () => {
    it('recognises only the six strengths', () => {
        for (const value of STRENGTHS) expect(isAiStrength(value)).toBe(true);
        for (const value of [0, 7, '3', null, undefined, 2.5]) expect(isAiStrength(value)).toBe(false);
    });

    it('gets harder as the strength rises', () => {
        const depths = STRENGTHS.map(s => AI_DEPTH_LIMIT[s]);
        for (let i = 1; i < depths.length; i += 1) {
            expect(depths[i]).toBeGreaterThan(depths[i - 1]);
        }
    });

    it('never asks for more depth than the worker can take', () => {
        for (const strength of LADDER) {
            expect(getAiSearchConfig(strength, WORKER_SAFE_MAX_DEPTH).depth)
                .toBeLessThanOrEqual(WORKER_SAFE_MAX_DEPTH);
        }
    });

    it('respects a device that can only manage a shallow search', () => {
        for (const strength of LADDER) {
            const config = getAiSearchConfig(strength, 3);
            expect(config.depth).toBeLessThanOrEqual(3);
            expect(config.depth).toBeGreaterThanOrEqual(1);
        }
    });

    it('never asks for a depth below one, however odd the budget', () => {
        for (const strength of STRENGTHS) {
            expect(getAiSearchConfig(strength, 0).depth).toBeGreaterThanOrEqual(1);
            expect(getAiSearchConfig(strength, -5).depth).toBeGreaterThanOrEqual(1);
        }
    });

    it('describes each strength in terms a player can read', () => {
        for (const strength of STRENGTHS) {
            const text = describeAiStrength(strength);
            expect(text).toContain(AI_STRENGTH_LABELS[strength]);
            expect(text).toMatch(/depth \d+/);
        }
        expect(describeAiStrength(5)).toContain('best move only');
        expect(describeAiStrength(1)).toContain('candidate moves');
    });
});

describe('full strength', () => {
    it('is budgeted by time, with the depth ceiling past what the time reaches', () => {
        const config = getAiSearchConfig(6, WORKER_SAFE_MAX_DEPTH);
        expect(config.depth).toBe(FULL_STRENGTH_DEPTH);
        expect(config.depth).toBeGreaterThan(WORKER_SAFE_MAX_DEPTH);
        expect(config.moveTimeMs).toBe(FULL_STRENGTH_MOVE_TIME_MS);
        expect(config.multiPv).toBe(1);
        expect(buildAiGoCommand(config)).toBe(`go depth ${FULL_STRENGTH_DEPTH} movetime ${FULL_STRENGTH_MOVE_TIME_MS}`);
    });

    it('is the only rung that sets a time', () => {
        for (const strength of LADDER) {
            const config = getAiSearchConfig(strength, WORKER_SAFE_MAX_DEPTH);
            expect(config.moveTimeMs).toBeUndefined();
            expect(buildAiGoCommand(config)).toBe(`go depth ${config.depth}`);
        }
    });

    it('says how long a move takes, which is what the player will notice', () => {
        expect(describeAiStrength(6)).toContain('4s a move');
        expect(describeAiStrength(6)).toContain('best move only');
    });
});

describe('the strongest settings play the best move', () => {
    it('takes the engine best move without considering alternatives', () => {
        for (const strength of [4, 5, 6] as AiStrength[]) {
            const choice = choose(strength, [line('b0c2', 120, 1), line('b2e2', 90, 2)], () => 0.99);
            expect(choice.move).toBe('h2e2');
            expect(choice.source).toBe('bestmove');
        }
    });

    it('falls back to the principal variation if the best move is unusable', () => {
        const choice = chooseAiMoveFromPv({
            fallbackMove: 'garbage',
            fallbackScore: 100,
            pvLines: [line('b0c2', 120, 1)],
            searchTag: 'tag',
            strength: 5,
            random: () => 0,
        });
        expect(choice.move).toBe('b0c2');
        expect(choice.source).toBe('pv');
    });
});

describe('weaker settings pick among candidates', () => {
    const lines = [line('a0a1', 100, 1), line('b0b1', 60, 2), line('c0c1', 20, 3)];

    it('takes the top candidate when the roll is low', () => {
        expect(choose(1, lines, () => 0).move).toBe('a0a1');
    });

    it('reaches a weaker candidate when the roll is high', () => {
        expect(choose(1, lines, () => 0.99).move).not.toBe('a0a1');
    });

    it('gets more likely to play the best move as strength rises', () => {
        // Weights are shared out over the candidates actually present, not
        // normalised to 1, so the roll that reaches past the top move differs
        // per strength: 0.45/0.85 at strength 1, 0.84/1.0 at strength 3.
        const roll = () => 0.6;
        expect(choose(3, lines, roll).move).toBe('a0a1');
        expect(choose(1, lines, roll).move).not.toBe('a0a1');
    });

    it('refuses a candidate that gives away more than the setting allows', () => {
        // 250 below the best: inside strength 1's 500 tolerance, outside
        // strength 3's 140.
        const wide = [line('a0a1', 100, 1), line('b0b1', 60, 2), line('c0c1', -150, 3)];

        const atStrength3 = new Set(
            Array.from({ length: 40 }, (_, i) => choose(3, wide, () => i / 40).move)
        );
        expect(atStrength3.has('c0c1')).toBe(false);

        const atStrength1 = new Set(
            Array.from({ length: 40 }, (_, i) => choose(1, wide, () => i / 40).move)
        );
        expect(atStrength1.has('c0c1')).toBe(true);
    });

    it('never plays a move the engine did not offer', () => {
        const offered = new Set(['a0a1', 'b0b1', 'c0c1', 'h2e2']);
        for (let i = 0; i < 50; i += 1) {
            expect(offered.has(choose(1, lines, () => i / 50).move)).toBe(true);
        }
    });
});

describe('reading the engine output', () => {
    it('ignores lines from a stale search', () => {
        const stale = [line('a0a1', 100, 1, 'old'), line('b0b1', 95, 2, 'old')];
        expect(choose(1, stale).move).toBe('h2e2');
    });

    it('ignores lines whose move is not a move', () => {
        expect(choose(1, [line('not-a-move', 100, 1), line('b0c2', 95, 2)]).move).toBe('b0c2');
    });

    it('does not offer the same move twice', () => {
        const duplicated = [line('a0a1', 100, 1), line('a0a1', 95, 2), line('b0b1', 90, 3)];
        const chosen = new Set(
            Array.from({ length: 20 }, (_, i) => choose(1, duplicated, () => i / 20).move)
        );
        expect(chosen).toEqual(new Set(['a0a1', 'b0b1']));
    });

    it('orders candidates by multipv rather than arrival', () => {
        const outOfOrder = [line('d0d1', 60, 2), line('e0e1', 100, 1)];
        expect(choose(1, outOfOrder, () => 0).move).toBe('e0e1');
    });

    it('falls back when the engine offered nothing usable', () => {
        expect(choose(1, []).move).toBe('h2e2');
        expect(choose(1, [line('nope', 100, 1)]).move).toBe('h2e2');
    });

    it('stays inside the candidate list at the extremes of the roll', () => {
        const lines = [line('a0a1', 100, 1), line('b0b1', 80, 2)];
        for (const random of [() => 0, () => 0.5, () => 1, () => 1.5, () => -1, () => Number.NaN]) {
            expect(['a0a1', 'b0b1']).toContain(choose(1, lines, random).move);
        }
    });
});

describe('the strength label and the opponent it describes', () => {
    it('promises exactly what the opponent plays', () => {
        // These disagreed. `describeAiStrength` reports the ladder, while the
        // engine was handed `min(searchDepth, ...)` -- and with the analysis
        // Search Depth preference defaulting to 8, "Hard" and "Master" both
        // played depth 8 against tooltips promising 9 and 12. The top two rungs
        // were the same opponent.
        for (const strength of [1, 2, 3, 4, 5] as const) {
            const played = getAiSearchConfig(strength, WORKER_SAFE_MAX_DEPTH).depth;
            expect(describeAiStrength(strength)).toContain(`depth ${played}`);
            expect(played).toBe(AI_DEPTH_LIMIT[strength]);
        }
    });

    it('keeps every rung of the ladder a different opponent', () => {
        const depths = ([1, 2, 3, 4, 5] as const).map((s) => getAiSearchConfig(s, WORKER_SAFE_MAX_DEPTH).depth);
        expect(new Set(depths).size).toBe(depths.length);
        for (let i = 1; i < depths.length; i += 1) expect(depths[i]).toBeGreaterThan(depths[i - 1]);
    });
});

describe('the promise the strength label makes', () => {
    /**
     * The suite above already pins that the strongest settings play the
     * engine's move. What nothing pinned is the other direction: that the
     * levels *advertised* as "best move only" are exactly the levels that
     * behave that way.
     *
     * `describeAiStrength` writes that sentence into the settings from the
     * multi-PV limit, and the behaviour comes from an early return keyed to
     * the same limit. They agree today. A level whose limit is raised so its
     * candidate lines can be shown would change the sentence and the
     * behaviour together -- which is fine -- but a level given candidates
     * while something upstream still forces the top one would be advertised
     * as choosing and never choose.
     *
     * It is also the honest answer to a mutation sweep over this file.
     * Handing Master a 500-centipawn blunder allowance, or giving Hard a
     * beginner's weights, changes nothing observable: both return before
     * either value is read. Those survivors are equivalent mutants rather
     * than gaps, and the limit is what actually carries the promise.
     */
    /**
     * Close together on purpose. A level that offers candidates still refuses
     * ones far enough below the best -- Medium's allowance is 140 centipawns
     * -- so alternatives written as blunders would be filtered out and every
     * level would look like "best move only" for the wrong reason.
     */
    const OFFERED: AiCandidateLine[] = [
        { score: 120, moves: ['h2e2'], multipv: 1, searchTag: null },
        { score: 90, moves: ['b0c2'], multipv: 2, searchTag: null },
        { score: 60, moves: ['a0a1'], multipv: 3, searchTag: null },
        { score: 30, moves: ['i0i1'], multipv: 4, searchTag: null },
        { score: 0, moves: ['e3e4'], multipv: 5, searchTag: null },
    ];

    const STRENGTHS: AiStrength[] = [1, 2, 3, 4, 5, 6];

    it('plays only the best move at every level that says so, however tempting the rest', () => {
        for (const strength of STRENGTHS) {
            if (!describeAiStrength(strength).includes('best move only')) continue;
            // Every corner of the random draw, so a weighted pick over the
            // offered lines could not agree by luck.
            for (const draw of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999]) {
                const choice = chooseAiMoveFromPv({
                    fallbackMove: 'h2e2',
                    fallbackScore: 120,
                    pvLines: OFFERED,
                    searchTag: null,
                    strength,
                    random: () => draw,
                });
                expect(
                    choice.move,
                    `${AI_STRENGTH_LABELS[strength]} says "best move only" but played ${choice.move} at draw ${draw}`
                ).toBe('h2e2');
            }
        }
    });

    it('says "best move only" for exactly the levels that behave that way', () => {
        // The other direction: a level that always returns the best move but
        // is advertised as choosing between candidates is the same defect
        // wearing the other face.
        for (const strength of STRENGTHS) {
            const saysBestOnly = describeAiStrength(strength).includes('best move only');
            const drawn = new Set(
                [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((draw) => chooseAiMoveFromPv({
                    fallbackMove: 'h2e2',
                    fallbackScore: 120,
                    pvLines: OFFERED,
                    searchTag: null,
                    strength,
                    random: () => draw,
                }).move)
            );
            const onlyEverBest = drawn.size === 1 && drawn.has('h2e2');
            expect(
                onlyEverBest,
                `${AI_STRENGTH_LABELS[strength]} is described as "${describeAiStrength(strength)}" but played ${[...drawn].join(', ')}`
            ).toBe(saysBestOnly);
        }
    });
});
