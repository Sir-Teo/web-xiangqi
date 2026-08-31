import { describe, expect, it } from 'vitest';
import { rovingIndexForKey, rovingTabStopIndex } from './rovingFocus';

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
        expect(rovingTabStopIndex(3, -1, null)).toBe(2);
        expect(rovingTabStopIndex(3, 1.5, null)).toBe(2);
    });

    it('gives an empty list no tab stop at all', () => {
        // Correct rather than defensive: there is nothing on it to reach.
        expect(rovingTabStopIndex(0, null, null)).toBeNull();
        expect(rovingTabStopIndex(0, 0, 0)).toBeNull();
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
