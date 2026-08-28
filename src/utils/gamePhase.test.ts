import { describe, expect, it } from 'vitest';
import { parseFenBoard, START_FEN } from './xiangqi';
import {
    FULL_ATTACKING_MATERIAL,
    attackingMaterial,
    attackingPieceValue,
    getMovePhaseForRecord,
    getPhaseLabel,
} from './gamePhase';

const START = parseFenBoard(START_FEN);

/** Every rank empty but the ones spelt out, so material is exactly what is written. */
const boardFrom = (fen: string) => parseFenBoard(fen);

describe('counting the attacking pieces', () => {
    it('starts at a full set', () => {
        expect(attackingMaterial(START)).toBe(FULL_ATTACKING_MATERIAL);
    });

    it('ignores the pieces that never leave home', () => {
        // Kings, advisors, elephants and pawns are all worth nothing here.
        expect(attackingMaterial(boardFrom('4k4/4a4/4b4/p1p1p1p1p/9/9/9/9/9/4K4'))).toBe(0);
    });

    it('values a chariot above a cannon above a horse', () => {
        expect(attackingPieceValue('r')).toBe(9);
        expect(attackingPieceValue('c')).toBe(5);
        expect(attackingPieceValue('n')).toBe(4);
    });

    it('counts both colours the same', () => {
        expect(attackingPieceValue('R')).toBe(attackingPieceValue('r'));
    });

    it('is worth nothing for an empty square or a piece that does not attack', () => {
        expect(attackingPieceValue(null)).toBe(0);
        expect(attackingPieceValue('')).toBe(0);
        expect(attackingPieceValue('a')).toBe(0);
        expect(attackingPieceValue('k')).toBe(0);
        expect(attackingPieceValue('p')).toBe(0);
    });
});

describe('deciding which phase a move belongs to', () => {
    const record = (fen: string, captured = '') => ({ board: boardFrom(fen), captured });

    it('opens in the opening', () => {
        expect(getMovePhaseForRecord(record(START_FEN), 1)).toBe('opening');
        expect(getMovePhaseForRecord(record(START_FEN), 24)).toBe('opening');
    });

    it('stops calling it an opening once the game has gone on', () => {
        expect(getMovePhaseForRecord(record(START_FEN), 30)).toBe('middleGame');
    });

    it('tolerates one pair of horses being swapped early', () => {
        const oneHorsePairOff = 'r1bakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKAB1R';
        expect(getMovePhaseForRecord(record(oneHorsePairOff), 11)).toBe('opening');
    });

    it('ends the opening when the chariots come off', () => {
        const rooksOff = '1nbakabn1/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/1NBAKABN1';
        expect(getMovePhaseForRecord(record(rooksOff), 11)).toBe('middleGame');
    });

    it('reads a chariot-and-cannon ending as an endgame', () => {
        const ending = '3ak4/4a4/9/9/9/9/9/4C4/9/3AKA2R';
        expect(attackingMaterial(boardFrom(ending))).toBe(14);
        expect(getMovePhaseForRecord(record(ending), 79)).toBe('endgame');
    });

    it('does not call two chariots each an endgame', () => {
        const doubleRooks = 'r2ak2br/9/9/9/9/9/9/9/9/R2AK2BR';
        expect(getMovePhaseForRecord(record(doubleRooks), 60)).toBe('middleGame');
    });

    it('files the move that crosses the line on the side it started', () => {
        // The board left behind is a chariot and cannon each, which is an
        // endgame. But this move took a chariot, so the position it was
        // actually played in still had one more on it — a middlegame.
        const afterTheCapture = 'r3k3c/9/9/9/9/9/9/9/9/R3K3C';
        expect(attackingMaterial(boardFrom(afterTheCapture))).toBe(28);
        expect(getMovePhaseForRecord({ board: boardFrom(afterTheCapture), captured: '' }, 50))
            .toBe('endgame');
        expect(getMovePhaseForRecord({ board: boardFrom(afterTheCapture), captured: 'r' }, 50))
            .toBe('middleGame');
    });

    it('names every phase it can return', () => {
        expect(getPhaseLabel('opening')).toBe('Opening');
        expect(getPhaseLabel('middleGame')).toBe('Middlegame');
        expect(getPhaseLabel('endgame')).toBe('Endgame');
    });
});
