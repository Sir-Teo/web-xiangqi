import { describe, expect, it } from 'vitest';
import { MATE_SCORE_BASE } from './engineEvalReading';
import { annotationTokensForMove, formatEvalCommand, hasAnythingToAnnotate } from './pgnAnnotations';

describe('the eval command', () => {
    it('writes centipawns as pawns, red-positive, to two places', () => {
        expect(formatEvalCommand(38)).toBe('[%eval 0.38]');
        expect(formatEvalCommand(-180)).toBe('[%eval -1.80]');
        expect(formatEvalCommand(0)).toBe('[%eval 0.00]');
    });

    it('writes a mate as a distance in moves rather than as 300 pawns', () => {
        // The engine encodes mate as a sentinel score, so writing it as an
        // evaluation would put "#3" into the file as "299.97".
        expect(formatEvalCommand(MATE_SCORE_BASE - 3)).toBe('[%eval #3]');
        expect(formatEvalCommand(-(MATE_SCORE_BASE - 3))).toBe('[%eval #-3]');
        expect(formatEvalCommand(MATE_SCORE_BASE)).toBe('[%eval #0]');
    });

    it('says nothing for a score that is not a number', () => {
        expect(formatEvalCommand(Number.NaN)).toBeNull();
        expect(formatEvalCommand(Number.POSITIVE_INFINITY)).toBeNull();
    });
});

describe('the tokens after a move', () => {
    it('gives a glyph only to the qualities that have one', () => {
        expect(annotationTokensForMove({ quality: 'inaccuracy' })).toEqual(['$6']);
        expect(annotationTokensForMove({ quality: 'mistake' })).toEqual(['$2']);
        expect(annotationTokensForMove({ quality: 'blunder' })).toEqual(['$4']);
    });

    it('leaves a good move unmarked, which is the convention', () => {
        expect(annotationTokensForMove({ quality: 'best' })).toEqual([]);
        expect(annotationTokensForMove({ quality: 'good' })).toEqual([]);
    });

    it('names the engine preference only where it is the point', () => {
        expect(annotationTokensForMove({ quality: 'blunder', bestMove: 'h2e2', uci: 'a0a1', evalScore: -820 }))
            .toEqual(['$4', '{ [%eval -8.20] Better was h2e2 }']);
        // On a move already graded good there is nothing to say.
        expect(annotationTokensForMove({ quality: 'good', bestMove: 'h2e2', uci: 'a0a1', evalScore: 30 }))
            .toEqual(['{ [%eval 0.30] }']);
    });

    it('does not tell you the move you played was better than itself', () => {
        expect(annotationTokensForMove({ quality: 'mistake', bestMove: 'h2e2', uci: 'h2e2' }))
            .toEqual(['$2']);
    });

    it('says nothing at all about a move nothing has reviewed', () => {
        expect(annotationTokensForMove({ uci: 'h2e2' })).toEqual([]);
        expect(hasAnythingToAnnotate([{ uci: 'h2e2' }, { uci: 'h9g7' }])).toBe(false);
        expect(hasAnythingToAnnotate([{ uci: 'h2e2' }, { uci: 'h9g7', evalScore: 12 }])).toBe(true);
    });
});
