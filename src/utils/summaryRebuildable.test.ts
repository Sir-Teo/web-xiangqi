import { describe, expect, it } from 'vitest';
import {
    computeReviewArtifacts,
    getMoveAccuracyForWinPercentLoss,
    getReviewSideForRecord,
    reportedCentipawnLoss,
} from './review';
import type { ReviewAnnotation, ReviewTreeNodeLike } from './review';

/**
 * Checks the claim in docs/architecture.md: that a stored review summary could
 * be rebuilt from the per-move annotations already saved beside it, rather than
 * persisted and left to drift.
 *
 * This changes nothing. It exists so the recommendation is known to be
 * achievable, and so the fields it *cannot* recover are named rather than
 * discovered later.
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

/** Everything the summary reports, recovered from annotations alone. */
function rebuildFromAnnotations(annotations: ReviewAnnotation[]) {
    const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    const side = { red: { acc: 0, loss: 0, n: 0 }, black: { acc: 0, loss: 0, n: 0 } };
    for (const a of annotations) {
        counts[a.quality] += 1;
        // The side is recoverable from the move index alone, which is stored.
        const who = getReviewSideForRecord({ uci: '', ply: a.moveIndex + 1 }, a.moveIndex);
        side[who].acc += getMoveAccuracyForWinPercentLoss(a.winPercentLoss as number);
        side[who].loss += reportedCentipawnLoss(a.swing);
        side[who].n += 1;
    }
    const total = side.red.n + side.black.n;
    return {
        totalMoves: total,
        accuracy: Math.round((side.red.acc + side.black.acc) / total),
        averageCentipawnLoss: Math.round((side.red.loss + side.black.loss) / total),
        redAccuracy: side.red.n ? Math.round(side.red.acc / side.red.n) : undefined,
        blackAccuracy: side.black.n ? Math.round(side.black.acc / side.black.n) : undefined,
        bestCount: counts.best,
        blunderCount: counts.blunder,
    };
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
            const rebuilt = rebuildFromAnnotations(annotations);

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
            name: 'Pikafish', depth: 12, movetimeMs: 200, tier: 'mid',
        });
        expect(summary.reviewedAt).toBe(1);
        expect(summary.engine?.name).toBe('Pikafish');
    });
});
