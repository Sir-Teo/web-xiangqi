import { describe, expect, it } from 'vitest';
import {
    SHARE_LINK_FAILED_HEADLINE,
    SHARE_VARIATIONS_FAILED_HEADLINE,
    describeShareLinkFailure,
    shareLinkHeadline,
    type ShareLinkFailure,
} from './shareLinkNotice';

const ALL: ShareLinkFailure[] = [
    { kind: 'too-long' },
    { kind: 'too-many-moves' },
    { kind: 'unreadable-move', token: 'z9z9' },
    { kind: 'unreadable-move' },
    { kind: 'bad-start-position' },
    { kind: 'illegal-move', moveNumber: 7, reason: 'rook path blocked' },
    { kind: 'variations' },
    { kind: 'variations-only' },
];

describe('describeShareLinkFailure', () => {
    it('has a sentence for every failure the link path can produce', () => {
        for (const failure of ALL) {
            const detail = describeShareLinkFailure(failure);
            expect(detail.length).toBeGreaterThan(20);
            expect(detail.endsWith('.')).toBe(true);
        }
    });

    it('says nothing twice: each failure reads differently', () => {
        const seen = new Set(ALL.map(describeShareLinkFailure));
        // The two `unreadable-move` shapes differ only by the token.
        expect(seen.size).toBe(ALL.length);
    });

    /**
     * The recipient did not write the link and cannot see the sender's console,
     * which is where this reason used to go.
     */
    it('names the move a broken link stops at, counted the way a record counts', () => {
        expect(describeShareLinkFailure({ kind: 'illegal-move', moveNumber: 1 })).toContain('move 1 for Red');
        expect(describeShareLinkFailure({ kind: 'illegal-move', moveNumber: 2 })).toContain('move 1 for Black');
        expect(describeShareLinkFailure({ kind: 'illegal-move', moveNumber: 7 })).toContain('move 4 for Red');
        expect(describeShareLinkFailure({ kind: 'illegal-move', moveNumber: 8 })).toContain('move 4 for Black');
    });

    /** Rejection reasons are written for the code that reads them, not a player. */
    it('turns the rules engine’s own words into a sentence', () => {
        const detail = describeShareLinkFailure({ kind: 'illegal-move', moveNumber: 3, reason: 'rook path blocked' });
        expect(detail).toContain('Chariot path is blocked.');
        expect(detail).not.toContain('rook');
    });

    it('quotes the token when there is one to quote', () => {
        expect(describeShareLinkFailure({ kind: 'unreadable-move', token: 'z9z9' })).toContain('"z9z9"');
    });

    /**
     * Only the case where the main line *did* load gets the softer headline.
     * A link that carried nothing usable did not load, whatever was in it.
     */
    it('keeps the headline the variations case earned, and only it', () => {
        expect(shareLinkHeadline({ kind: 'variations' })).toBe(SHARE_VARIATIONS_FAILED_HEADLINE);
        expect(shareLinkHeadline({ kind: 'variations-only' })).toBe(SHARE_LINK_FAILED_HEADLINE);
        expect(shareLinkHeadline({ kind: 'too-long' })).toBe(SHARE_LINK_FAILED_HEADLINE);
        expect(shareLinkHeadline({ kind: 'illegal-move', moveNumber: 2 })).toBe(SHARE_LINK_FAILED_HEADLINE);
    });
});
