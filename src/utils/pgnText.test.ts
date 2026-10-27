import { describe, expect, it } from 'vitest';
import { firstPgnGame, pgnMetadataSpans } from './pgnText';
import { extractUciMoveTree } from './moveImport';

/**
 * Two games where the first one's comment is never closed -- a record
 * truncated in transit, or hand-edited badly.
 *
 * `pgnMetadataSpans` documents the recovery for this: the opener is left where
 * it is and what follows is still read as moves, so a truncation does not cost
 * the moves before it. `pgnTokens` did the opposite -- its `\{[^}]*(?:\}|$)`
 * alternative ran the comment to end of input -- and the two are used on the
 * same text by `extractUciMoveTree`.
 */
const TRUNCATED_FIRST_COMMENT = [
    '[Event "one"]',
    '1. h2e2 {oops',
    '',
    '[Event "two"]',
    '1. b2e2 h9g7 1-0',
    '',
].join('\n');

/** The same two games with the comment closed. Proves the fixture is sound. */
const CLOSED_FIRST_COMMENT = TRUNCATED_FIRST_COMMENT.replace('{oops', '{oops}');

describe('firstPgnGame', () => {
    it('keeps punctuation and empty metadata intact when no game boundary is possible', () => {
        for (const source of ['', ';\n'.repeat(1000), '%\n'.repeat(1000), '{}[]'.repeat(1000), '炮二平五 馬８進７', '{未完的註解']) {
            expect(firstPgnGame(source)).toEqual({ text: source, truncated: false });
        }
    });

    it('still recognizes every result and header boundaries after punctuation', () => {
        for (const marker of ['1-0', '0-1', '1/2-1/2', '*']) {
            expect(firstPgnGame(`{} ${marker} h2e2`)).toEqual({ text: `{} ${marker} `, truncated: true, marker });
        }
        expect(firstPgnGame('{} [] 炮二平五 [Event "Next"] h2e2').text).toBe('{} [] 炮二平五 ');
    });

    it('stops at the second game even when the first comment is never closed', () => {
        // The control first: without the defect this shape splits correctly,
        // so a green result below cannot be the fixture being unreadable.
        const closed = firstPgnGame(CLOSED_FIRST_COMMENT);
        expect(closed.truncated).toBe(true);
        expect(closed.text).not.toContain('two');

        const truncated = firstPgnGame(TRUNCATED_FIRST_COMMENT);
        expect(truncated.truncated).toBe(true);
        expect(truncated.text).not.toContain('two');
    });

    it('agrees with pgnMetadataSpans about where an unclosed comment ends', () => {
        // The span walker leaves the opener in place and keeps reading; the
        // tokenizer must not swallow the rest of the file as one comment.
        const spans = [...pgnMetadataSpans(TRUNCATED_FIRST_COMMENT)];
        expect(spans.some((span) => span.start === TRUNCATED_FIRST_COMMENT.indexOf('{oops'))).toBe(false);
        expect(firstPgnGame(TRUNCATED_FIRST_COMMENT).text).not.toContain('b2e2');
    });
});

describe('extractUciMoveTree', () => {
    it('does not splice the next game onto a record truncated mid-comment', () => {
        const closed = extractUciMoveTree(CLOSED_FIRST_COMMENT);
        expect(closed.moves).toEqual(['h2e2']);
        expect(closed.hadMoreGames).toBe(true);

        // Same file, one missing `}`. The second game's moves were being played
        // onto the end of the first, and `hadMoreGames` said there was nothing
        // left behind -- so the reader was never told either.
        const truncated = extractUciMoveTree(TRUNCATED_FIRST_COMMENT);
        expect(truncated.moves).toEqual(['h2e2']);
        expect(truncated.hadMoreGames).toBe(true);
    });
});

it('keeps ordinary records and script-like text without inventing a game boundary', () => {
    for (const text of ['h2e2 h9g7', 'function f(){return[1,2,3]}'.repeat(100), '{Leading note} 炮二平五']) {
        expect(firstPgnGame(text)).toEqual({ text, truncated: false });
    }
});

it('still recognizes spaced tag names and every result marker after movetext', () => {
    expect(firstPgnGame('h2e2 [  Event "Next"] h9g7').text).toBe('h2e2 ');
    for (const marker of ['1-0', '0-1', '1/2-1/2', '*']) {
        const text = `h2e2 ${marker} h9g7`;
        expect(firstPgnGame(text)).toEqual({ text: `h2e2 ${marker} `, truncated: true, marker });
    }
});
