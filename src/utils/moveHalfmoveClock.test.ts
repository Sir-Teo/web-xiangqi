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
    it('discounts checks beyond ten and their replies for either checking side', () => {
        for (const firstSideToMove of ['w', 'b'] as const) {
            const line: Parameters<typeof halfmoveClockAtNode>[0] = { root: { parentId: null } };
            for (let i = 0; i < 24; i++) {
                line[`n${i + 1}`] = { parentId: i ? `n${i}` : 'root', record: {
                    sideToMove: i % 2 ? firstSideToMove : firstSideToMove === 'w' ? 'b' : 'w', inCheck: i % 2 === 1,
                } };
            }
            expect(halfmoveClockAtNode(line, 'n20', 'root', 0)).toBe(20);
            expect(halfmoveClockAtNode(line, 'n21', 'root', 0)).toBe(21);
            expect(halfmoveClockAtNode(line, 'n22', 'root', 0)).toBe(21);
            expect(halfmoveClockAtNode(line, 'n24', 'root', 0)).toBe(21);
            expect(halfmoveClockAtNode(line, 'n24', 'root', 37)).toBe(58);
        }
    });

    it('matches the forward engine counter through mixed checks and capture resets', () => {
        // Independent forward formulation from pinned Pikafish position.cpp;
        // exercise the backward deduction, including mutually checking replies.
        for (const captureEvery of [0, 37, 61]) {
            const line: Parameters<typeof halfmoveClockAtNode>[0] = { root: { parentId: null } };
            const checks = [0, 0]; let expected = 73; let previousCheck = false;
            for (let i = 0; i < 180; i++) {
                const mover = i % 2;
                const inCheck = i % 7 !== 0;
                const captured = captureEvery && i % captureEvery === captureEvery - 1 ? 'n' : '';
                line[`n${i + 1}`] = { parentId: i ? `n${i}` : 'root', record: {
                    sideToMove: mover === 0 ? 'b' : 'w', inCheck, captured,
                } };
                if (!inCheck || ++checks[mover] <= 10) {
                    if (checks[1 - mover] > 10 && previousCheck) checks[1 - mover]++;
                    else expected++;
                }
                if (captured) { expected = 0; checks[0] = 0; checks[1] = 0; }
                previousCheck = inCheck;
                expect(halfmoveClockAtNode(line, `n${i + 1}`, 'root', 73), `captureEvery=${captureEvery}, ply=${i + 1}`).toBe(expected);
            }
        }
    });

});
