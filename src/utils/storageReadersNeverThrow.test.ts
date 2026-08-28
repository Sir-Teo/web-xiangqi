import { describe, expect, it } from 'vitest';
import { normalizeSavedGames, normalizeSavedGame, normalizeSavedMoveTree } from './gameLibrary';
import { readAutoSavedGame } from './autoSave';

/**
 * "Storage readers must never throw on bad data; drop the record and move on"
 * is one of this repo's stated invariants, and until now it was only a
 * sentence. Browser storage is shared with every other tab, survives upgrades,
 * and is trivially editable, so a reader that throws takes the app down at
 * startup with no way back short of clearing site data.
 *
 * Each reader is fed the same catalogue of junk. Anything that throws fails.
 */
const JUNK: Array<[name: string, value: unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['not json', '{oh no'],
    ['json null', 'null'],
    ['a bare number', 42],
    ['a bare string', 'nope'],
    ['an array where an object belongs', [1, 2, 3]],
    ['an object where an array belongs', { a: 1 }],
    ['nested nulls', [null, null]],
    ['objects missing every field', [{}, {}]],
    ['fields of the wrong type', [{ id: 1, moves: 'not an array', savedAt: 'soon' }]],
    ['a deeply nested structure', JSON.parse('[' + '{"a":'.repeat(50) + '1' + '}'.repeat(50) + ']')],
    ['NaN and Infinity as strings', [{ id: 'x', savedAt: 'NaN', moves: ['Infinity'] }]],
    ['a very long string', 'x'.repeat(200_000)],
    ['a lone surrogate', '\uD800 broken'],
    ['a replacement character', '\uFFFD unknown'],
];

/** A localStorage stand-in that hands back whatever it is given. */
const storageReturning = (value: unknown) => ({
    getItem: () => (typeof value === 'string' ? value : JSON.stringify(value ?? null)),
    setItem: () => {},
    removeItem: () => {},
});

describe('storage readers never throw', () => {
    for (const [name, value] of JUNK) {
        it(`survives ${name}`, () => {
            expect(() => normalizeSavedGames(value)).not.toThrow();
            expect(() => normalizeSavedGame(value)).not.toThrow();
            expect(() => normalizeSavedMoveTree(value)).not.toThrow();
            expect(() => readAutoSavedGame(storageReturning(value))).not.toThrow();
        });
    }

    it('returns something usable rather than throwing, for every one of them', () => {
        for (const [, value] of JUNK) {
            expect(Array.isArray(normalizeSavedGames(value))).toBe(true);
        }
    });

    it('survives a reader whose storage itself throws', () => {
        // Private mode and quota failures surface here, not as a return value.
        const hostile = {
            getItem: () => { throw new Error('SecurityError'); },
            setItem: () => {},
            removeItem: () => {},
        };
        expect(() => readAutoSavedGame(hostile)).not.toThrow();
    });
});
