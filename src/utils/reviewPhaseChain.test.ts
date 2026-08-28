import { describe, expect, it } from 'vitest';
import { parseFenBoard, START_FEN } from './xiangqi';
import { plyOffsetFromRootFen } from './gamePhase';
import {
    computeReviewArtifacts,
    summarizeAccuracyByPhase,
    type PhaseAccuracyRecordLike,
    type ReviewTreeNodeLike,
} from './review';

/**
 * The whole chain, end to end: a review is computed, its annotations are written
 * back onto the move records the way setNodeReviewDataBulk does, and the phase
 * breakdown is read off those records.
 *
 * This exists because the browser could not run it. The panel derives its
 * breakdown from move records rather than from the stored summary, so it only
 * works if a review actually puts winPercentLoss on the records — which is the
 * link these tests pin down.
 */

const OPENING = parseFenBoard(START_FEN);
/** A chariot and cannon each: an endgame by material. */
const ENDGAME = parseFenBoard('r3k3c/9/9/9/9/9/9/9/9/R3K3C');

type Node = ReviewTreeNodeLike & { record?: PhaseAccuracyRecordLike };

/** Red plays the odd plies. Evaluations are red-positive centipawns. */
function buildLine(moves: Array<{ board: typeof OPENING; evalScore: number }>) {
    const nodes: Record<string, Node> = {};
    const ids: string[] = [];
    moves.forEach((move, index) => {
        const id = `n${index}`;
        ids.push(id);
        nodes[id] = {
            parentId: index === 0 ? null : `n${index - 1}`,
            record: {
                uci: 'a0a1',
                piece: index % 2 === 0 ? 'R' : 'r',
                ply: index + 1,
                evalScore: move.evalScore,
                board: move.board,
            },
        };
    });
    return { nodes, ids };
}

/** What setNodeReviewDataBulk does: copy the annotations onto the records. */
function applyAnnotations(
    nodes: Record<string, Node>,
    annotations: ReturnType<typeof computeReviewArtifacts>['annotations'],
): PhaseAccuracyRecordLike[] {
    for (const annotation of annotations) {
        const record = nodes[annotation.nodeId]?.record;
        if (record) record.winPercentLoss = annotation.winPercentLoss;
    }
    return Object.values(nodes)
        .map((node) => node.record)
        .filter((record): record is PhaseAccuracyRecordLike => Boolean(record));
}

describe('from a computed review to a phase breakdown', () => {
    it('carries a win-percent loss onto every annotated move', () => {
        const { nodes, ids } = buildLine([
            { board: OPENING, evalScore: 0 },
            { board: OPENING, evalScore: -300 },
            { board: OPENING, evalScore: -280 },
        ]);
        const { annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);
        expect(annotations.length).toBe(3);
        const records = applyAnnotations(nodes, annotations);
        expect(records.every((record) => typeof record.winPercentLoss === 'number')).toBe(true);
    });

    it('breaks a game spanning two phases into both of them', () => {
        const { nodes, ids } = buildLine([
            { board: OPENING, evalScore: 0 },
            { board: OPENING, evalScore: -40 },
            { board: OPENING, evalScore: -20 },
            { board: OPENING, evalScore: -60 },
            { board: ENDGAME, evalScore: -600 },
            { board: ENDGAME, evalScore: -580 },
        ]);
        const { summary, annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);
        const phases = summarizeAccuracyByPhase(applyAnnotations(nodes, annotations));

        expect(phases.map((entry) => entry.phase)).toEqual(['opening', 'endgame']);
        // Every scored move is filed under exactly one phase.
        expect(phases.reduce((total, entry) => total + entry.moves, 0)).toBe(summary.totalMoves);
    });

    it('agrees with the overall accuracy the same review reported', () => {
        const { nodes, ids } = buildLine([
            { board: OPENING, evalScore: 0 },
            { board: OPENING, evalScore: -40 },
            { board: OPENING, evalScore: -20 },
            { board: ENDGAME, evalScore: -500 },
        ]);
        const { summary, annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);
        const phases = summarizeAccuracyByPhase(applyAnnotations(nodes, annotations));

        // The overall figure must sit between the best and worst phase, not
        // outside them — which is what a different curve would produce.
        const scores = phases.map((entry) => entry.accuracy);
        expect(summary.accuracy).toBeGreaterThanOrEqual(Math.min(...scores) - 1);
        expect(summary.accuracy).toBeLessThanOrEqual(Math.max(...scores) + 1);
    });

    it('says nothing when a review has not been run', () => {
        const { nodes } = buildLine([
            { board: OPENING, evalScore: 0 },
            { board: OPENING, evalScore: -40 },
        ]);
        // No annotations applied: the records carry no loss yet.
        const records = Object.values(nodes)
            .map((node) => node.record)
            .filter((record): record is PhaseAccuracyRecordLike => Boolean(record));
        expect(summarizeAccuracyByPhase(records)).toEqual([]);
    });
});

describe('a line that starts part-way through a game', () => {
    it('does not call move 20 an opening just because the line starts there', () => {
        // Everything still on the board, but the root FEN says move 20.
        const { nodes, ids } = buildLine([
            { board: OPENING, evalScore: 0 },
            { board: OPENING, evalScore: -40 },
        ]);
        const { annotations } = computeReviewArtifacts(ids, nodes, undefined, 1);
        const records = applyAnnotations(nodes, annotations);

        const fromTheStart = summarizeAccuracyByPhase(records, plyOffsetFromRootFen(`${START_FEN} w - - 0 1`));
        const fromMove20 = summarizeAccuracyByPhase(records, plyOffsetFromRootFen(`${START_FEN} w - - 0 20`));

        expect(fromTheStart.map((entry) => entry.phase)).toEqual(['opening']);
        expect(fromMove20.map((entry) => entry.phase)).toEqual(['middleGame']);
        // The moves themselves are the same either way; only the grouping moves.
        expect(fromMove20[0].moves).toBe(fromTheStart[0].moves);
    });
});
