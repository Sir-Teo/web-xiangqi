import { describe, expect, it } from 'vitest';
import { parsePgnCollection, MAX_COLLECTION_TEXT_LENGTH } from './pgnCollection';

describe('strict Xiangqi PGN collections', () => {
  it('separates inline games and preserves metadata, results, branches and comments', () => {
    const games = parsePgnCollection('[White "Alice"] [Result "1-0"] 1.h2e2 {a [tag] and 0-1} (1.b2e2 {branch}) h9g7 1-0 [White "Bob"] 1.b2e2 *');
    expect(games).toHaveLength(2);
    expect(games[0].metadata?.redPlayer).toBe('Alice');
    expect(games[0].result).toBe('red');
    expect(games[0].moves).toEqual(['h2e2','h9g7']);
    expect(games[0].moveTree?.[1]).toMatchObject({uci:'b2e2',comment:'branch'});
    expect(games[1].metadata?.redPlayer).toBe('Bob');
    expect(games[1].moves).toEqual(['b2e2']);
  });
  it('handles quoted braces, semicolon comments, nested variations and unknown dates', () => {
    const games = parsePgnCollection('[Event "Club { \\"A\\" }"]\n[Date "2020.??.??"]\n1.h2e2 h9g7 (1...h9i7 (1...b9c7)) ;1-0 [Event "fake"]\n*\n1.b2e2 *');
    expect(games).toHaveLength(2);
    expect(games[0].metadata).toMatchObject({event:'Club { "A" }',date:'2020.??.??'});
    expect(games[0].moveTree?.[0].children).toHaveLength(3);
  });
  it.each([
    ['1.h2e2 garbage h9g7 *', 'Unsupported move'],
    ['1.h2e2 h9h8 *', 'Illegal move h9h8'],
    ['1.h2e2 (1.h9g7) *', 'Illegal move'],
    ['1.h2e2 (1.b2e2 *', 'Result marker inside'],
    ['1.h2e2 {unclosed', 'Unclosed PGN comment'],
    ['[Result "1-0"] 1.h2e2 0-1', 'disagrees'],
    ['[Variant "chess"] 1.e2e4 *', 'Unsupported variant'],
    ['1.h2e2 * 1.b2e2 rubbish *', 'Game 2'],
    ['1.h2e2 () *', 'empty variation'],
    ['1.h2e2 ( [Event "Bad"] 1.b2e2 ) *', 'header appears'],
    ['1.h2e2 constructor *', 'Unsupported move'],
  ])('rejects damaged or unsupported records: %s', (source, message) => {
    expect(() => parsePgnCollection(source)).toThrow(message);
  });
  it('accepts a self-delimiting result without spaces', () => {
    expect(parsePgnCollection('1.h2e2*1.b2e2*')).toHaveLength(2);
  });
  it('bounds games and total moves per game without truncating', () => {
    expect(() => parsePgnCollection('1.h2e2 * '.repeat(501))).toThrow('at most 500');
    expect(() => parsePgnCollection('a0a1 a9a8 a1a0 a8a9 '.repeat(257) + '*')).toThrow('1,024 moves');
  });
  it('validates a custom Black-to-move position', () => {
    const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 20';
    expect(parsePgnCollection(`[FEN "${fen}"] 20...h7e7 *`)[0].startFen).toBe(fen);
    expect(() => parsePgnCollection('[FEN "bad"] 1.h2e2 *')).toThrow('Invalid starting FEN');
  });
  it('rejects overlarge text and preserves annotation text as move notes', () => {
    expect(() => parsePgnCollection(' '.repeat(MAX_COLLECTION_TEXT_LENGTH+1))).toThrow('exceeds');
    expect(parsePgnCollection('1.h2e2 $2 {[%eval 0.42]} *')[0].moveTree?.[0].comment).toBe('$2 [%eval 0.42]');
  });
});
