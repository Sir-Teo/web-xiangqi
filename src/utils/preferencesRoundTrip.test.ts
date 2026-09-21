import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeStoredPreferencesValue, type StoredPreferences } from './preferences';

const preferencesSource = readFileSync(new URL('./preferences.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

/** The body of the first `{ ... }` that follows `anchor`, brace-matched. */
function blockAfter(source: string, anchor: string): string {
    const start = source.indexOf(anchor);
    expect(start, `anchor not found: ${anchor}`).toBeGreaterThanOrEqual(0);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error(`unbalanced braces after ${anchor}`);
}

/** Keys declared at the top level of a type or object literal body. */
function keysIn(body: string): string[] {
    const keys: string[] = [];
    let depth = 0;
    for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (depth === 0) {
            // `name?: T`, `name: value`, and the shorthand `name,` the write
            // object uses.
            const match = /^([A-Za-z_$][\w$]*)\s*(?:[?:]|,\s*$)/.exec(trimmed);
            if (match && !trimmed.startsWith('//')) keys.push(match[1]);
        }
        depth += (line.match(/[{([]/g) ?? []).length - (line.match(/[})\]]/g) ?? []).length;
    }
    return [...new Set(keys)].sort();
}

/**
 * The same sixteen names are written out four times, and nothing but this
 * keeps them in step.
 *
 * A preference has to appear in the `StoredPreferences` type, in the object
 * `normalizeStoredPreferencesValue` returns, in the object `App.tsx` hands to
 * `writeStoredPreferences`, and in the `preferences.<name>` reads inside
 * `applyPreferences`. Miss one and the setting has a specific, quiet failure:
 * missing from the normalizer it is dropped on every read, missing from the
 * write it never reaches storage, missing from `applyPreferences` it is stored
 * faithfully and ignored on load. All three look like "my setting did not
 * stick", and none of them is a type error, because every field is optional.
 *
 * This repo has already been bitten three times by one rule written out twice
 * -- the soldier's sideways move in `attacksSquare` against
 * `validatePieceMove`, the move number in `buildMoveText` against
 * `moveNumberAtPly`, the FEN legality test in three readers. Four copies with
 * no check is the same shape, waiting.
 */
describe('every preference is written, normalized, stored and applied', () => {
    const declared = keysIn(blockAfter(preferencesSource, 'export type StoredPreferences ='));
    // The literal this function returns, which is the last `return {` in it.
    const normalizerBody = preferencesSource.slice(preferencesSource.indexOf('export function normalizeStoredPreferencesValue'));
    const normalized = keysIn(blockAfter(normalizerBody, 'const engineThreads = '));
    const written = keysIn(blockAfter(appSource, 'writeStoredPreferences('));
    const applied = [...new Set(
        [...blockAfter(appSource, 'const applyPreferences = useCallback(').matchAll(/\bpreferences\.([A-Za-z_$][\w$]*)/g)]
            .map((match) => match[1])
    )].sort();

    it('found all four lists', () => {
        // If a rename ever makes one of these come back empty, every
        // comparison below would pass by agreeing on nothing.
        expect(declared.length).toBeGreaterThan(10);
        for (const [name, list] of [['normalized', normalized], ['written', written], ['applied', applied]] as const) {
            expect(list.length, `${name} list looks unparsed`).toBe(declared.length);
        }
    });

    it('the normalizer returns every declared preference', () => {
        expect(normalized).toEqual(declared);
    });

    it('the app writes every declared preference', () => {
        expect(written).toEqual(declared);
    });

    it('the app applies every declared preference on load', () => {
        expect(applied).toEqual(declared);
    });

    /**
     * And the round trip itself, so the names agreeing is not the only thing
     * checked: a value of every field survives being written and read back.
     */
    it('carries a non-default value of every preference through storage', () => {
        const chosen: Required<StoredPreferences> = {
            assistMode: 'pro',
            orientation: 'black',
            showArrows: false,
            soundEnabled: false,
            searchDepth: 17,
            engineHashMB: 256,
            engineThreads: 3,
            analysisEngineMode: 'stable',
            enginePvLineCount: 5,
            aiStrength: 2,
            aiSpeed: 'fast',
            notationStyle: 'chinese',
            pieceStyle: 'letters',
            deepSearchMode: 'infinite',
            cloudBookEnabled: true,
        };
        expect(Object.keys(chosen).sort()).toEqual(declared);
        expect(normalizeStoredPreferencesValue(JSON.stringify(chosen))).toEqual(chosen);
    });
});
