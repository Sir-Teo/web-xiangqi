import { describe, expect, it } from 'vitest';
import { START_FEN } from './xiangqi';
import {
  AI_TAG_PREFIX,
  ANALYSIS_TAG_PREFIX,
  HINT_TAG_PREFIX,
  REVIEW_TAG_PREFIX,
  THREAT_TAG_PREFIX,
  makeAiTag,
  makeEnginePositionCommand,
  makeAnalysisTag,
  makeHintTag,
  makeReviewTag,
  makeThreatTag,
  parseAiTag,
  parseAnalysisTag,
  parseHintTag,
  parseReviewTag,
  parseThreatTag,
} from './engineTags';

/**
 * A tag is how a reply is matched to the request that asked for it, and how a
 * reply nobody wants any more is dropped instead of drawn. Three properties
 * matter and each has its own group below: every tag round-trips, no tag can be
 * read as another kind, and anything malformed is refused rather than half-read.
 */
const POSITION = 'position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1 moves h2e2';

describe('a tag survives the round trip', () => {
  it.each(['primary', 'deepen', 'deep'] as const)('analysis, %s phase', (phase) => {
    expect(parseAnalysisTag(makeAnalysisTag(phase, 'key-7'))).toEqual({ phase, requestKey: 'key-7' });
  });

  it.each(['base', 'revisit'] as const)('review, %s phase', (phase) => {
    expect(parseReviewTag(makeReviewTag(phase, 'n42'))).toEqual({ phase, nodeId: 'n42' });
  });

  it('threat', () => {
    expect(parseThreatTag(makeThreatTag('key-7'))).toEqual({ requestKey: 'key-7' });
  });

  it('hint, carrying a whole position command', () => {
    expect(parseHintTag(makeHintTag(POSITION))).toEqual({ positionCommand: POSITION });
  });

  it('ai, carrying a depth, a strength and a position command', () => {
    expect(parseAiTag(makeAiTag(POSITION, 14, 5))).toEqual({ depth: 14, strength: 5, positionCommand: POSITION });
  });

  /**
   * The payload is the last field and is rejoined, not taken as one split part.
   * A parser that took `split('|')[2]` would truncate at the first pipe, and the
   * reply would then match no request -- a search that appears to have simply
   * never answered.
   */
  it.each([
    ['an analysis request key', (value: string) => parseAnalysisTag(makeAnalysisTag('primary', value))?.requestKey],
    ['a review node id', (value: string) => parseReviewTag(makeReviewTag('base', value))?.nodeId],
    ['a threat request key', (value: string) => parseThreatTag(makeThreatTag(value))?.requestKey],
    ['a hint position command', (value: string) => parseHintTag(makeHintTag(value))?.positionCommand],
    ['an ai position command', (value: string) => parseAiTag(makeAiTag(value, 14, 5))?.positionCommand],
  ])('keeps a pipe inside %s', (_label, roundTrip) => {
    expect(roundTrip('a|b|c')).toBe('a|b|c');
  });
});

