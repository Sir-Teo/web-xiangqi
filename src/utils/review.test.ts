import { describe, expect, it } from 'vitest';
import {
    formatReviewProgressDetail,
    REVIEW_DECISIVE_ADVANTAGE_CP,
    REVIEW_THRESHOLDS,
    REVIEW_WIN_PERCENT_LOSS_THRESHOLDS,
    classifyMoveQuality,
    classifyMoveQualityForEval,
    classifyWinPercentLoss,
    formatAverageCentipawnLoss,
    formatReviewCount,
    formatReviewEngineMoveTime,
    formatReviewQualityCount,
    formatWinPercentLoss,
    hasDecisiveAdvantageAfterMove,
    getEvalLossForMove,
    getEvalOverride,
    getMoveAccuracyForWinPercentLoss,
    getReviewSideForRecord,
    getWinPercentLossForMove,
    getWinningChancePercent,
    isCriticalReviewQuality,
    formatReviewQuality,
    formatReviewQualityWithArticle,
} from './review';

describe('winning chance conversion', () => {
    it('reads an even position as an even split for either side', () => {
        expect(getWinningChancePercent(0, 'red')).toBeCloseTo(50, 10);
        expect(getWinningChancePercent(0, 'black')).toBeCloseTo(50, 10);
    });

    it('mirrors the same evaluation between the two sides', () => {
        expect(getWinningChancePercent(250, 'red')).toBeCloseTo(100 - getWinningChancePercent(250, 'black'), 10);
    });

    it('stops counting evaluations beyond the saturation limit', () => {
        expect(getWinningChancePercent(5000, 'red')).toBe(getWinningChancePercent(3000, 'red'));
        expect(getWinningChancePercent(-5000, 'red')).toBe(getWinningChancePercent(-3000, 'red'));
    });

    it('never reports a negative loss when a move improves the position', () => {
        expect(getWinPercentLossForMove(0, 400, 'red')).toBe(0);
        expect(getWinPercentLossForMove(0, -400, 'red')).toBeGreaterThan(0);
    });
});

describe('move accuracy', () => {
    it('scores a move that gives nothing away as full marks', () => {
        expect(getMoveAccuracyForWinPercentLoss(0)).toBeCloseTo(100, 3);
    });

    it('falls as the move gives away more winning chances', () => {
        const small = getMoveAccuracyForWinPercentLoss(5);
        const large = getMoveAccuracyForWinPercentLoss(40);
        expect(small).toBeGreaterThan(large);
        expect(large).toBeGreaterThanOrEqual(0);
    });

    it('keeps a nonsense loss inside the 0-100 range', () => {
        expect(getMoveAccuracyForWinPercentLoss(Number.NaN)).toBeCloseTo(100, 3);
        expect(getMoveAccuracyForWinPercentLoss(1000)).toBe(0);
    });
});

describe('an advantage still standing after a slip', () => {
    it('needs a decisive edge, not merely a better position', () => {
        // This flag is what turns "Big miss." into "Still winning, but ...".
        // `buildReviewNote` is tested by passing the flag in directly, so the
        // threshold that produces it was never exercised: dropping it from 600
        // to 60 -- telling a player at six tenths of a pawn that they are still
        // winning -- broke nothing.
        expect(hasDecisiveAdvantageAfterMove(REVIEW_DECISIVE_ADVANTAGE_CP, 'red')).toBe(true);
        expect(hasDecisiveAdvantageAfterMove(REVIEW_DECISIVE_ADVANTAGE_CP - 1, 'red')).toBe(false);
        expect(hasDecisiveAdvantageAfterMove(100, 'red')).toBe(false);
        expect(hasDecisiveAdvantageAfterMove(599, 'red')).toBe(false);
        expect(hasDecisiveAdvantageAfterMove(600, 'red')).toBe(true);
    });

    it('reads the evaluation from the moving side', () => {
        // Scores are Red's point of view, so Black's decisive advantage is a
        // large negative number.
        expect(hasDecisiveAdvantageAfterMove(-800, 'black')).toBe(true);
        expect(hasDecisiveAdvantageAfterMove(-800, 'red')).toBe(false);
        expect(hasDecisiveAdvantageAfterMove(800, 'red')).toBe(true);
        expect(hasDecisiveAdvantageAfterMove(800, 'black')).toBe(false);
    });
});

