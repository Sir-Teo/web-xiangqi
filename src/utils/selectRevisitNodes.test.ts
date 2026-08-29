import { describe, expect, it } from 'vitest';
import { nextCriticalSwing, selectRevisitNodes } from './review';

const swings = (entries: Array<[string, number]>) => new Map(entries);

describe('choosing what a review revisits', () => {
    it('takes the biggest swings first', () => {
        const chosen = selectRevisitNodes(swings([['a', 40], ['b', 300], ['c', 120]]), 3);
        expect(chosen).toEqual(['b', 'c', 'a']);
    });

    it('stops at the budget', () => {
        const chosen = selectRevisitNodes(swings([['a', 40], ['b', 300], ['c', 120]]), 2);
        expect(chosen).toEqual(['b', 'c']);
    });

    /**
     * Two equally bad moments should be revisited in the order they were
     * played. `Array.prototype.sort` is stable, so insertion order decides --
     * this pins that rather than leaving it to the engine's discretion.
     */
    it('breaks a tie by when the moment happened', () => {
        const chosen = selectRevisitNodes(swings([['first', 200], ['second', 200], ['third', 200]]), 2);
        expect(chosen).toEqual(['first', 'second']);
    });

    it('has nothing to revisit when nothing swung', () => {
        expect(selectRevisitNodes(new Map(), 5)).toEqual([]);
    });

    it('revisits nothing when the budget is nothing', () => {
        const all = swings([['a', 300], ['b', 200]]);
        expect(selectRevisitNodes(all, 0)).toEqual([]);
        expect(selectRevisitNodes(all, -1)).toEqual([]);
        expect(selectRevisitNodes(all, Number.NaN)).toEqual([]);
    });

    it('takes a whole number of positions from a fractional budget', () => {
        expect(selectRevisitNodes(swings([['a', 300], ['b', 200], ['c', 100]]), 2.9)).toEqual(['a', 'b']);
    });

    it('drops a swing that is not a number rather than sorting against it', () => {
        const chosen = selectRevisitNodes(
            swings([['a', 300], ['bad', Number.NaN], ['b', 200], ['worse', Number.POSITIVE_INFINITY]]),
            4
        );
        expect(chosen).toEqual(['a', 'b']);
    });

    it('asks for more than it has without complaint', () => {
        expect(selectRevisitNodes(swings([['a', 300]]), 10)).toEqual(['a']);
    });
});

describe('deciding which swings are worth revisiting', () => {
    const THRESHOLD = 120;

    it('remembers a swing past the threshold', () => {
        expect(nextCriticalSwing(undefined, 300, THRESHOLD)).toBe(300);
    });

    /**
     * The boundary is `>=`, so a swing exactly on the threshold counts. It is
     * the kind of comparison that changes meaning under a one-character edit
     * and produces no visible symptom, which is why it is pinned from both
     * sides.
     */
    it('counts a swing exactly on the threshold, and not one just under', () => {
        expect(nextCriticalSwing(undefined, THRESHOLD, THRESHOLD)).toBe(THRESHOLD);
        expect(nextCriticalSwing(undefined, THRESHOLD - 1, THRESHOLD)).toBeNull();
    });

    it('keeps the worst swing at a decision point, not the latest', () => {
        expect(nextCriticalSwing(300, 500, THRESHOLD)).toBe(500);
        expect(nextCriticalSwing(500, 300, THRESHOLD)).toBeNull();
        expect(nextCriticalSwing(500, 500, THRESHOLD)).toBeNull();
    });

    it('ignores a swing that is not a number', () => {
        expect(nextCriticalSwing(undefined, Number.NaN, THRESHOLD)).toBeNull();
        expect(nextCriticalSwing(300, Number.POSITIVE_INFINITY, THRESHOLD)).toBeNull();
    });

    it('feeds the revisit queue it exists to fill', () => {
        // The two rules in sequence: record the worst swings, then take the
        // biggest of what was recorded.
        const swings = new Map<string, number>();
        for (const [node, swing] of [['a', 90], ['b', 400], ['a', 250], ['c', 130], ['b', 200]] as const) {
            const next = nextCriticalSwing(swings.get(node), swing, THRESHOLD);
            if (next !== null) swings.set(node, next);
        }
        expect([...swings.entries()]).toEqual([['b', 400], ['a', 250], ['c', 130]]);
        expect(selectRevisitNodes(swings, 2)).toEqual(['b', 'a']);
    });
});
