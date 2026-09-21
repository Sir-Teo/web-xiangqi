import { describe, expect, it } from 'vitest';
import { MATE_SCORE_BASE } from './engineEvalReading';
import { extractPgnEvalCommands, parseEvalCommand, parsePgnMoveQuality } from './pgnEvaluation';

describe('parsePgnMoveQuality', () => {
    it('maps only the three glyphs this app has a grade for', () => {
        expect(parsePgnMoveQuality('$6')).toBe('inaccuracy');
        expect(parsePgnMoveQuality('?!')).toBe('inaccuracy');
        expect(parsePgnMoveQuality('$2')).toBe('mistake');
        expect(parsePgnMoveQuality('?')).toBe('mistake');
        expect(parsePgnMoveQuality('$4')).toBe('blunder');
        expect(parsePgnMoveQuality('??')).toBe('blunder');
        // `!`, `!!` and `$1` are real PGN and have no grade here; they must not
        // fall through to one of the three above.
        for (const token of ['!', '!!', '$1', '$3', '$5', '!?', '', 'x']) {
            expect(parsePgnMoveQuality(token)).toBeUndefined();
        }
    });
});

describe('parseEvalCommand', () => {
    it('reads a signed pawn score as centipawns', () => {
        expect(parseEvalCommand('[%eval 1.5]')).toEqual({ evalScore: 150 });
        expect(parseEvalCommand('[%eval -0.25]')).toEqual({ evalScore: -25 });
        expect(parseEvalCommand('[%eval +2]')).toEqual({ evalScore: 200 });
        // The shapes the pattern allows besides the obvious one.
        expect(parseEvalCommand('[%eval .5]')).toEqual({ evalScore: 50 });
        expect(parseEvalCommand('[%eval 1.]')).toEqual({ evalScore: 100 });
    });

    it('encodes a mate distance against the sentinel base, keeping its sign', () => {
        expect(parseEvalCommand('[%eval #5]')).toEqual({ evalScore: MATE_SCORE_BASE - 5 });
        expect(parseEvalCommand('[%eval #-5]')).toEqual({ evalScore: -(MATE_SCORE_BASE - 5) });
        // Not a centipawn reading, so no 'cp' override is written for it.
        expect(parseEvalCommand('[%eval #5]')).not.toHaveProperty('evalScoreKind');
    });

    it('marks a centipawn score that lands in the mate range, so it stays centipawns', () => {
        // 200 pawns is 20000, which decodes as a mate in 10000 unless the kind
        // is recorded. A score outside that range needs no override.
        expect(parseEvalCommand('[%eval 200]')).toEqual({ evalScore: 20000, evalScoreKind: 'cp' });
        expect(parseEvalCommand('[%eval 1.5]')).not.toHaveProperty('evalScoreKind');
    });

    it('skips a mate distance too large for the encoding', () => {
        // The control: one just inside the limit is read.
        expect(parseEvalCommand(`[%eval #${MATE_SCORE_BASE / 2}]`)).toEqual({ evalScore: MATE_SCORE_BASE / 2 });
        expect(parseEvalCommand(`[%eval #${MATE_SCORE_BASE / 2 + 1}]`)).toBeUndefined();
    });

    it('reads an optional depth and refuses one out of range', () => {
        expect(parseEvalCommand('[%eval 1.5,24]')).toEqual({ evalScore: 150, evalDepth: 24 });
        // normalizeEvalDepth caps at 65535; the score survives, the depth does not.
        expect(parseEvalCommand('[%eval 1.5,65536]')).toEqual({ evalScore: 150 });
    });

    it('takes the first evaluation when a comment carries several', () => {
        expect(parseEvalCommand('[%eval 1.5] and later [%eval -3.0]')).toEqual({ evalScore: 150 });
    });

    it('finds nothing in a comment that has none', () => {
        expect(parseEvalCommand('a plain note')).toBeUndefined();
        expect(parseEvalCommand('[%eval]')).toBeUndefined();
        expect(parseEvalCommand('[%eval abc]')).toBeUndefined();
    });
});

describe('extractPgnEvalCommands', () => {
    it('lifts the score out and leaves the rest of the note readable', () => {
        const { evaluation, prose } = extractPgnEvalCommands('before [%eval 1.5] after');
        expect(evaluation).toEqual({ evalScore: 150 });
        expect(prose.replace(/\s+/g, ' ').trim()).toBe('before after');
    });

    it('keeps a command it cannot read as note text', () => {
        // Documented: "preserve invalid/unknown commands as note text". An
        // over-large mate is the readable-but-unusable case.
        const { evaluation, prose } = extractPgnEvalCommands(`note [%eval #${MATE_SCORE_BASE}] end`);
        expect(evaluation).toBeUndefined();
        expect(prose).toContain(`[%eval #${MATE_SCORE_BASE}]`);
        // The control: the same shape within range is lifted out instead.
        expect(extractPgnEvalCommands('note [%eval #3] end').prose).not.toContain('[%eval');
    });

    it('leaves a separator behind, so a command between two words does not join them', () => {
        // Found by mutation: every other case here has spaces around the
        // command, so dropping the replacement space changed nothing they saw.
        expect(extractPgnEvalCommands('good[%eval 1.5]risky').prose).toBe('good risky');
    });

    it('keeps a score too large to hold as note text rather than storing it', () => {
        // Math.round of a 1e19 pawn score is past Number.MAX_SAFE_INTEGER, so
        // it is not a reading. The control is the same shape at a sane size.
        const absurd = extractPgnEvalCommands('[%eval 99999999999999999]');
        expect(absurd.evaluation).toBeUndefined();
        expect(absurd.prose).toContain('[%eval 99999999999999999]');
        expect(extractPgnEvalCommands('[%eval 9.99]').evaluation).toEqual({ evalScore: 999 });
    });

    it('removes every readable command, not only the one it kept', () => {
        const { evaluation, prose } = extractPgnEvalCommands('[%eval 1.5] middle [%eval -3.0]');
        expect(evaluation).toEqual({ evalScore: 150 });
        expect(prose).not.toContain('[%eval');
        expect(prose.replace(/\s+/g, ' ').trim()).toBe('middle');
    });
});