describe('quality classification', () => {
    it('places a centipawn delta on the right side of each threshold', () => {
        expect(classifyMoveQuality(REVIEW_THRESHOLDS.best)).toBe('best');
        expect(classifyMoveQuality(REVIEW_THRESHOLDS.best + 1)).toBe('good');
        expect(classifyMoveQuality(REVIEW_THRESHOLDS.good)).toBe('good');
        expect(classifyMoveQuality(REVIEW_THRESHOLDS.good + 1)).toBe('inaccuracy');
        expect(classifyMoveQuality(REVIEW_THRESHOLDS.inaccuracy + 1)).toBe('mistake');
        expect(classifyMoveQuality(REVIEW_THRESHOLDS.mistake + 1)).toBe('blunder');
    });

    it('places a win-percent loss on the right side of each threshold', () => {
        expect(classifyWinPercentLoss(REVIEW_WIN_PERCENT_LOSS_THRESHOLDS.best)).toBe('best');
        expect(classifyWinPercentLoss(REVIEW_WIN_PERCENT_LOSS_THRESHOLDS.best + 0.1)).toBe('good');
        expect(classifyWinPercentLoss(REVIEW_WIN_PERCENT_LOSS_THRESHOLDS.mistake + 0.1)).toBe('blunder');
    });

    it('marks only the three qualities a review should surface as critical', () => {
        expect(isCriticalReviewQuality('best')).toBe(false);
        expect(isCriticalReviewQuality('good')).toBe(false);
        expect(isCriticalReviewQuality('inaccuracy')).toBe(true);
        expect(isCriticalReviewQuality('mistake')).toBe(true);
        expect(isCriticalReviewQuality('blunder')).toBe(true);
    });
});

describe('classifying against practical winning chances', () => {
    it('forgives a large centipawn drop in an already decided position', () => {
        // 500cp is a "blunder" on the raw scale, but going from +2000 to +1500
        // costs well under a percentage point of practical winning chances.
        expect(classifyMoveQuality(500)).toBe('blunder');
        expect(classifyMoveQualityForEval(500, 2000, 1500, 'red')).toBe('best');
    });

    it('softens a sharp position to the milder of the two readings', () => {
        expect(classifyMoveQuality(200)).toBe('mistake');
        expect(classifyMoveQualityForEval(200, 0, -200, 'red')).toBe('inaccuracy');
    });

    it('falls back to the raw reading when an evaluation is missing', () => {
        expect(classifyMoveQualityForEval(500, Number.NaN, 1500, 'red')).toBe('blunder');
        expect(classifyMoveQualityForEval(500, 2000, Number.NaN, 'red')).toBe('blunder');
    });
});

describe('side attribution', () => {
    it('reads the side off the piece letter case when there is one', () => {
        expect(getReviewSideForRecord({ uci: 'h2e2', piece: 'C', ply: 2 }, 5)).toBe('red');
        expect(getReviewSideForRecord({ uci: 'h9g7', piece: 'n', ply: 1 }, 4)).toBe('black');
    });

    it('falls back to the ply, then to the move index', () => {
        expect(getReviewSideForRecord({ uci: 'h2e2', ply: 1 }, 99)).toBe('red');
        expect(getReviewSideForRecord({ uci: 'h9g7', ply: 2 }, 99)).toBe('black');
        expect(getReviewSideForRecord({ uci: 'h2e2', ply: Number.NaN }, 0)).toBe('red');
        expect(getReviewSideForRecord({ uci: 'h9g7', ply: Number.NaN }, 1)).toBe('black');
    });

    it('counts a loss from the moving side’s point of view', () => {
        expect(getEvalLossForMove(300, 100, 'red')).toBe(200);
        expect(getEvalLossForMove(300, 100, 'black')).toBe(0);
        expect(getEvalLossForMove(-300, -100, 'black')).toBe(200);
        expect(getEvalLossForMove(-100, -300, 'black')).toBe(0);
    });
});

