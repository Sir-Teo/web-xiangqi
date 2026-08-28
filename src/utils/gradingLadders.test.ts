import { describe, expect, it } from 'vitest';
import {
    REVIEW_THRESHOLDS,
    REVIEW_WIN_PERCENT_LOSS_THRESHOLDS,
    classifyMoveQuality,
    classifyMoveQualityForEval,
    getWinPercentLossForMove,
} from './review';

/**
 * These record how the two grading ladders currently relate. They change no
 * behaviour; they make an accidental relationship a stated one.
 *
 * `classifyMoveQualityForEval` grades on centipawns and on winning chances and
 * keeps the milder. That is only sound if the ladders are calibrated against
 * each other, and here they are independent constants that cross — so the
 * looser one decides wherever they disagree. See docs/architecture.md.
 *
 * If either ladder is edited, the failures here say exactly which grades moved
 * and whether the two came closer together or further apart.
 */

/** Red to move from a level position, giving up `loss` centipawns. */
const gradeAtEquality = (loss: number) =>
    classifyMoveQualityForEval(loss, 0, -loss, 'red');

describe('what each centipawn boundary really costs in winning chances', () => {
    // Measured at equality; the win-percent ladder is set independently of these.
    const cases: Array<[keyof typeof REVIEW_THRESHOLDS, number]> = [
        ['best', 3.68],
        ['good', 8.21],
        ['inaccuracy', 15.99],
        ['mistake', 26.46],
    ];

    for (const [name, expected] of cases) {
        it(`${name}: ${REVIEW_THRESHOLDS[name]}cp costs about ${expected} win%`, () => {
            const cp = REVIEW_THRESHOLDS[name];
            expect(getWinPercentLossForMove(0, -cp, 'red')).toBeCloseTo(expected, 1);
        });
    }

    it('is stricter than the win-percent ladder at the top and looser below it', () => {
        // 40cp really costs 3.68 win% but the "best" bound is 2; 180cp really
        // costs 15.99 but the "inaccuracy" bound is 20. The ladders cross.
        expect(getWinPercentLossForMove(0, -REVIEW_THRESHOLDS.best, 'red'))
            .toBeGreaterThan(REVIEW_WIN_PERCENT_LOSS_THRESHOLDS.best);
        expect(getWinPercentLossForMove(0, -REVIEW_THRESHOLDS.inaccuracy, 'red'))
            .toBeLessThan(REVIEW_WIN_PERCENT_LOSS_THRESHOLDS.inaccuracy);
    });
});

describe('where the disagreement changes a grade', () => {
    it('grades a 190cp loss at equality below its own centipawn ladder', () => {
        // The centipawn ladder calls anything past 180 a mistake. The milder
        // winning-chance reading wins, so it lands an inaccuracy — at equality,
        // where "the position was already decided" is no defence.
        expect(classifyMoveQuality(190)).toBe('mistake');
        expect(gradeAtEquality(190)).toBe('inaccuracy');
    });

    it('does the same at 200cp', () => {
        expect(classifyMoveQuality(200)).toBe('mistake');
        expect(gradeAtEquality(200)).toBe('inaccuracy');
    });

    it('leaves the top of the ladder alone, where centipawns are the milder read', () => {
        // Here the win-percent ladder is the stricter one, so it never bites.
        expect(gradeAtEquality(30)).toBe('best');
        expect(gradeAtEquality(80)).toBe('good');
    });

    it('still agrees at the extremes', () => {
        expect(gradeAtEquality(0)).toBe('best');
        expect(gradeAtEquality(2000)).toBe('blunder');
    });
});
