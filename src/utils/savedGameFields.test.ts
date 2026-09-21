import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeSavedGame } from './gameLibrary';
import type { SavedGame } from './gameLibrary';

const source = readFileSync(new URL('./gameLibrary.ts', import.meta.url), 'utf8');

/** The body of the first brace-balanced block after `anchor`. */
function blockAfter(anchor: string, from = 0): string {
    const start = source.indexOf(anchor, from);
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

/** Keys declared at the top level of a type body or object literal. */
function topLevelKeys(body: string): string[] {
    const keys: string[] = [];
    let depth = 0;
    for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (depth === 0) {
            const match = /^(?:\.\.\.\()?([A-Za-z_$][\w$]*)\s*[?]?\s*[:,]/.exec(trimmed);
            if (match) keys.push(match[1]);
            // `...(x ? { key: v } : {})` and its shorthand `...(x ? { key } : {})`.
            const spread = /^\.\.\.\(.*\?\s*\{\s*([A-Za-z_$][\w$]*)\s*[:}]/.exec(trimmed);
            if (spread) keys.push(spread[1]);
            if (/^([A-Za-z_$][\w$]*)\s*,\s*$/.test(trimmed)) keys.push(trimmed.replace(/,$/, '').trim());
        }
        depth += (line.match(/[{([]/g) ?? []).length - (line.match(/[})\]]/g) ?? []).length;
    }
    return [...new Set(keys)];
}

/**
 * Every field of `SavedGame` has to be written by `normalizeSavedGame`.
 *
 * The normaliser is the only way a stored game re-enters the app, and it
 * rebuilds the record field by field rather than spreading the input -- which
 * is right, since the input is untrusted, and which also means a field added
 * to the interface and forgotten here is **silently dropped on every reload**.
 * The player would see their saved game come back missing something, with
 * nothing logged and no test failing.
 *
 * Guarded the way `preferencesRoundTrip` guards the four preference lists:
 * read the source, compare the two lists.
 */
describe('the saved-game record and its normaliser', () => {
    it('normalises every field the interface declares', () => {
        const declared = topLevelKeys(blockAfter('export interface SavedGame'));
        // The *returned literal*, not the function body: every key in the
        // body is nested one level deeper and a body scan sees none of them.
        const functionAt = source.indexOf('export function normalizeSavedGame');
        const written = topLevelKeys(blockAfter('return {', functionAt));
        expect(declared.length).toBeGreaterThanOrEqual(15);
        expect(declared.filter((field) => !written.includes(field))).toEqual([]);
    });

    it('returns a fully populated record unchanged', () => {
        // The runtime half: the source check above sees a *name* being
        // written, not the value surviving. A field normalised to undefined
        // reads as present to a source scan and as lost to the player.
        const game: SavedGame = {
            id: 'g1',
            savedAt: 1_700_000_000_000,
            gameMode: 'PvP',
            moves: ['h2e2', 'h9g7'],
            result: 'red',
            label: 'My study',
            opening: 'Central Cannon',
            rootComment: 'A note on the start',
            rootResult: 'red-wins',
            mainLinePinned: true,
            // In the mate-sentinel range, which is the only case that records
            // a kind alongside the score.
            finalEval: 20000,
            finalEvalKind: 'cp',
            metadata: { event: 'Club night', redPlayer: 'Red', blackPlayer: 'Black' },
            // A leaf carries no `children` key: the normaliser drops an empty
            // array rather than storing it, so this is the canonical form.
            moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }],
        };

        const normalized = normalizeSavedGame(game);
        expect(normalized).not.toBeNull();
        for (const [field, value] of Object.entries(game)) {
            expect(normalized![field as keyof SavedGame], `field ${field}`).toEqual(value);
        }
    });

    it('is idempotent, so a reload never erodes a record', () => {
        // Storage is read and written repeatedly over a record's life. If
        // normalising twice differs from normalising once, a game loses a
        // little on every visit rather than all at once, which is the kind of
        // loss nobody reports.
        const game: SavedGame = {
            id: 'g2',
            savedAt: 1_700_000_000_000,
            gameMode: 'PvP',
            moves: ['h2e2'],
            startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
            rootComment: 'Start note',
            label: 'Label',
            opening: 'Opening',
            result: 'ongoing',
            moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7', comment: 'reply' }] }],
        };
        const once = normalizeSavedGame(game);
        expect(once).not.toBeNull();
        expect(normalizeSavedGame(once)).toEqual(once);
    });
});

/**
 * The same guard one level down, on the nodes of a saved study.
 *
 * A field added to `SavedMoveTreeNode` and forgotten in its normaliser loses a
 * move's note, glyphs or stored analysis on reload -- the same silent erosion,
 * on the part of the record the reader actually wrote themselves.
 *
 * Only the fields the interface declares directly: the ones it inherits from
 * `MoveEvaluation` and `MoveGlyphs` arrive through a spread of their own
 * normalisers and are guarded by those.
 */
describe('the saved move-tree node and its normaliser', () => {
    it('normalises every field the node declares itself', () => {
        const declared = topLevelKeys(blockAfter('export interface SavedMoveTreeNode'));
        const functionAt = source.indexOf('function normalizeSavedMoveTreeNode');
        const written = topLevelKeys(blockAfter('return {', functionAt));
        expect(declared).toContain('uci');
        expect(declared).toContain('comment');
        expect(declared.filter((field) => !written.includes(field))).toEqual([]);
    });
});
