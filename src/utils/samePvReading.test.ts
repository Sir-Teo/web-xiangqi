import { expect, it } from 'vitest';
import { sameBoardPvReading, samePvReading } from './samePvReading';
import type { PvLine } from '../hooks/useEngine';
const line: PvLine = { depth: '12', score: 10, scoreStr: '+10', moves: ['h2e2'], searchTag: 'position-a', effort: { nodes: 100 } };
it('keeps the board reading stable for effort-only telemetry', () => {
    expect(samePvReading([line], [{ ...line, moves: [...line.moves], effort: { nodes: 200, timeMs: 5 } }])).toBe(true);
});
it.each([{ score: 20 }, { depth: '13' }, { moves: ['b2e2'] }, { searchTag: 'position-b' }, { bounded: true }, { wdl: { win: 10, draw: 980, loss: 10 } }])('publishes a changed recommendation %j', change => {
    expect(samePvReading([line], [{ ...line, ...change }])).toBe(false);
});

it('lets the panel observe depth while keeping the board stable, but publishes changed bounds and WDL', () => {
    expect(sameBoardPvReading([line], [{ ...line, depth: '20', effort: { nodes: 10_000 } }])).toBe(true);
    for (const change of [{ bound: 'lower' as const }, { wdl: { win: 100, draw: 800, loss: 100 } }, { searchTag: 'new-position' }]) {
        expect(sameBoardPvReading([line], [{ ...line, ...change }])).toBe(false);
    }
});
