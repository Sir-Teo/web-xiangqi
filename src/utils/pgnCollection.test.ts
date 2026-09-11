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
  it('keeps unclosed analysis commands as prose and removes only closed commands', () => {
    const [game] = parsePgnCollection('h2e2 {before[%xqanalysis invalid]after [%eval 0.42] [%xqanalysis unfinished} *');
    expect(game.moveTree?.[0].comment).toBe('beforeafter [%eval 0.42] [%xqanalysis unfinished');
    expect(game.moveTree?.[0].analysis).toBeUndefined();
  });
  it('rejects a near-limit malformed analysis note without truncating it', () => {
    const source = `h2e2 {${'[%xqanalysis '.repeat(74000)}} *`;
    expect(source.length).toBeLessThan(MAX_COLLECTION_TEXT_LENGTH);
    expect(() => parsePgnCollection(source)).toThrow('Game 1: A move note exceeds 500 characters.');
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

  /**
   * The import panel promises "Engine annotations are kept as note text, not
   * review scores." The first half is the assertion above; this is the second.
   *
   * It matters because a review is a claim that *this* app's engine analysed the
   * game -- the panel prints the tier, the depths and a date beside the numbers.
   * Turning a stranger's `%eval` into one would put someone else's figures under
   * that heading, and the reader would have no way to tell.
   */
  /**
   * The last of the panel's four clauses: "Other PGN tags are not retained."
   * A PGN can carry anything -- an Annotator, a rating, a note someone left in
   * a tag of their own invention -- and a reader importing a file from a
   * stranger is told none of it is kept. Listed exhaustively rather than by
   * spot-check, because the failure this guards is a *new* field appearing,
   * which no assertion about the six known ones would notice.
   *
   * Two layers enforce this, which is why neither can be mutation-tested alone:
   * `extractPgnMetadata` builds an object literal of exactly the six, and
   * `normalizeGameMetadata` copies only `GAME_METADATA_FIELDS` out of whatever
   * it is handed. Opening either one on its own leaks nothing and this test
   * stays green -- the other still closes it. Opening both reports
   * "expected [ 'annotator', 'blackPlayer', …(7) ] to deeply equal [ Array(6) ]".
   * So this guards the pair, not either half, and a regression in one layer is
   * caught by the *other layer* rather than by this assertion.
   */
  it('keeps the six headers it names and drops every other tag', () => {
    const [game] = parsePgnCollection(
      '[White "Alice"] [Black "Bob"] [Event "Open Cup"] [Round "3"] [Date "2026.01.02"] ' +
      '[Site "Beijing"] [Annotator "Someone"] [TimeControl "40/7200"] [WhiteElo "2500"] [SecretNote "keep me"]\n' +
      '1.h2e2 h9g7 *'
    );
    expect(Object.keys(game.metadata ?? {}).sort())
      .toEqual(['blackPlayer', 'date', 'event', 'redPlayer', 'round', 'site']);
    expect(JSON.stringify(game)).not.toContain('keep me');
    expect(JSON.stringify(game)).not.toContain('2500');
  });

  /**
   * Mutation-tested at the return site -- adding a `review` to what
   * `parseGame` returns makes this report "expected { …(2) } to be undefined".
   * Not at `base`: a review put there is dropped by `normalizeSavedGame`
   * before it can reach the output, so that mutation passes and proves
   * nothing. The assertion watches what leaves the parser, which is what the
   * promise is about.
   */
  it('does not turn a file\'s annotations into a review of its own', () => {
    const annotated = parsePgnCollection('1.h2e2 $4 {[%eval -3.00] A blunder} h9g7 {[%eval 0.10]} *')[0];
    expect(annotated.review).toBeUndefined();
    expect(annotated.moveTree?.[0].comment).toContain('%eval -3.00');
    expect(parsePgnCollection('1.h2e2 *')[0].review).toBeUndefined();
  });
});
