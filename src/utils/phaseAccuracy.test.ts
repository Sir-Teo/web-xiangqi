import { describe, expect, it } from 'vitest';
import { parseFenBoard, START_FEN } from './xiangqi';
import { getMoveAccuracyForWinPercentLoss, summarizeAccuracyByPhase } from './review';
import type { PhaseAccuracyRecordLike } from './review';

const OPENING = parseFenBoard(START_FEN);
/** Both chariots traded off: no longer an opening by material. */
const MIDDLEGAME = parseFenBoard('1nbakabn1/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/1NBAKABN1');
/** A chariot and cannon each. */
const ENDGAME = parseFenBoard('r3k3c/9/9/9/9/9/9/9/9/R3K3C');

function record(
    board: typeof OPENING,
    ply: number,
    winPercentLoss: number,
    extra: Partial<PhaseAccuracyRecordLike> = {},
): PhaseAccuracyRecordLike {
    return { uci: 'a0a1', ply, board, winPercentLoss, piece: ply % 2 === 1 ? 'R' : 'r', ...extra };
}

describe('summarizing xiangqi accuracy by phase', () => {
    it('reports only the phases the game actually reached', () => {
        const phases = summarizeAccuracyByPhase([record(OPENING, 1, 0), record(OPENING, 2, 0)]);
        expect(phases.map(entry => entry.phase)).toEqual(['opening']);
    });

    it('keeps the phases in playing order', () => {
        const phases = summarizeAccuracyByPhase([
            record(ENDGAME, 61, 0),
            record(MIDDLEGAME, 31, 0),
            record(OPENING, 1, 0),
        ]);
        expect(phases.map(entry => entry.phase)).toEqual(['opening', 'middleGame', 'endgame']);
    });

    it('scores a phase with the same curve as the overall summary', () => {
        const [opening] = summarizeAccuracyByPhase([record(OPENING, 1, 12)]);
        expect(opening.accuracy).toBe(Math.round(getMoveAccuracyForWinPercentLoss(12)));
    });

    it('splits a phase by side', () => {
        // Red plays perfectly on the odd plies; black gives away 20 points each time.
        const phases = summarizeAccuracyByPhase([
            record(OPENING, 1, 0),
            record(OPENING, 2, 20),
            record(OPENING, 3, 0),
            record(OPENING, 4, 20),
        ]);
        expect(phases[0].redAccuracy).toBe(Math.round(getMoveAccuracyForWinPercentLoss(0)));
        expect(phases[0].blackAccuracy).toBe(Math.round(getMoveAccuracyForWinPercentLoss(20)));
        expect(phases[0].redAccuracy).toBeGreaterThan(phases[0].blackAccuracy as number);
    });

    it('leaves out a side that never moved in that phase', () => {
        const [endgame] = summarizeAccuracyByPhase([record(ENDGAME, 61, 0)]);
        expect(endgame.redAccuracy).toBeDefined();
        expect(endgame.blackAccuracy).toBeUndefined();
    });

    it('counts the moves it scored', () => {
        const phases = summarizeAccuracyByPhase([
            record(OPENING, 1, 0),
            record(OPENING, 2, 0),
            record(ENDGAME, 61, 0),
        ]);
        expect(phases.map(entry => entry.moves)).toEqual([2, 1]);
    });

    it('skips a move that was never evaluated', () => {
        const unevaluated = { uci: 'a0a1', ply: 3, board: OPENING };
        expect(summarizeAccuracyByPhase([unevaluated])).toEqual([]);
    });

    it('skips a record with no board rather than guessing a phase', () => {
        expect(summarizeAccuracyByPhase([{ uci: 'a0a1', ply: 1, winPercentLoss: 0 }])).toEqual([]);
    });

    it('says nothing about a game with nothing in it', () => {
        expect(summarizeAccuracyByPhase([])).toEqual([]);
    });

    it('files a capture in the phase it was played in', () => {
        // The board left is a chariot and cannon each — an endgame — but this
        // move took a chariot, so it was played in a middlegame.
        const phases = summarizeAccuracyByPhase([record(ENDGAME, 41, 0, { captured: 'r' })]);
        expect(phases.map(entry => entry.phase)).toEqual(['middleGame']);
    });
});
