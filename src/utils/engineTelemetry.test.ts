import { describe, expect, it } from 'vitest';
import {
  formatCompactCount,
  formatEngineDepthLabel,
  formatEngineTelemetry,
  formatEngineTelemetryDetail,
  type EngineTelemetryStats,
} from './engineTelemetry';

/**
 * The engine reports what it has, when it has it, so every field of the stats
 * record is optional. A browser gate can only reach the states a real search
 * happens to produce; the states worth being sure about are the ones it does
 * not -- no stats at all, a queued search, nodes without a rate, a hash of zero.
 */
const stats = (partial: EngineTelemetryStats): EngineTelemetryStats => partial;

describe('thousands and millions', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [999, '999'],
    [1_000, '1k'],
    [1_234, '1.2k'],
    [99_949, '99.9k'],
    [100_000, '100k'],
    [789_000, '789k'],
    [999_499, '999k'],
    [999_999, '1M'],
    [1_000_000, '1M'],
    [1_234_567, '1.2M'],
    [9_949_999, '9.9M'],
    [10_000_000, '10M'],
    [123_456_789, '123M'],
  ])('writes %d as %s', (value, expected) => {
    expect(formatCompactCount(value)).toBe(expected);
  });

  it('never shows a trailing .0, which would be a digit carrying nothing', () => {
    for (const value of [1_000, 2_000, 1_000_000, 5_000_000]) {
      expect(formatCompactCount(value)).not.toMatch(/\.0/);
    }
  });

  /**
   * 999,600 nps is 999.6 thousand, which to no decimal places is "1000k" --
   * four figures where the rest of the scale shows three, and a unit the value
   * has just rounded out of. The boundary either side of it is here so the
   * promotion cannot be over-eager.
   */
  it('promotes a number that rounds out of its own unit', () => {
    expect(formatCompactCount(999_499)).toBe('999k');
    expect(formatCompactCount(999_500)).toBe('1M');
    expect(formatCompactCount(999_600)).toBe('1M');
  });

  it('never writes four figures before the unit', () => {
    for (const value of [999_500, 999_999, 1_000_000, 9_999_999, 999, 1_000]) {
      expect(formatCompactCount(value)).not.toMatch(/^\d{4}/);
    }
  });

  it('has no room for a negative or a fraction, and says so by clamping', () => {
    expect(formatCompactCount(-5)).toBe('0');
    expect(formatCompactCount(1.9)).toBe('1');
    expect(formatCompactCount(-1_000_000)).toBe('0');
  });
});

describe('the depth badge', () => {
  it.each([
    ['queued', { queued: true, searching: false, ready: true }, 'Queued'],
    ['searching but silent so far', { queued: false, searching: true, ready: true }, 'Pending'],
    ['idle and ready', { queued: false, searching: false, ready: true }, 'Idle'],
    ['not up yet', { queued: false, searching: false, ready: false }, 'Booting'],
  ])('says what the engine is doing when it has said nothing: %s', (_label, flags, expected) => {
    expect(formatEngineDepthLabel(null, 18, flags.queued, flags.searching, flags.ready)).toBe(expected);
  });

  it('prefers queued over searching, because that is the earlier state', () => {
    expect(formatEngineDepthLabel(null, 18, true, true, true)).toBe('Queued');
  });

  it('shows the depth once there is one', () => {
    expect(formatEngineDepthLabel(stats({ depth: 12 }), 18, false, true, true)).toBe('D12');
  });

  it('falls back to the target depth when the engine has not named one', () => {
    expect(formatEngineDepthLabel(stats({ nodes: 5 }), 18, false, true, true)).toBe('D18');
  });

  it('adds the selective depth only when the search really went deeper', () => {
    expect(formatEngineDepthLabel(stats({ depth: 8, seldepth: 12 }), 18, false, true, true)).toBe('D8/S12');
    expect(formatEngineDepthLabel(stats({ depth: 8, seldepth: 8 }), 18, false, true, true)).toBe('D8');
    expect(formatEngineDepthLabel(stats({ depth: 8, seldepth: 4 }), 18, false, true, true)).toBe('D8');
    expect(formatEngineDepthLabel(stats({ depth: 8, seldepth: 0 }), 18, false, true, true)).toBe('D8');
  });
});

describe('the one-line summary', () => {
  it('names the target while there is nothing to report', () => {
    expect(formatEngineTelemetry(null, 18, 900, false, false)).toBe('target D18');
    expect(formatEngineTelemetry(null, 18, 900, true, false)).toBe('target D18 · queued');
    expect(formatEngineTelemetry(null, 18, 900, false, true)).toBe('target D18 · 900ms');
  });

  it('leads with the rate, and falls back to the count when there is no rate', () => {
    expect(formatEngineTelemetry(stats({ nps: 789_000, nodes: 123_000 }), 18, 900, false, true)).toBe('789k nps');
    expect(formatEngineTelemetry(stats({ nodes: 123_000 }), 18, 900, false, true)).toBe('123k nodes');
  });

  it('writes the hash as a percentage of a per-mille figure', () => {
    expect(formatEngineTelemetry(stats({ nps: 789_000, hashfull: 20 }), 18, 900, false, true)).toBe('789k nps · hash 2%');
    expect(formatEngineTelemetry(stats({ nps: 789_000, hashfull: 1000 }), 18, 900, false, true)).toBe('789k nps · hash 100%');
  });

  it('shows a hash of zero rather than dropping it, because empty is a fact', () => {
    expect(formatEngineTelemetry(stats({ hashfull: 0 }), 18, 900, false, true)).toBe('hash 0%');
  });

  it('never runs past two figures, because this line sits in a narrow card', () => {
    const full = stats({ nps: 789_000, nodes: 123_000, hashfull: 20, timeMs: 156 });
    expect(formatEngineTelemetry(full, 18, 900, false, true).split(' · ')).toHaveLength(2);
  });

  it('falls back to the elapsed time, and then to the budget, when it has nothing else', () => {
    expect(formatEngineTelemetry(stats({ timeMs: 156 }), 18, 900, false, true)).toBe('156ms');
    expect(formatEngineTelemetry(stats({ depth: 8 }), 18, 900, false, true)).toBe('900ms primary');
  });
});

describe('the long form', () => {
  it('carries everything the engine said, in a fixed order', () => {
    const full = stats({ depth: 8, seldepth: 12, nodes: 123_000, nps: 789_000, hashfull: 20, timeMs: 156 });
    expect(formatEngineTelemetryDetail(full, 18, 900, false, true, true))
      .toBe('Search D8/S12 · 123k nodes · 789k nps · hash 2% · 156ms');
  });

  it('keeps the order when fields are missing, rather than shuffling up', () => {
    expect(formatEngineTelemetryDetail(stats({ depth: 8, hashfull: 20 }), 18, 900, false, true, true))
      .toBe('Search D8 · hash 2%');
  });

  it('joins the badge and the summary when there are no stats at all', () => {
    expect(formatEngineTelemetryDetail(null, 18, 900, true, false, true))
      .toBe('Search Queued; target D18 · queued');
    expect(formatEngineTelemetryDetail(null, 18, 900, false, false, false))
      .toBe('Search Booting; target D18');
  });
});
