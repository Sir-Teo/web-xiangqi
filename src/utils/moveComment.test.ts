import { describe, expect, it } from 'vitest';
import {
    MAX_MOVE_COMMENT_LENGTH,
    isSameMoveComment,
    normalizeMoveComment,
    summarizeMoveComment,
} from './moveComment';

describe('normalizeMoveComment', () => {
    it('keeps an ordinary note as written', () => {
        expect(normalizeMoveComment('Cannon here first, or the horse has no square.'))
            .toBe('Cannon here first, or the horse has no square.');
    });

    it('treats an empty note and no note as the same thing', () => {
        expect(normalizeMoveComment('')).toBeUndefined();
        expect(normalizeMoveComment('   ')).toBeUndefined();
        expect(normalizeMoveComment(undefined)).toBeUndefined();
        expect(normalizeMoveComment(null)).toBeUndefined();
        expect(normalizeMoveComment(42)).toBeUndefined();
    });

    /**
     * A comment travels through a PGN `{ ... }` and a base64 URL parameter.
     * Neither carries a line break, so a multi-line note exported and
     * re-imported came back as several broken ones.
     */
    it('folds line breaks to spaces', () => {
        expect(normalizeMoveComment('first line\nsecond line')).toBe('first line second line');
        expect(normalizeMoveComment('tabbed\there')).toBe('tabbed here');
        expect(normalizeMoveComment('a\r\n\r\nb')).toBe('a b');
    });

    /**
     * Separate from the line breaks above, and the reason the control-character
     * pass exists at all: `\s` already covers newlines and tabs, so a test
     * using only those passes with that pass deleted. A bell or a NUL is not
     * whitespace and would reach storage, a PGN and a URL intact.
     */
    it('folds the control characters whitespace does not cover', () => {
        expect(normalizeMoveComment('bell\u0007here')).toBe('bell here');
        expect(normalizeMoveComment('nul\u0000in the middle')).toBe('nul in the middle');
        expect(normalizeMoveComment('\u007f')).toBeUndefined();
    });

    /** `}` ends a PGN comment: one typed mid-note would truncate the export. */
    it('removes braces, which would end the comment early in a PGN', () => {
        expect(normalizeMoveComment('the {main} idea}')).toBe('the main idea');
        expect(normalizeMoveComment('}')).toBeUndefined();
    });

    it('bounds what it stores', () => {
        const long = 'x'.repeat(MAX_MOVE_COMMENT_LENGTH + 200);
        expect(normalizeMoveComment(long)).toHaveLength(MAX_MOVE_COMMENT_LENGTH);
    });

    /** Normalising twice must not change anything, since storage round-trips. */
    it('is idempotent', () => {
        const once = normalizeMoveComment('  a }note{  with\nlines  ');
        expect(normalizeMoveComment(once)).toBe(once);
    });
});

describe('isSameMoveComment', () => {
    it('treats undefined and empty as unchanged', () => {
        expect(isSameMoveComment(undefined, undefined)).toBe(true);
        expect(isSameMoveComment('a', 'a')).toBe(true);
        expect(isSameMoveComment('a', undefined)).toBe(false);
    });
});

describe('summarizeMoveComment', () => {
    it('leaves a short note alone', () => {
        expect(summarizeMoveComment('Short note')).toBe('Short note');
    });

    it('cuts a long note at a word', () => {
        const summary = summarizeMoveComment('The chariot belongs on the open file before anything else happens', 30);
        expect(summary.endsWith('…')).toBe(true);
        expect(summary.length).toBeLessThanOrEqual(31);
        expect(summary).not.toContain('  ');
    });

    it('cuts mid-word rather than throwing away most of a long first word', () => {
        expect(summarizeMoveComment('Supercalifragilisticexpialidocious', 12)).toBe('Supercalifra…');
    });

    /**
     * The case above has no space in it at all, so it passes whatever the
     * word-boundary rule is. This one has a space in the wrong place: cutting
     * at it would leave one letter of a note that had room for nineteen.
     */
    it('ignores a word boundary too early to be worth cutting at', () => {
        expect(summarizeMoveComment('a supercalifragilisticexpialidocious plan', 20)).toBe('a supercalifragilist…');
    });
});
