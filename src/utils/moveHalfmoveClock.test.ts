import { describe, expect, it } from 'vitest';
import { halfmoveClockAtNode } from './moveHalfmoveClock';

describe('halfmoveClockAtNode', () => {
    const tree = {
        root: { parentId: null },
        quiet: { parentId: 'root', record: {} },
        capture: { parentId: 'quiet', record: { captured: 'p' } },
        reply: { parentId: 'capture', record: {} },
        sibling: { parentId: 'quiet', record: {} },
    };
    it('keeps the root clock until a capture on the selected branch', () => {
        expect(halfmoveClockAtNode(tree, 'root', 'root', 37)).toBe(37);
        expect(halfmoveClockAtNode(tree, 'quiet', 'root', 37)).toBe(38);
        expect(halfmoveClockAtNode(tree, 'capture', 'root', 37)).toBe(0);
        expect(halfmoveClockAtNode(tree, 'reply', 'root', 37)).toBe(1);
        expect(halfmoveClockAtNode(tree, 'sibling', 'root', 37)).toBe(39);
    });
    it('does not read ancestors before the latest capture', () => {
        const guarded = { ...tree, get quiet(): never { throw new Error('Older ancestry is unnecessary'); } };
        expect(halfmoveClockAtNode(guarded, 'reply', 'root', 37)).toBe(1);
    });
    it('counts a quiet soldier move and skips nodes without move records', () => {
        const extended = { ...tree, gap: { parentId: 'reply' }, soldier: { parentId: 'gap', record: { captured: null } } };
        expect(halfmoveClockAtNode(extended, 'soldier', 'root', 37)).toBe(2);
    });
});
