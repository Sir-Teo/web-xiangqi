import { describe, expect, it } from 'vitest';
import { candidateGoCommand, legalCandidateMoves, makeCandidateTag, parseCandidateTag } from './candidateSearch';
import { parseFenBoard, START_FEN, validateMoveStr } from './xiangqi';
import { parseAnalysisTag, parseReviewTag, parseThreatTag } from './engineTags';

describe('candidate search', () => {
  const board = parseFenBoard(START_FEN);
  it('offers only legal moves for the current side', () => {
    for (const side of ['w', 'b'] as const) {
      const moves = legalCandidateMoves(board, side);
      expect(moves.length).toBeGreaterThan(20);
      expect(new Set(moves).size).toBe(moves.length);
      expect(moves.every(move => validateMoveStr(move, board, side).ok)).toBe(true);
    }
  });
  it('keeps limits before the root restriction, including infinite searches', () => {
    expect(candidateGoCommand('go depth 12 movetime 1500', ['a0a1', 'i0i1'], board, 'w'))
      .toBe('go depth 12 movetime 1500 searchmoves a0a1 i0i1');
    expect(candidateGoCommand('go infinite', ['a0a1'], board, 'w')).toBe('go infinite searchmoves a0a1');
  });
  it('rejects malformed, duplicate, illegal, empty, and over-limit sets atomically', () => {
    for (const moves of [[], ['a0a1', 'a0a1'], ['a0a1', 'b0b1'], ['a9a8'], ['a0a1\nquit'], legalCandidateMoves(board, 'w').slice(0, 6)]) {
      expect(candidateGoCommand('go depth 12', moves, board, 'w')).toBeNull();
    }
    expect(candidateGoCommand('go depth 12 searchmoves a0a1', ['i0i1'], board, 'w')).toBeNull();
  });
  it('never parses a restricted result as an ordinary evaluation or review', () => {
    const key = 'position startpos moves h2e2|candidates:a9a8|run:2';
    const tag = makeCandidateTag(key);
    expect(parseCandidateTag(tag)).toBe(key);
    expect(parseCandidateTag('candidate|')).toBeNull();
    expect(parseCandidateTag('analysis|primary|x')).toBeNull();
    expect(parseAnalysisTag(tag)).toBeNull();
    expect(parseReviewTag(tag)).toBeNull();
    expect(parseThreatTag(tag)).toBeNull();
  });
});
