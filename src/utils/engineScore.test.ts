import { describe, expect, it } from 'vitest';
import {
  formatEvalScore,
  formatMateScoreText,
  formatRedPovEngineScore,
  normalizeEvalForFen,
  normalizeEvalForSide,
  normalizeWdlForSide,
  parseMateScoreText,
  sideFromFen,
} from './engineScore';
import { START_POSITION_FEN } from './xiangqi';

/**
 * The engine speaks from the side to move; the board speaks from Red. These
 * tests are all about that one boundary, because crossing it twice or not at
 * all throws nothing, breaks no layout, and shows the losing side ahead.
 */
const BLACK_TO_MOVE = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1';

describe('reading the side to move out of a FEN', () => {
  it('takes the second field, not a guess at the first', () => {
    expect(sideFromFen(START_POSITION_FEN)).toBe('w');
    expect(sideFromFen(BLACK_TO_MOVE)).toBe('b');
  });

  it('survives the whitespace a hand-typed FEN arrives with', () => {
    expect(sideFromFen('  4k4/9/9/9/9/9/9/9/9/4K4   b - - 0 1  ')).toBe('b');
    expect(sideFromFen('4k4/9/9/9/9/9/9/9/9/4K4\tw - - 0 1')).toBe('w');
  });

  it('reads anything it cannot understand as Red, which leaves the score untouched', () => {
    expect(sideFromFen('4k4/9/9/9/9/9/9/9/9/4K4')).toBe('w');
    expect(sideFromFen('')).toBe('w');
    expect(sideFromFen('nonsense x y z')).toBe('w');
  });
});

describe('an evaluation crossing to Red POV', () => {
  it('leaves a score alone when Red is the one to move', () => {
    expect(normalizeEvalForSide(120, 'w')).toBe(120);
    expect(normalizeEvalForSide(-120, 'w')).toBe(-120);
  });

  it('flips a score when Black is the one to move', () => {
    expect(normalizeEvalForSide(120, 'b')).toBe(-120);
    expect(normalizeEvalForSide(-120, 'b')).toBe(120);
  });

  it('is its own inverse, so a value crossed twice is back where it started', () => {
    for (const score of [0, 1, -1, 45, -45, 32000]) {
      expect(normalizeEvalForSide(normalizeEvalForSide(score, 'b'), 'b')).toBe(score);
    }
  });

  it('reads the side straight off a FEN', () => {
    expect(normalizeEvalForFen(120, START_POSITION_FEN)).toBe(120);
    expect(normalizeEvalForFen(120, BLACK_TO_MOVE)).toBe(-120);
  });
});

describe('a win/draw/loss split crossing to Red POV', () => {
  const stats = { win: 700, draw: 200, loss: 100 };

  it('is untouched when Red is to move', () => {
    expect(normalizeWdlForSide(stats, 'w')).toEqual(stats);
  });

  it('swaps win with loss, and leaves the draw where it is', () => {
    expect(normalizeWdlForSide(stats, 'b')).toEqual({ win: 100, draw: 200, loss: 700 });
  });

  it('keeps the total, which is the property a swap must not break', () => {
    const crossed = normalizeWdlForSide(stats, 'b');
    expect(crossed.win + crossed.draw + crossed.loss).toBe(stats.win + stats.draw + stats.loss);
  });

  it('passes a missing split through rather than inventing one', () => {
    expect(normalizeWdlForSide(null, 'b')).toBeNull();
    expect(normalizeWdlForSide(null, 'w')).toBeNull();
  });
});

describe('centipawns as text', () => {
  it.each([
    [120, '+1.2'],
    [-120, '-1.2'],
    [5, '+0.1'],
    [-5, '-0.1'],
  ])('writes %d as %s, sign and all', (score, expected) => {
    expect(formatEvalScore(score)).toBe(expected);
  });

  it('gives level a bare zero, because "+0.0" reads as an edge that is not there', () => {
    expect(formatEvalScore(0)).toBe('0.0');
  });

  it('rounds to the asked-for precision', () => {
    expect(formatEvalScore(1234, 2)).toBe('+12.34');
    expect(formatEvalScore(1234, 0)).toBe('+12');
  });
});

describe('mate as text', () => {
  it.each([
    ['+M3', 3],
    ['-M3', -3],
    ['+M1', 1],
    ['-M12', -12],
  ])('reads %s as %d', (text, distance) => {
    expect(parseMateScoreText(text)).toBe(distance);
  });

  it.each([
    ['a centipawn score', '+1.2'],
    ['a bare number', '120'],
    ['no sign', 'M3'],
    ['no distance', '+M'],
    ['a fractional distance', '+M3.5'],
    ['trailing text', '+M3 ply'],
    ['undefined', undefined],
    ['empty', ''],
  ])('refuses %s', (_label, text) => {
    expect(parseMateScoreText(text)).toBeNull();
  });

  it('round-trips in both directions', () => {
    for (const distance of [1, 3, 12, -1, -3, -12]) {
      expect(parseMateScoreText(formatMateScoreText(distance))).toBe(distance);
    }
  });

  it('writes mate-in-zero as a win, not a loss', () => {
    expect(formatMateScoreText(0)).toBe('+M0');
  });
});

describe('a candidate line as Red sees it', () => {
  it('crosses a centipawn score with the side', () => {
    expect(formatRedPovEngineScore({ score: 120, scoreStr: '+1.2' }, 'w')).toBe('+1.2');
    expect(formatRedPovEngineScore({ score: 120, scoreStr: '+1.2' }, 'b')).toBe('-1.2');
  });

  /**
   * Mate flips who is being mated rather than negating a quantity, and it is
   * carried as text rather than as a number -- so it cannot go through the
   * centipawn path, whose `score` for a mate is a sentinel nowhere near a real
   * evaluation.
   */
  it('crosses a mate score with the side, and does not touch its centipawn field', () => {
    expect(formatRedPovEngineScore({ score: 31998, scoreStr: '+M3' }, 'w')).toBe('+M3');
    expect(formatRedPovEngineScore({ score: 31998, scoreStr: '+M3' }, 'b')).toBe('-M3');
    expect(formatRedPovEngineScore({ score: -31998, scoreStr: '-M3' }, 'b')).toBe('+M3');
  });

  it('falls back to centipawns when there is no score text at all', () => {
    expect(formatRedPovEngineScore({ score: 120 }, 'b')).toBe('-1.2');
  });

  it('honours the precision it is given', () => {
    expect(formatRedPovEngineScore({ score: 1234, scoreStr: '+12.34' }, 'w', 2)).toBe('+12.34');
  });
});
