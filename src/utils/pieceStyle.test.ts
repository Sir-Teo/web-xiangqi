import { describe, expect, it } from 'vitest';
import { isPieceStyle, pieceLabel } from './pieceStyle';
import { formatWxfMove } from './xiangqiNotation';
import { START_FEN, parseFenBoard } from './xiangqi';

describe('piece labels', () => {
    it('draws the traditional set with the red and black characters as printed', () => {
        expect(pieceLabel('K', 'traditional')).toBe('帥');
        expect(pieceLabel('k', 'traditional')).toBe('將');
        expect(pieceLabel('n', 'traditional')).toBe('馬');
    });

    it('draws the letter set with the letters the move list uses', () => {
        // The board and the notation must agree, or the letters teach nothing.
        expect(pieceLabel('C', 'letters')).toBe(formatWxfMove(parseFenBoard(START_FEN), 'h2e2')?.[0]);
        expect(pieceLabel('n', 'letters')).toBe(formatWxfMove(parseFenBoard(START_FEN), 'h9g7')?.[0]);
        expect(pieceLabel('B', 'letters')).toBe('E');
        expect(pieceLabel('b', 'letters')).toBe('E');
        expect(pieceLabel('P', 'letters')).toBe('P');
        expect(pieceLabel('k', 'letters')).toBe('K');
    });

    it('recognises only the two styles', () => {
        expect(isPieceStyle('traditional')).toBe(true);
        expect(isPieceStyle('letters')).toBe(true);
        expect(isPieceStyle('western')).toBe(false);
        expect(isPieceStyle(undefined)).toBe(false);
    });
});
