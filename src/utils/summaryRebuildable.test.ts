import { describe, expect, it } from 'vitest';
import { computeReviewArtifacts, rebuildSummaryFromAnnotations, reviewSideFromStartFen } from './review';
import type { ReviewAnnotation, ReviewSummary, ReviewTreeNodeLike } from './review';

/**
 * Checks the claim in docs/architecture.md: that a stored review summary could
 * be rebuilt from the per-move annotations already saved beside it, rather than
 * persisted and left to drift.
 *
 * This changes nothing. It exists so the recommendation is known to be
 * achievable, and so the fields it *cannot* recover are named rather than
 * discovered later.
 */
function line(evals: number[], firstMover: 'red' | 'black' = 'red') {
    const nodes: Record<string, ReviewTreeNodeLike> = {};
    const ids: string[] = [];
    evals.forEach((evalScore, index) => {
        const id = `n${index}`;
        ids.push(id);
        const redMoves = (index % 2 === 0) === (firstMover === 'red');
        nodes[id] = {
            parentId: index === 0 ? null : `n${index - 1}`,
            record: { uci: 'a0a1', piece: redMoves ? 'R' : 'r', ply: index + 1, evalScore },
        };
    });
    return { nodes, ids };
}

/**
 * The rebuild is no longer a local copy of the summary math: it calls the
 * function the app calls when it loads a saved game. The test therefore guards
 * the shipped path rather than a parallel implementation of it, which is the
 * only version of this test worth having.
 */
function rebuildFromAnnotations(annotations: ReviewAnnotation[], stored: ReviewSummary) {
    return rebuildSummaryFromAnnotations(annotations, stored);
}

describe('rebuilding a review summary from its annotations', () => {
    const cases: Array<[string, number[]]> = [
        ['an ordinary game', [0, -30, -10, -45, -20, -60]],
        ['a one-sided game', [0, -200, -180, -400, -350, -900]],
        ['a game ending in mate', [-50, -60, -40, -70, -55, 30000 - 3]],
        ['a short game', [0, -25]],
    ];

    for (const [name, evals] of cases) {
        it(`recovers the reported figures for ${name}`, () => {
            const { nodes, ids } = line(evals);
            const { summary, annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);
            const rebuilt = rebuildFromAnnotations(annotations, summary);

            expect(rebuilt.totalMoves).toBe(summary.totalMoves);
            expect(rebuilt.accuracy).toBe(summary.accuracy);
            expect(rebuilt.averageCentipawnLoss).toBe(summary.averageCentipawnLoss);
            expect(rebuilt.redAccuracy).toBe(summary.redAccuracy);
            expect(rebuilt.blackAccuracy).toBe(summary.blackAccuracy);
            expect(rebuilt.bestCount).toBe(summary.bestCount);
            expect(rebuilt.blunderCount).toBe(summary.blunderCount);
        });
    }

    it('cannot recover the fields that are not derived, which must stay stored', () => {
        // reviewedAt and the engine description are facts about the run, not
        // conclusions drawn from the moves. Storing those is correct.
        const { nodes, ids } = line([0, -30, -10]);
        const { summary } = computeReviewArtifacts(ids, nodes, undefined, 1, {
            tier: 'mid', baseDepth: 12, baseMoveTimeMs: 200,
        });
        expect(summary.reviewedAt).toBe(1);
        expect(summary.engine?.tier).toBe('mid');
        expect(summary.engine?.baseDepth).toBe(12);
    });
});

describe('a stored summary computed on an older scale', () => {
    /**
     * The point of rebuilding on load. A record saved before a scoring change
     * carries a number the current code would never produce; left alone it
     * sorts and averages in the library beside records that used the new one.
     */
    it('is replaced by one the current code would produce', () => {
        const { nodes, ids } = line([0, -30, -10, -45, -20, -60]);
        const { summary, annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);

        const stale: ReviewSummary = { ...summary, accuracy: 42, redAccuracy: 41, blackAccuracy: 43 };
        const rebuilt = rebuildSummaryFromAnnotations(annotations, stale);

        expect(rebuilt.accuracy).toBe(summary.accuracy);
        expect(rebuilt.redAccuracy).toBe(summary.redAccuracy);
        expect(rebuilt.blackAccuracy).toBe(summary.blackAccuracy);
    });

    it('keeps the facts about the run, which are not derivable', () => {
        const { nodes, ids } = line([0, -30, -10]);
        const { summary, annotations } = computeReviewArtifacts(ids, nodes, undefined, 4242, {
            tier: 'high', baseDepth: 16, baseMoveTimeMs: 500,
        });

        const rebuilt = rebuildSummaryFromAnnotations(annotations, summary);
        expect(rebuilt.reviewedAt).toBe(4242);
        expect(rebuilt.engine?.baseDepth).toBe(16);
        expect(rebuilt.lineSignature).toBe(summary.lineSignature);
    });

    /**
     * A saved annotation carries no piece, so the rebuild has to be told who
     * moved first. It assumed Red, and a study set up with Black to move --
     * an endgame from a book, a position pasted mid-game -- came back out of
     * the library with its Red and Black accuracies swapped.
     */
    it('attributes each side its own moves in a game Black began', () => {
        const evals = [0, -30, -10, -180, -20, -60];
        const { nodes, ids } = line(evals, 'black');
        const { summary, annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);
        // The fixture is only worth having if the two sides really differ.
        expect(summary.redAccuracy).not.toBe(summary.blackAccuracy);

        const rebuilt = rebuildSummaryFromAnnotations(annotations, summary, 'black');
        expect(rebuilt.redAccuracy).toBe(summary.redAccuracy);
        expect(rebuilt.blackAccuracy).toBe(summary.blackAccuracy);
        expect(rebuilt.redAverageCentipawnLoss).toBe(summary.redAverageCentipawnLoss);
        expect(rebuilt.blackAverageCentipawnLoss).toBe(summary.blackAverageCentipawnLoss);

        // What the old assumption produced: the same figures, on the wrong sides.
        const assumedRed = rebuildSummaryFromAnnotations(annotations, summary);
        expect(assumedRed.redAccuracy).toBe(summary.blackAccuracy);
        expect(assumedRed.blackAccuracy).toBe(summary.redAccuracy);
    });

    it('reads the first mover off the start position', () => {
        expect(reviewSideFromStartFen(undefined)).toBe('red');
        expect(reviewSideFromStartFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1')).toBe('red');
        expect(reviewSideFromStartFen('4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 12')).toBe('black');
    });

    it('leaves a summary alone when an annotation is missing its evidence', () => {
        const { nodes, ids } = line([0, -30, -10]);
        const { summary, annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);

        const incomplete = annotations.map((annotation, index) =>
            index === 1 ? { ...annotation, winPercentLoss: undefined } : annotation);
        expect(rebuildSummaryFromAnnotations(incomplete, summary)).toBe(summary);
    });
});
