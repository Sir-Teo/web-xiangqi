import { expect, it } from 'vitest';
import { breadcrumbWindow, rowAtOffset, rowOffsets, visibleRowIndices } from './virtualRows';

it('finds variable-height rows and bounds large windows while retaining distant focus', () => {
    const offsets = rowOffsets(Array.from({ length: 5000 }, (_, i) => String(i)), new Map([['1', 200]]));
    expect(offsets.slice(0, 4)).toEqual([0, 36, 236, 272]);
    expect(rowAtOffset(offsets, -1)).toBe(0);
    expect(rowAtOffset(offsets, 235)).toBe(1);
    expect(rowAtOffset(offsets, 236)).toBe(2);
    const visible = visibleRowIndices(offsets, 40_000, 500, [0, 4999, -1, 5001]);
    expect(visible.length).toBeLessThan(32);
    expect(visible).toContain(0); expect(visible).toContain(4999);
    expect(new Set(visible).size).toBe(visible.length);
    expect(visibleRowIndices([0], 0, 0)).toEqual([]);
});
it('keeps breadcrumb endpoints and keyboard focus for every position', () => {
    expect(breadcrumbWindow(4, 2)).toEqual([0, 1, 2, 3]);
    for (const index of [0, 1, 48, 100, 4999]) {
        const visible = breadcrumbWindow(5000, index);
        expect(visible.length).toBeLessThanOrEqual(50);
        expect(visible[0]).toBe(0); expect(visible.at(-1)).toBe(4999);
        expect(visible).toContain(index);
    }
});