describe('no tag can be read as another kind', () => {
  const tags = {
    analysis: makeAnalysisTag('primary', 'key-7'),
    review: makeReviewTag('base', 'n42'),
    threat: makeThreatTag('key-7'),
    hint: makeHintTag(POSITION),
    ai: makeAiTag(POSITION, 14, 5),
  };
  const parsers = {
    analysis: parseAnalysisTag,
    review: parseReviewTag,
    threat: parseThreatTag,
    hint: parseHintTag,
    ai: parseAiTag,
  };

  it('has five distinct prefixes', () => {
    const prefixes = [ANALYSIS_TAG_PREFIX, AI_TAG_PREFIX, REVIEW_TAG_PREFIX, THREAT_TAG_PREFIX, HINT_TAG_PREFIX];
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  /**
   * The threat case is the one with teeth: a threat searches the same board
   * with the *other* side to move, so an analysis parser accepting one would
   * put the opponent's evaluation on the eval bar labelled as this position's.
   */
  it.each(Object.keys(tags))('a %s tag is refused by every other parser', (kind) => {
    const tag = tags[kind as keyof typeof tags];
    expect(parsers[kind as keyof typeof parsers](tag)).not.toBeNull();
    for (const [otherKind, parse] of Object.entries(parsers)) {
      if (otherKind === kind) continue;
      expect({ kind, otherKind, result: parse(tag) }).toEqual({ kind, otherKind, result: null });
    }
  });
});

describe('a malformed tag is refused, not half-read', () => {
  it.each([
    ['null', null],
    ['empty', ''],
    ['a bare prefix', 'analysis'],
    ['a prefix and nothing after it', 'analysis|'],
    ['an unknown phase', 'analysis|sideways|key-7'],
    ['a phase with no request key', 'analysis|primary'],
  ])('analysis refuses %s', (_label, tag) => {
    expect(parseAnalysisTag(tag)).toBeNull();
  });

  it.each([
    ['an unknown phase', 'review|later|n42'],
    ['a phase with no node', 'review|base'],
    ['an empty node', 'review|base|'],
  ])('review refuses %s', (_label, tag) => {
    expect(parseReviewTag(tag)).toBeNull();
  });

  it.each([
    ['an empty request key', 'threat|'],
    ['a bare prefix', 'threat'],
  ])('threat refuses %s', (_label, tag) => {
    expect(parseThreatTag(tag)).toBeNull();
  });

  it.each([
    ['an empty command', 'hint|'],
    ['a bare prefix', 'hint'],
  ])('hint refuses %s', (_label, tag) => {
    expect(parseHintTag(tag)).toBeNull();
  });

  it.each([
    ['a non-numeric depth', 'ai|deep|5|position startpos'],
    ['a strength off the ladder', 'ai|14|9|position startpos'],
    ['a strength that is not a number', 'ai|14|strong|position startpos'],
    ['no position command', 'ai|14|5|'],
    ['nothing but the prefix', 'ai'],
  ])('ai refuses %s', (_label, tag) => {
    expect(parseAiTag(tag)).toBeNull();
  });

  it('accepts the ai tag those cases differ from by one field', () => {
    expect(parseAiTag('ai|14|5|position startpos')).toEqual({
      depth: 14,
      strength: 5,
      positionCommand: 'position startpos',
    });
  });
});

describe('the position command', () => {
    const OPENING = `${START_FEN} w - - 0 1`;

    /**
     * `startpos` is what every engine expects for the opening position, and what
     * its logs and books are keyed on -- but only when the position really is
     * the opening one *with Red to move*. The same board with Black to move is a
     * different position, and sending `startpos` for it would have the engine
     * analyse the wrong side's turn.
     */
    it('says startpos for the opening position', () => {
        expect(makeEnginePositionCommand(OPENING, [])).toBe('position startpos');
    });

    it('sends a FEN for the same board with the other side to move', () => {
        const blackToMove = `${START_FEN} b - - 0 1`;
        expect(makeEnginePositionCommand(blackToMove, [])).toBe(`position fen ${blackToMove}`);
    });

    it.each([
        ['capture-free clock', '47 1'],
        ['move number', '0 32'],
        ['both counters', '47 32'],
    ])('preserves a custom %s even on the starting arrangement', (_label, counters) => {
        const custom = `${START_FEN} w - - ${counters}`;
        expect(makeEnginePositionCommand(custom, [])).toBe(`position fen ${custom}`);
        expect(makeEnginePositionCommand(custom, ['h2e2', 'h9g7']))
            .toBe(`position fen ${custom} moves h2e2 h9g7`);
    });

    it('sends a FEN for a position that is not the opening one', () => {
        const custom = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1';
        expect(makeEnginePositionCommand(custom, [])).toBe(`position fen ${custom}`);
    });

    it('appends the moves to either form, space separated', () => {
        expect(makeEnginePositionCommand(OPENING, ['h2e2', 'h9g7']))
            .toBe('position startpos moves h2e2 h9g7');
        const custom = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1';
        expect(makeEnginePositionCommand(custom, ['e0e1']))
            .toBe(`position fen ${custom} moves e0e1`);
    });

    it('writes no trailing "moves" when there are none', () => {
        expect(makeEnginePositionCommand(OPENING, [])).not.toMatch(/moves/);
    });

    it('reads the opening position through the whitespace a hand-typed FEN carries', () => {
        expect(makeEnginePositionCommand(`  ${START_FEN}   w - - 0 1  `, [])).toBe('position startpos');
    });
});

/**
 * Every parser here takes `string | null`, because that is what a UCI line
 * carries when the engine answers with no tag at all.
 *
 * Found by mutation: `!tag || !tag.startsWith(...)` joined with `&&` still
 * returns null for every *wrong* tag -- the parse below rejects it anyway --
 * and throws only on null, which nothing passed. A throw here is not a bad
 * parse, it is an unhandled error inside the engine message handler.
 */
describe('a tag that is absent or belongs to something else', () => {
  it('reads as no tag rather than throwing', () => {
    for (const parse of [parseReviewTag, parseAiTag]) {
      expect(parse(null)).toBeNull();
      expect(parse('')).toBeNull();
      expect(parse('something-else|base|n1')).toBeNull();
    }
  });

  it('still reads the tag it is for, in the same shape', () => {
    // The control: the guard above rejects everything, so a pass there means
    // nothing unless the parsers still accept their own tags.
    expect(parseReviewTag(makeReviewTag('base', 'n1'))).toEqual({ phase: 'base', nodeId: 'n1' });
    expect(parseAiTag(makeAiTag(POSITION, 14, 5))).toEqual({ depth: 14, strength: 5, positionCommand: POSITION });
  });
});
