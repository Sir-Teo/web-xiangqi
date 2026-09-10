import { describe, expect, it } from 'vitest';
import {
  MAX_PREFERENCES_JSON_LENGTH,
  normalizeStoredPreferencesValue,
  type StoredPreferences,
} from './preferences';

/**
 * The preferences record is untrusted text: hand-editable, possibly written by
 * an older build, possibly carried between machines. Every case below is about
 * the same promise -- a value that cannot be understood is dropped, and nothing
 * about dropping it costs the reader the rest of their settings.
 */
const complete: Required<StoredPreferences> = {
  assistMode: 'pro',
  orientation: 'black',
  showArrows: false,
  soundEnabled: false,
  searchDepth: 18,
  engineHashMB: 256,
  engineThreads: 4,
  analysisEngineMode: 'optimized',
  enginePvLineCount: 3,
  aiStrength: 5,
  aiSpeed: 'fast',
  notationStyle: 'chinese',
  pieceStyle: 'letters',
  deepSearchMode: 'infinite',
  cloudBookEnabled: true,
};

describe('normalizeStoredPreferencesValue', () => {
  it('keeps a complete record unchanged', () => {
    expect(normalizeStoredPreferencesValue(JSON.stringify(complete))).toEqual(complete);
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['a truncated object', '{"assistMode":'],
    ['a bare string', '"pro"'],
    ['a number', '42'],
    ['a JSON null', 'null'],
    ['an array of records', '[{"assistMode":"pro"}]'],
  ])('reads %s as no preferences at all', (_label, raw) => {
    expect(normalizeStoredPreferencesValue(raw)).toEqual({});
  });

  it('refuses an oversized record before parsing it', () => {
    const padded = JSON.stringify({ ...complete, note: 'x'.repeat(MAX_PREFERENCES_JSON_LENGTH) });
    expect(padded.length).toBeGreaterThan(MAX_PREFERENCES_JSON_LENGTH);
    expect(normalizeStoredPreferencesValue(padded)).toEqual({});
  });

  it('drops one unreadable value without touching its neighbours', () => {
    const result = normalizeStoredPreferencesValue(
      JSON.stringify({ ...complete, assistMode: 'expert', aiSpeed: 'instant' })
    );
    expect(result.assistMode).toBeUndefined();
    expect(result.aiSpeed).toBeUndefined();
    expect(result.orientation).toBe('black');
    expect(result.notationStyle).toBe('chinese');
    expect(result.enginePvLineCount).toBe(3);
  });

  it('keeps no key it was not asked for', () => {
    const result = normalizeStoredPreferencesValue(
      JSON.stringify({ assistMode: 'coach', theme: 'midnight', __proto__: { polluted: true } })
    );
    expect(Object.keys(result).filter((key) => result[key as keyof StoredPreferences] !== undefined))
      .toEqual(['assistMode']);
    expect('theme' in result).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('takes booleans only as booleans, never as their string or number spellings', () => {
    const result = normalizeStoredPreferencesValue(
      JSON.stringify({ showArrows: 'false', soundEnabled: 0, cloudBookEnabled: 1 })
    );
    expect(result.showArrows).toBeUndefined();
    expect(result.soundEnabled).toBeUndefined();
    expect(result.cloudBookEnabled).toBeUndefined();
  });

  it.each([
    ['a depth below the floor', 0, 1],
    ['a negative depth', -7, 1],
    ['a depth above the ceiling', 99, 24],
    ['a fractional depth', 12.9, 12],
    ['a numeric string', '15', 15],
  ])('clamps %s to the searchable range', (_label, stored, expected) => {
    expect(normalizeStoredPreferencesValue(JSON.stringify({ searchDepth: stored })).searchDepth)
      .toBe(expected);
  });

  it.each([['text', 'deep'], ['a null', null], ['a boolean', true]])(
    'drops %s given as a search depth',
    (_label, stored) => {
      expect(normalizeStoredPreferencesValue(JSON.stringify({ searchDepth: stored })).searchDepth)
        .toBeUndefined();
    }
  );

  it.each([
    ['a null', null],
    ['a boolean', true],
    ['an empty string', ''],
    ['an object', { mb: 256 }],
  ])('drops %s given as an engine hash size rather than reading it as zero', (_label, stored) => {
    expect(normalizeStoredPreferencesValue(JSON.stringify({ engineHashMB: stored })).engineHashMB)
      .toBeUndefined();
  });

  it('leaves engine hash and thread counts unclamped, because the tier decides', () => {
    const result = normalizeStoredPreferencesValue(
      JSON.stringify({ engineHashMB: 4096.7, engineThreads: 64 })
    );
    expect(result.engineHashMB).toBe(4096);
    expect(result.engineThreads).toBe(64);
  });

  it('takes every line count the engine offers and no other', () => {
    for (const count of [1, 3, 5]) {
      expect(normalizeStoredPreferencesValue(JSON.stringify({ enginePvLineCount: count })).enginePvLineCount)
        .toBe(count);
    }
    for (const count of [0, 2, 4, 6, '3']) {
      expect(normalizeStoredPreferencesValue(JSON.stringify({ enginePvLineCount: count })).enginePvLineCount)
        .toBeUndefined();
    }
  });
});
