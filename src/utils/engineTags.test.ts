import { describe, expect, it } from 'vitest';
import {
  AI_TAG_PREFIX,
  ANALYSIS_TAG_PREFIX,
  HINT_TAG_PREFIX,
  REVIEW_TAG_PREFIX,
  THREAT_TAG_PREFIX,
  makeAiTag,
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
