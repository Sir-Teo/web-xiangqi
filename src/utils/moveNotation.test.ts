import { describe, expect, it } from 'vitest';
import {
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

    it('copes with a piece letter it does not know', () => {
        expect(() => formatMoveRecordLabel({ uci: 'h2e2', piece: 'Z' })).not.toThrow();
        expect(() => formatMoveRecordTitle({ uci: 'h2e2', piece: '' })).not.toThrow();
    });
});
