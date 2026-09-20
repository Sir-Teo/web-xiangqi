import { expect, it } from 'vitest';
import {
    extractFenTag,
    extractUciMoveLine,
    extractUciMoveTree,
    hasTooManyUciMoves,
    isMoveImportTextTooLarge,
} from './utils/moveImport';
import { normalizeMoveComment } from './utils/moveComment';
import { parseFenBoard, parseMove } from './utils/xiangqi';
import { decodeSavedMoveTreeParam } from './utils/shareTree';
import { normalizeSavedGame, normalizeSavedGames, normalizeSavedMoveTree } from './utils/gameLibrary';
import { matchesSearchTerms, toSearchTerms } from './utils/searchTerms';

/**
 * Pathological input over every module here that reads text the app did not
 * write: pasted or imported move text, a FEN typed into the position box, a
 * shared link's encoded tree, and saved games read back out of storage.
 *
 * Ported from web-chess `src/__fuzz.test.ts` alongside the web-katrain port;
 * this repo was the last of the three without one. The suite exists because an
 * unbounded search query froze all three apps and nothing noticed, and the same
 * reasoning applies to every parser reachable from a paste.
 *
 * The assertion is deliberately weak: not that anything parses -- rejecting
 * junk is the correct outcome for most of these -- only that nothing hangs and
 * nothing throws past a caller that cannot catch it. All of it runs on the UI
 * thread while someone waits.
 *
 * Note that this app already defends its importer with explicit ceilings
 * (`MAX_MOVE_IMPORT_TEXT_LENGTH` and friends), so the useful output here is not
 * "it survived" but the margin printed when the budget is tightened.
 */

const big = (unit: string, n: number) => unit.repeat(n);

const NASTY: Array<[string, string]> = [
    ['empty', ''],
    ['whitespace', ' \n\t\r '],
    ['lone bracket', '['],
    ['unclosed tag', '[FEN "rnbakabnr/9'],
    ['unclosed comment', '1. h2e2 {never closed'],
    ['unclosed variation', '1. h2e2 (1... h9g7'],
    ['deep nesting', '1. h2e2 ' + big('(', 5000) + 'h9g7' + big(')', 5000)],
    ['many braces', big('{', 20000)],
    ['many brackets', big('[]', 20000)],
    ['long token', '1. ' + big('h', 200000)],
    ['huge movetext', Array.from({ length: 40000 }, () => 'h2e2').join(' ')],
    ['too many uci moves', big('h2e2 ', 50000)],
    ['bad headers', '[[[["""]]]]\n\n1. h2e2 *'],
    ['fen soup', big('rnbakabnr/9/1c5c1/', 20000)],
    ['fen with huge rank', 'r' + big('9', 100000) + '/9 w - - 0 1'],
    ['slashes only', big('/', 100000)],
    ['digits only', big('9', 100000)],
    ['alternating', big('(){}', 20000)],
    ['combining marks', big('á́́', 20000)],
    ['replacement chars', big('�', 40000)],
    ['astral plane', big('\u{1F600}', 20000)],
    ['lone surrogates', big('\uD800', 20000)],
    ['json-ish', '{"games":[' + big('{"a":1},', 20000) + '{}]}'],
    ['nested json', big('{"a":', 5000) + '1' + big('}', 5000)],
    ['base64-ish share param', big('QUJDRA', 40000)],
];

const BUDGET_MS = 1000;

for (const [name, input] of NASTY) {
    it(`survives: ${name}`, () => {
        const started = performance.now();

        // Reachable from the import box, a pasted file, or a shared link.
        isMoveImportTextTooLarge(input);
        hasTooManyUciMoves(input);
        extractUciMoveLine(input);
        extractUciMoveTree(input);
        extractFenTag(input);
        // The annotated pass walks the same text a second time, with its own
        // scanner for `{...}` comments and `$` glyphs, and now pulls prose out
        // of every comment it finds. `many braces` and `alternating` are the
        // inputs that pass the most work through it.
        normalizeMoveComment(input);

        try { parseFenBoard(input); } catch { /* invalid FEN is expected to throw */ }
        parseMove(input);

        decodeSavedMoveTreeParam(input);

        // Storage is outside input too: another tab, an older version, or a
        // hand-edited localStorage all reach these.
        normalizeSavedMoveTree(input);
        normalizeSavedGame(input);
        normalizeSavedGames(input);

        matchesSearchTerms(input, toSearchTerms(input));

        const elapsed = performance.now() - started;
        expect(elapsed, `${name} took ${elapsed.toFixed(0)}ms`).toBeLessThan(BUDGET_MS);
    });
}
