import { describe, expect, it } from 'vitest';
import { computeReviewArtifacts } from './review';
import type { ReviewTreeNodeLike } from './review';

/**
 * Key moments are ranked worst-first: by grade, then by how much the
 * evaluation moved, then by where in the game they happened.
 *
 * The middle key is the one nothing held. Found by mutation -- the `||`
 * between the swing difference and the move-index difference could be turned
 * into `&&`, which drops the swing ordering entirely, and the whole suite
 * passed. Every existing fixture had its moments already in move order, so the
 * two keys agreed and neither could be told from the other.
 */
function line(evals: number[]) {
    const nodes: Record<string, ReviewTreeNodeLike> = {};
    const ids: string[] = [];
    evals.forEach((evalScore, index) => {
        const id = `n${index}`;
        ids.push(id);
        nodes[id] = {
            parentId: index === 0 ? null : `n${index - 1}`,
            record: { uci: 'a0a1', piece: index % 2 === 0 ? 'R' : 'r', ply: index + 1, evalScore },
        };
    });
    return { nodes, ids };
}

describe('ordering the key moments', () => {
    // Two swings back to equality: 400 centipawns at ply 3, then 500 at ply 5.
    // The bigger one happens later, so swing order and move order disagree.
    const { nodes, ids } = line([0, 0, -400, 0, -500, 0]);
    const moments = computeReviewArtifacts(ids, nodes, undefined, 1).summary.keyMoments;

    it('puts the larger swing first even though it came later', () => {
        expect(moments.map((moment) => moment.moveIndex)).toEqual([4, 5, 2, 3]);
    });

    it('ranks by grade before swing', () => {
        const priorities = moments.map((moment) => moment.quality);
        expect(new Set(priorities)).toEqual(new Set(['blunder']));
        // The swings themselves, to show the order above is the swing order
        // and not an accident of how the fixture was built.
        expect(moments.map((moment) => Math.round(moment.swing))).toEqual([500, 500, 400, 400]);
    });
});
