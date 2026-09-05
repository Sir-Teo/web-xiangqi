import { describe, expect, it } from 'vitest';
import { isDrillSuccess, judgeDrillAttempt, orderDrillMoments, type DrillMoment } from './mistakeDrill';
import { REVIEW_THRESHOLDS, classifyMoveQualityForEval, getEvalLossForMove } from './review';

const redMistake: DrillMoment = {
    nodeId: 'n5',
    moveIndex: 4,
    ply: 5,
    side: 'red',
    quality: 'mistake',
    bestMove: 'h0g2',
    playedMove: 'b0c2',
    evalBefore: 40,
};

const blackBlunder: DrillMoment = {
    nodeId: 'n8',
    moveIndex: 7,
    ply: 8,
    side: 'black',
    quality: 'blunder',
    bestMove: 'h9g7',
    playedMove: 'b9c7',
    // Red-positive, so Black was slightly better here.
    evalBefore: -60,
};

describe('orderDrillMoments', () => {
    it('walks the game in order rather than worst-first, and drops moments with no better move', () => {
        const noBest: DrillMoment = { ...redMistake, nodeId: 'n2', moveIndex: 1, ply: 2, bestMove: undefined };
        const sameMove: DrillMoment = { ...redMistake, nodeId: 'n3', moveIndex: 2, ply: 3, bestMove: 'b0c2' };
        const ordered = orderDrillMoments([blackBlunder, noBest, redMistake, sameMove]);
        expect(ordered.map((moment) => moment.nodeId)).toEqual(['n5', 'n8']);
    });
});

describe('judgeDrillAttempt', () => {
    it('recognises the engine move without an evaluation', () => {
        expect(judgeDrillAttempt(redMistake, 'H0G2', null)).toEqual({ kind: 'best' });
    });

    it('recognises the move from the game, which is the one being asked about', () => {
        expect(judgeDrillAttempt(redMistake, 'b0c2', null)).toEqual({ kind: 'repeat' });
        // Even when an evaluation has arrived: the point is that it is the same move.
        expect(judgeDrillAttempt(redMistake, 'b0c2', 40)).toEqual({ kind: 'repeat' });
    });

    it('waits for an evaluation for any other move', () => {
        expect(judgeDrillAttempt(redMistake, 'h2e2', null)).toBeNull();
        expect(judgeDrillAttempt(redMistake, 'h2e2', Number.NaN)).toBeNull();
    });

    it('grades on the review scale, so a move the review would call good is good here', () => {
        // Red gives back 30cp: "best" on the centipawn ladder.
        const kept = judgeDrillAttempt(redMistake, 'h2e2', 10);
        expect(kept?.kind).toBe('good');
        expect(kept && 'quality' in kept ? kept.quality : null).toBe('best');

        // Red gives back 250cp at equality: a mistake on both ladders.
        const lost = judgeDrillAttempt(redMistake, 'h2e2', -210);
        expect(lost?.kind).toBe('wrong');
        expect(lost && 'quality' in lost ? lost.quality : null).toBe(
            classifyMoveQualityForEval(getEvalLossForMove(40, -210, 'red'), 40, -210, 'red')
        );
        expect(lost && 'winPercentLoss' in lost ? lost.winPercentLoss : 0).toBeGreaterThan(REVIEW_THRESHOLDS.best / 100);
    });

    it('reads the loss from Black\'s side for a Black moment', () => {
        // Evaluations are Red-positive: a rise from -60 to +200 is Black losing ground.
        const lost = judgeDrillAttempt(blackBlunder, 'a9a8', 200);
        expect(lost?.kind).toBe('wrong');
        // And a fall to -90 is Black gaining, which the review calls best.
        const gained = judgeDrillAttempt(blackBlunder, 'a9a8', -90);
        expect(gained?.kind).toBe('good');
    });
});

describe('isDrillSuccess', () => {
    it('counts the engine move and a good move, and nothing else', () => {
        expect(isDrillSuccess({ kind: 'best' })).toBe(true);
        expect(isDrillSuccess({ kind: 'good', winPercentLoss: 1, quality: 'good' })).toBe(true);
        expect(isDrillSuccess({ kind: 'wrong', winPercentLoss: 20, quality: 'mistake' })).toBe(false);
        expect(isDrillSuccess({ kind: 'repeat' })).toBe(false);
        expect(isDrillSuccess({ kind: 'shown' })).toBe(false);
        expect(isDrillSuccess(null)).toBe(false);
    });
});
