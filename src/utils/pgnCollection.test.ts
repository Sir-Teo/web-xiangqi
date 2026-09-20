import { describe, expect, it } from 'vitest';
import { parsePgnCollection, MAX_COLLECTION_TEXT_LENGTH } from './pgnCollection';
import { exportPgnFromMoveTree } from './gameExport';
import { normalizeSavedGame, type SavedMoveTreeNode } from './gameLibrary';

describe('strict Xiangqi PGN collections', () => {
  it('reopens a dense analysis backup larger than the old collection limit without losing snapshots', () => {
    const moves = Array.from({ length: 1000 }, (_, i) => ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4]);
    let tree: SavedMoveTreeNode[] = [];
    for (let i = 999; i >= 0; i--) tree = [{ uci: moves[i], comment: `Preparation ${i + 1}`, children: tree,
      analysis: { version: 1, position: i ? `position startpos moves ${moves.slice(0, i).join(' ')}` : 'position startpos', move: moves[i],
        score: 125, scoreKind: 'cp', bounded: true, bound: 'lower', depth: 27, savedAt: 1,
        engine: { name: 'Pikafish backup QA', variant: 'single-simd', threads: 1, hashMB: 64 }, multiPv: 1,
        effort: { nodes: 123456, timeMs: 1200, seldepth: 35 } } }];
    const pgn = exportPgnFromMoveTree(tree)!;
    expect(pgn.length).toBeGreaterThan(1_000_000);
    expect(pgn.length).toBeLessThan(MAX_COLLECTION_TEXT_LENGTH);
    const [game] = parsePgnCollection(pgn);
    expect(game.moves).toEqual(moves);
    let original = tree, restored = game.moveTree!;
    for (let i = 0; i < 1000; i++) {
      expect(restored[0].analysis).toEqual(original[0].analysis);
      expect(restored[0].comment).toBe(original[0].comment);
      original = original[0].children ?? []; restored = restored[0].children ?? [];
    }
    expect(restored).toHaveLength(0);
  });
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
    expect(game.moveTree?.[0].children?.[0].comment).toBe('[%eval invalid] [%clk 1:00:00]');
    expect(game.moveTree?.[0].children?.[0].nags).toEqual([3]);
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
  describe.each([['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']])('a file whose lines end with %s', (_label, nl) => {
    // A record separated by CR alone -- saved by an old Mac editor, or pasted
    // out of one -- parses fine when it holds no `;` remark and no `%` escape
    // line, so these are gaps in two line-end checks rather than a format the
    // importer does not take. Each case is paired with the plain file above it
    // to keep that distinction asserted rather than assumed.
    const file = (body: string) => `[Event "D"]${nl}[Result "*"]${nl}${nl}${body}${nl}`;

    it('reads a plain game', () => {
      expect(parsePgnCollection(file('1. h2e2 h9g7 *'))[0].moves).toEqual(['h2e2', 'h9g7']);
    });

    it('ends a ; remark at the line ending, not at end of file', () => {
      // The remark used to swallow the rest of the file, and Black's move with
      // it -- one game came back holding a single move, with nothing said.
      expect(parsePgnCollection(file('1. h2e2 ; note' + nl + 'h9g7 *'))[0].moves).toEqual(['h2e2', 'h9g7']);
    });

    it('ignores a % escape line without eating the games after it', () => {
      // Asking only for LF made the whole file one escape line: every game in
      // it disappeared and the reader was told "No games found."
      const games = parsePgnCollection(`% ignored${nl}` + file('1. h2e2 h9g7 *'));
      expect(games).toHaveLength(1);
      expect(games[0].moves).toEqual(['h2e2', 'h9g7']);
    });

    it('ignores a % escape line that is not the first line of the file', () => {
      // A separate case from the one above, and it has to be: an escape line at
      // offset zero satisfies the line-start check by being at offset zero, so
      // that fixture never exercises the check itself. Only a `%` reached after
      // a line ending does -- and with LF-only detection it stops being an
      // escape line at all and is read as movetext, which the strict reader
      // then refuses.
      const games = parsePgnCollection(file(`1. h2e2${nl}% ignored${nl}h9g7 *`));
      expect(games).toHaveLength(1);
      expect(games[0].moves).toEqual(['h2e2', 'h9g7']);
    });
  });
  it('keeps unclosed analysis commands as prose and removes only closed commands', () => {
    const [game] = parsePgnCollection('h2e2 {before[%xqanalysis invalid]after [%eval 0.42] [%xqanalysis unfinished} *');
    expect(game.moveTree?.[0].comment).toBe('beforeafter [%xqanalysis unfinished');
    expect(game.moveTree?.[0].analysis).toBeUndefined();
  });
  it('rejects a near-limit malformed analysis note without truncating it', () => {
    const source = `h2e2 {${'[%xqanalysis '.repeat(Math.floor((MAX_COLLECTION_TEXT_LENGTH - 100) / 13))}} *`;
    expect(source.length).toBeLessThan(MAX_COLLECTION_TEXT_LENGTH);
    expect(() => parsePgnCollection(source)).toThrow('Game 1: A move note exceeds 500 characters.');
  });
  it('bounds games and total moves per game without truncating', () => {
    expect(() => parsePgnCollection('1.h2e2 * '.repeat(501))).toThrow('at most 500');
    expect(() => parsePgnCollection('a0a1 a9a8 a1a0 a8a9 '.repeat(257) + '*')).toThrow('1,024 moves');
    expect(() => parsePgnCollection('h2e2 (' + 'a0a1 a9a8 a1a0 a8a9 '.repeat(257) + ') *')).toThrow('A line exceeds 1,024 moves');
    expect(() => parsePgnCollection('h2e2 ' + '(b2e2) '.repeat(8192) + '*')).toThrow('8,192 moves');
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

  it('retains the supported tournament and credit headers while dropping unknown tags', () => {
    const [game] = parsePgnCollection(
      '[White "Alice"] [Black "Bob"] [Event "Open Cup"] [Round "3"] [Date "2026.01.02"] ' +
      '[Site "Beijing"] [Annotator "Someone"] [TimeControl "40/7200"] [WhiteElo "2500"] [BlackElo "?"] [SecretNote "keep me"]\n' +
      '1.h2e2 h9g7 *'
    );
    expect(Object.keys(game.metadata ?? {}).sort())
      .toEqual(['annotator', 'blackPlayer', 'blackRating', 'date', 'event', 'redPlayer', 'redRating', 'round', 'site', 'timeControl']);
    expect(game.metadata).toMatchObject({ annotator: 'Someone', timeControl: '40/7200', redRating: '2500', blackRating: '?' });
    expect(JSON.stringify(game)).not.toContain('keep me');
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
