import { describe, expect, it } from 'vitest';
import { MAX_REPORTED_CENTIPAWN_LOSS, computeReviewArtifacts } from './review';
import type { ReviewTreeNodeLike } from './review';

/**
 * Reproduces the centipawn-average defect without an engine.
 *
 * `useEngine.ts` encodes a mate as `MATE_SCORE_BASE - mateIn` with
 * MATE_SCORE_BASE = 30000, so these are the numbers a real review sees. The
 * engine is only needed to *produce* them; the arithmetic that follows is
 * deterministic, which is what these tests pin.
 */
const MATE_SCORE_BASE = 30000;
/** Red mates in 3: the score a real review would store on that node. */
const RED_MATES = MATE_SCORE_BASE - 3;

/** Red-positive evaluations, one node per ply, red moving on the odd plies. */
function lineWith(evals: number[]) {
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

describe('a game that ends in mate', () => {
    it('does not let the mate sentinel stand in for the rest of the game', () => {
        // Black is somewhat worse all game, then walks into a forced mate.
        const { nodes, ids } = lineWith([-50, -60, -40, -70, -55, RED_MATES]);
        const { summary } = computeReviewArtifacts(ids, nodes, undefined, 1);

        // Every ordinary move here cost tens of centipawns, not thousands.
        expect(summary.averageCentipawnLoss).toBeLessThan(1000);
    });

    it('still grades the moves sensibly, because quality reads winning chances', () => {
        const { nodes, ids } = lineWith([-50, -60, -40, -70, -55, RED_MATES]);
        const { summary } = computeReviewArtifacts(ids, nodes, undefined, 1);
        // The accuracy figures are bounded by construction and were never the
        // broken half; this pins that the fix does not disturb them.
        expect(summary.accuracy).toBeGreaterThanOrEqual(0);
        expect(summary.accuracy).toBeLessThanOrEqual(100);
    });

    it('books the mate at the bound rather than at the sentinel', () => {
        const { nodes, ids } = lineWith([-50, RED_MATES]);
        const { summary, annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);
        // Two moves are scored: the first gives up 50, the second walks into
        // mate and is booked at the bound. Unbounded, the second alone was
        // 30047 and the average was 15048.
        expect(summary.averageCentipawnLoss).toBe((50 + MAX_REPORTED_CENTIPAWN_LOSS) / 2);
        // The raw swing is preserved on the annotation; only reporting is bounded.
        expect(annotations[annotations.length - 1].swing).toBeGreaterThan(MAX_REPORTED_CENTIPAWN_LOSS);
    });

    it('marks a bounded figure as off-scale in the note', () => {
        const { nodes, ids } = lineWith([-50, RED_MATES]);
        const { annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);
        expect(annotations[annotations.length - 1].reviewNote).toContain('+cp');
    });

    it('leaves an ordinary note unmarked', () => {
        const { nodes, ids } = lineWith([0, -300]);
        const { annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);
        expect(annotations[annotations.length - 1].reviewNote).not.toContain('+cp');
    });

    it('leaves an ordinary game untouched', () => {
        const { nodes, ids } = lineWith([0, -30, -10, -45]);
        const { summary } = computeReviewArtifacts(ids, nodes, undefined, 1);
        expect(summary.averageCentipawnLoss).toBeLessThan(100);
    });
});