describe('review formatting', () => {
    it('shows a negligible loss as zero and scales precision with size', () => {
        expect(formatWinPercentLoss(0.04)).toBe('0%');
        expect(formatWinPercentLoss(5.5)).toBe('-5.5%');
        expect(formatWinPercentLoss(7)).toBe('-7%');
        expect(formatWinPercentLoss(12.4)).toBe('-12%');
    });

    it('counts qualities in the singular when there is one of them', () => {
        expect(formatReviewCount(1, 'mistake')).toBe('1 mistake');
        expect(formatReviewCount(2, 'mistake')).toBe('2 mistakes');
        expect(formatReviewCount(-3, 'mistake')).toBe('0 mistakes');
        expect(formatReviewQualityCount('inaccuracy', 1)).toBe('1 inaccuracy');
        expect(formatReviewQualityCount('inaccuracy', 3)).toBe('3 inaccuracies');
    });

    it('reports engine move times in whichever unit reads better', () => {
        expect(formatReviewEngineMoveTime(999)).toBe('999ms');
        expect(formatReviewEngineMoveTime(1500)).toBe('1.5s');
        expect(formatReviewEngineMoveTime(2000)).toBe('2s');
        expect(formatReviewEngineMoveTime(0)).toBe('unknown time');
        expect(formatReviewEngineMoveTime(Number.NaN)).toBe('unknown time');
    });

    it('rounds average centipawn loss and refuses to print a non-number', () => {
        expect(formatAverageCentipawnLoss(42.6)).toBe('43cp');
        expect(formatAverageCentipawnLoss(-5)).toBe('0cp');
        expect(formatAverageCentipawnLoss(Number.NaN)).toBe('n/a');
    });
});

describe('evaluation overrides', () => {
    it('reads an override out of either a Map or a plain object', () => {
        expect(getEvalOverride('node-1', new Map([['node-1', 120]]))).toBe(120);
        expect(getEvalOverride('node-1', { 'node-1': 120 })).toBe(120);
    });

    it('has no opinion when there are no overrides', () => {
        expect(getEvalOverride('node-1', null)).toBeUndefined();
        expect(getEvalOverride('node-1', undefined)).toBeUndefined();
        expect(getEvalOverride('missing', new Map([['node-1', 120]]))).toBeUndefined();
    });
});

describe('naming a quality in prose', () => {
    /**
     * "the review found a inaccuracy" shipped in the mistake drill's banner.
     * Only "inaccuracy" of the five words takes "an", so the whole set is
     * listed rather than the one that was wrong -- the point is that adding a
     * sixth quality cannot reintroduce this.
     */
    it.each([
        ['best', 'a best'],
        ['good', 'a good'],
        ['inaccuracy', 'an inaccuracy'],
        ['mistake', 'a mistake'],
        ['blunder', 'a blunder'],
    ] as const)('writes %s as "%s"', (quality, expected) => {
        expect(formatReviewQualityWithArticle(quality)).toBe(expected);
    });

    it('agrees with the bare label it is built from', () => {
        for (const quality of ['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as const) {
            expect(formatReviewQualityWithArticle(quality))
                .toMatch(new RegExp(`^an? ${formatReviewQuality(quality).toLowerCase()}$`));
        }
    });
});

describe('formatReviewProgressDetail', () => {
    it('counts positions, because a review searches one per move plus the start', () => {
        // A 240-move game is 241 searches; calling them moves would be off by one.
        expect(formatReviewProgressDetail(104, 241)).toBe('104 of 241 positions');
    });

    it('says nothing when there is no scale to report', () => {
        expect(formatReviewProgressDetail(0, 0)).toBeNull();
        expect(formatReviewProgressDetail(3, -1)).toBeNull();
        expect(formatReviewProgressDetail(3, Number.NaN)).toBeNull();
    });

    it('agrees with itself about one', () => {
        expect(formatReviewProgressDetail(0, 1)).toBe('0 of 1 position');
        expect(formatReviewProgressDetail(1, 1)).toBe('1 of 1 position');
    });

    it('never claims more work done than there is', () => {
        expect(formatReviewProgressDetail(999, 241)).toBe('241 of 241 positions');
        expect(formatReviewProgressDetail(-5, 241)).toBe('0 of 241 positions');
        expect(formatReviewProgressDetail(Number.NaN, 8)).toBe('0 of 8 positions');
    });
});
