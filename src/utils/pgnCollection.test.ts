import { describe, expect, it } from 'vitest';
import { parsePgnCollection, MAX_COLLECTION_TEXT_LENGTH } from './pgnCollection';
import { exportPgnFromMoveTree } from './gameExport';
import { normalizeSavedGame } from './gameLibrary';

describe('strict Xiangqi PGN collections', () => {
  it('round-trips typed scores, depths, and quality on the main line and alternatives', () => {
    const [game] = parsePgnCollection('h2e2 $2 {[%eval +200.00,18] Main note} h9g7?! {[%eval #10000,20]} (b9c7?? {[%eval -300.00,21] Branch note}) *');
    expect(game.moveTree?.[0]).toMatchObject({ evalScore: 20000, evalScoreKind: 'cp', evalDepth: 18, quality: 'mistake', comment: 'Main note' });
    expect(game.moveTree?.[0].children?.[0]).toMatchObject({ evalScore: 20000, evalDepth: 20, quality: 'inaccuracy' });
    expect(game.moveTree?.[0].children?.[0].evalScoreKind).toBeUndefined();
    expect(game.moveTree?.[0].children?.[1]).toMatchObject({ evalScore: -30000, evalScoreKind: 'cp', evalDepth: 21, quality: 'blunder', comment: 'Branch note' });
    const saved = normalizeSavedGame({ ...game, id: 'roundtrip', savedAt: 1 })!;
    const exported = exportPgnFromMoveTree(saved.moveTree!)!;
    for (const annotation of ['[%eval 200.00,18]', '[%eval #10000,20]', '[%eval -300.00,21]', '$2', '$6', '$4']) expect(exported).toContain(annotation);
    expect(parsePgnCollection(exported)[0].moveTree).toEqual(game.moveTree);
    expect(saved.review).toBeUndefined();
  });
  it('keeps unsupported annotations as notes and reserves note space for prose', () => {
    const note = 'n'.repeat(500);
    const [game] = parsePgnCollection(`h2e2 {[%eval .42,18] ${note}} h9g7 $3 {[%eval invalid] [%clk 1:00:00]} *`);
    expect(game.moveTree?.[0]).toMatchObject({ evalScore: 42, evalDepth: 18, comment: note });
    expect(game.moveTree?.[0].children?.[0].comment).toBe('$3 [%eval invalid] [%clk 1:00:00]');
    expect(game.moveTree?.[0].children?.[0].quality).toBeUndefined();
    const splitNote = `${'a'.repeat(250)} [%eval .42] ${'b'.repeat(249)}`;
    expect(parsePgnCollection(`h2e2 {${splitNote}} *`)[0].moveTree?.[0].comment).toBe(`${'a'.repeat(250)} ${'b'.repeat(249)}`);
  });
  it('keeps mate zero and first-valid ordering, and clears replaced score metadata', () => {
    const [game] = parsePgnCollection('h2e2 {[%eval invalid] [%eval #-0,24] [%eval .42]} h9g7 {[%eval 200.00,20]} {[%eval #10000]} *');
    expect(game.moveTree?.[0]).toMatchObject({ evalScore: -30000, evalDepth: 24, comment: '[%eval invalid]' });
    const replaced = game.moveTree?.[0].children?.[0];
    expect(replaced?.evalScore).toBe(20000);
    expect(replaced?.evalScoreKind).toBeUndefined();
    expect(replaced?.evalDepth).toBeUndefined();
    const [black] = parsePgnCollection('[FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 20"] h7e7 {[%eval -.75,21]} *');
    expect(black.moveTree?.[0]).toMatchObject({ evalScore: -75, evalDepth: 21 });
    expect(black.finalEval).toBe(-75);
    expect(parsePgnCollection('h2e2 {[%eval 200.00]} *')[0]).toMatchObject({ finalEval: 20000, finalEvalKind: 'cp' });
    expect(parsePgnCollection('h2e2 {[%eval 200.00]} h9g7 *')[0].finalEval).toBeUndefined();
  });
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
    expect(game.moveTree?.[0].comment).toBe('beforeafter [%xqanalysis unfinished');
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
  it('rejects overlarge text and imports supported annotation fields', () => {
    expect(() => parsePgnCollection(' '.repeat(MAX_COLLECTION_TEXT_LENGTH+1))).toThrow('exceeds');
    expect(parsePgnCollection('1.h2e2 $2 {[%eval 0.42]} *')[0].moveTree?.[0]).toMatchObject({ evalScore: 42, quality: 'mistake', comment: undefined });
  });

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
    expect(annotated.moveTree?.[0]).toMatchObject({ evalScore: -300, quality: 'blunder', comment: 'A blunder' });
    expect(parsePgnCollection('1.h2e2 *')[0].review).toBeUndefined();
  });
});
