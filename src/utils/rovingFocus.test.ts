import { describe, expect, it } from 'vitest';
import { rovingIndexForKey, rovingTabStopIndex, verticalRovingIndexForKey } from './rovingFocus';

describe('which item carries the tab stop', () => {
    it('prefers wherever focus was last left', () => {
        expect(rovingTabStopIndex(5, 2, 4)).toBe(2);
    });

    it('falls back to whatever is current', () => {
        expect(rovingTabStopIndex(5, null, 3)).toBe(3);
    });

    it('falls back to the tip of the line when nothing else applies', () => {
        expect(rovingTabStopIndex(5, null, null)).toBe(4);
    });

    it('ignores a remembered index the list has since outgrown', () => {
        // The line shortens when you step back and play a different move.
        expect(rovingTabStopIndex(3, 9, 1)).toBe(1);
    });

    it('accepts both ends of the range it calls valid', () => {
        // Found by mutation: `index >= 0` and `index < count` could each move
        // by one and pass, because every case above used an index in the
        // middle. Rejecting 0 sends the tab stop to the last item instead of
        // the first; accepting `count` points it at an element that is not
        // there.
        expect(rovingTabStopIndex(5, 0, 3)).toBe(0);
        expect(rovingTabStopIndex(5, 4, 3)).toBe(4);
        expect(rovingTabStopIndex(5, 5, 3)).toBe(3);
        expect(rovingTabStopIndex(5, -1, 3)).toBe(3);
        // And the same two ends for the fallback argument.
        expect(rovingTabStopIndex(5, null, 0)).toBe(0);
        expect(rovingTabStopIndex(5, null, 5)).toBe(4);
        expect(rovingTabStopIndex(3, -1, null)).toBe(2);
        expect(rovingTabStopIndex(3, 1.5, null)).toBe(2);
    });

    it('gives an empty list no tab stop at all', () => {
        // Correct rather than defensive: there is nothing on it to reach.
        expect(rovingTabStopIndex(0, null, null)).toBeNull();
        expect(rovingTabStopIndex(0, 0, 0)).toBeNull();
    });
});

describe('vertical navigation through rendered rows', () => {
    const box = (left: number, top: number, bottom = top + 24) => ({ left, top, bottom });

    it('keeps the nearest column in two-column move rows', () => {
        const rects = [box(0, 0), box(100, 0), box(0, 30), box(100, 30)];
        expect(verticalRovingIndexForKey('ArrowDown', rects, 0)).toBe(2);
        expect(verticalRovingIndexForKey('ArrowUp', rects, 3)).toBe(1);
    });

    it('visits each wrapped variation row before the following main-line row', () => {
        const rects = [box(0, 0), box(100, 0), box(20, 40), box(100, 40), box(20, 70), box(100, 70), box(0, 110)];
        expect(verticalRovingIndexForKey('ArrowDown', rects, 2)).toBe(4);
        expect(verticalRovingIndexForKey('ArrowUp', rects, 4)).toBe(2);
        expect(verticalRovingIndexForKey('ArrowDown', rects, 4)).toBe(6);
    });

    it('groups different-height controls that share a visible row', () => {
        const rects = [box(0, 0, 60), box(100, 18, 42), box(0, 80), box(100, 80)];
        expect(verticalRovingIndexForKey('ArrowDown', rects, 1)).toBe(3);
        expect(verticalRovingIndexForKey('ArrowUp', rects, 3)).toBe(1);
    });

    it('stops at the edges of stacked rows and skips empty boxes', () => {
        const rects = [box(0, 0, 0), box(20, -30), box(20, 0), box(20, 30)];
        expect(verticalRovingIndexForKey('ArrowUp', rects, 1)).toBe(1);
        expect(verticalRovingIndexForKey('ArrowDown', rects, 1)).toBe(2);
        expect(verticalRovingIndexForKey('ArrowDown', rects, 3)).toBe(3);
    });

    it('leaves unrelated keys and unavailable focus positions to the caller', () => {
        expect(verticalRovingIndexForKey('Enter', [box(0, 0)], 0)).toBeNull();
        expect(verticalRovingIndexForKey('ArrowDown', [], 0)).toBeNull();
        expect(verticalRovingIndexForKey('ArrowUp', [box(0, 0)], -1)).toBeNull();
    });
});

describe('where a key moves the stop', () => {
    it('walks the strip', () => {
        expect(rovingIndexForKey('ArrowLeft', 5, 3)).toBe(2);
        expect(rovingIndexForKey('ArrowRight', 5, 3)).toBe(4);
    });

    it('jumps to either end', () => {
        expect(rovingIndexForKey('Home', 5, 3)).toBe(0);
        expect(rovingIndexForKey('End', 5, 3)).toBe(4);
    });

    it('stops at the ends rather than wrapping', () => {
        // A strip that represents a sequence should not jump from the last move
        // back to the first.
        expect(rovingIndexForKey('ArrowLeft', 5, 0)).toBe(0);
        expect(rovingIndexForKey('ArrowRight', 5, 4)).toBe(4);
    });

    it('says nothing about a key that is not ours', () => {
        // The caller uses null to decide whether to preventDefault; swallowing
        // everything would take Tab and the page's shortcuts with it.
        for (const key of ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'a', 'Escape']) {
            expect(rovingIndexForKey(key, 5, 2), key).toBeNull();
        }
    });

    it('has nothing to move in an empty list', () => {
        expect(rovingIndexForKey('ArrowRight', 0, 0)).toBeNull();
    });
});
