import { describe, expect, it } from 'vitest';
import {
    describeMoveWithCheck,
    formatMoveRecordLabel,
    formatMoveRecordTitle,
    formatUciLine,
    formatUciMove,
} from './moveNotation';

describe('formatting a move', () => {
    it('shows a move as from and to, uppercased', () => {
        expect(formatUciMove('h2e2')).toBe('H2→E2');
        expect(formatUciMove('h2e2', '-')).toBe('H2-E2');
    });

    it('hands back anything it cannot read rather than mangling it', () => {
        expect(formatUciMove('nope')).toBe('NOPE');
        expect(formatUciMove('')).toBe('');
    });
});

describe('formatting a line', () => {
    it('joins moves and says how many were left out', () => {
        expect(formatUciLine(['h2e2', 'h9g7'])).toBe('H2→E2 H9→G7');
        const long = Array.from({ length: 10 }, () => 'h2e2');
        expect(formatUciLine(long, 3)).toContain('H2→E2 H2→E2 H2→E2');
        expect(formatUciLine(long, 3)).toMatch(/7/);
    });

    it('has nothing to say about an empty line', () => {
        expect(formatUciLine([])).toBe('');
    });

    it('says nothing about the remainder when there is none', () => {
        // Exactly the cap, not one over. `> 0` read as `>= 0` appends " +0" to
        // every line that happens to be exactly as long as the limit, and no
        // fixture sat on the limit to notice.
        const exactly = ['h2e2', 'h9g7', 'b2e2'];
        expect(formatUciLine(exactly, 3)).toBe('H2→E2 H9→G7 B2→E2');
        expect(formatUciLine(exactly, 3)).not.toContain('+');
        // The control: one more move and the remainder is reported.
        expect(formatUciLine([...exactly, 'b0c2'], 3)).toBe('H2→E2 H9→G7 B2→E2 +1');
    });
});

describe('labelling a move record', () => {
    it('names the piece that moved', () => {
        expect(formatMoveRecordLabel({ uci: 'h2e2', piece: 'C' })).toContain('炮');
        expect(formatMoveRecordLabel({ uci: 'h9g7', piece: 'n' })).toContain('馬');
    });

    it('describes the move in words for a screen reader', () => {
        const title = formatMoveRecordTitle({ uci: 'h2e2', piece: 'C' });
        expect(title).toContain('Red cannon');
        expect(title.toLowerCase()).toContain('h2');
        expect(title.toLowerCase()).toContain('e2');
    });

    it('names what a capture took', () => {
        expect(formatMoveRecordTitle({ uci: 'h2e2', piece: 'C', captured: 'p' }))
            .toBe('Red cannon from H2 captures Black soldier on E2');
    });

    it('still describes a capture when the taken piece is unreadable', () => {
        expect(formatMoveRecordTitle({ uci: 'h2e2', piece: 'C', captured: 'Z' }))
            .toBe('Red cannon from H2 captures on E2');
    });

    it('says a plain move is a move', () => {
        expect(formatMoveRecordTitle({ uci: 'h2e2', piece: 'C' }))
            .toBe('Red cannon from H2 moves to E2');
    });

    /**
     * The flag is on every record and reached nothing that lists moves. A
     * reader scanning the move list or the breadcrumb could not tell a check
     * from a quiet move, and the board's CHECK badge only ever speaks for the
     * position on screen.
     */
    it('says when a move gave check, move or capture alike', () => {
        expect(describeMoveWithCheck({ uci: 'h2e2', piece: 'C', inCheck: true }))
            .toBe('Red cannon from H2 moves to E2, giving check');
        expect(describeMoveWithCheck({ uci: 'h2e2', piece: 'C', captured: 'p', inCheck: true }))
            .toBe('Red cannon from H2 captures Black soldier on E2, giving check');
        expect(describeMoveWithCheck({ uci: 'h2e2', piece: 'C', captured: 'Z', inCheck: true }))
            .toBe('Red cannon from H2 captures on E2, giving check');
    });

    it('leaves a quiet move exactly as the plain title has it', () => {
        expect(describeMoveWithCheck({ uci: 'h2e2', piece: 'C', inCheck: false }))
            .toBe('Red cannon from H2 moves to E2');
        expect(describeMoveWithCheck({ uci: 'h2e2', piece: 'C' }))
            .toBe('Red cannon from H2 moves to E2');
    });

    /**
     * The board's live region composes its own sentence and has a `Check.`
     * clause -- and a `Checkmate.` that replaces it. A title that always
     * carried the phrase made that announcement say check twice.
     */
    it('leaves the plain title free of it, for the announcer that says it itself', () => {
        expect(formatMoveRecordTitle({ uci: 'h2e2', piece: 'C', inCheck: true }))
            .toBe('Red cannon from H2 moves to E2');
    });

    /**
     * The visible move is what a record would print, and in WXF a trailing
     * `+` already means *advance*. A check marker there would be the same
     * character meaning two things in one token.
     */
    it('keeps the check out of the visible label', () => {
        expect(formatMoveRecordLabel({ uci: 'h2e2', piece: 'C', inCheck: true }))
            .toBe(formatMoveRecordLabel({ uci: 'h2e2', piece: 'C' }));
    });

    it('still says it when the coordinates cannot be read', () => {
        expect(describeMoveWithCheck({ uci: 'nope', piece: 'C', inCheck: true }))
            .toBe('Red cannon NOPE, giving check');
    });

    it('copes with a piece letter it does not know', () => {
        expect(() => formatMoveRecordLabel({ uci: 'h2e2', piece: 'Z' })).not.toThrow();
        expect(() => formatMoveRecordTitle({ uci: 'h2e2', piece: '' })).not.toThrow();
    });
});
