import { expect, it } from 'vitest';
import { cpuUsage } from 'node:process';
import {
    extractUciMoveLine,
    extractUciMoveTree,
    extractFenTag,
    stripRecordMetadata,
    isMoveImportTextTooLarge,
    hasTooManyUciMoves,
} from './moveImport';
import { decodeSavedMoveTreeParam } from './shareTree';
import { normalizeSavedGames, normalizeSavedMoveTree } from './gameLibrary';
import { parseFenBoard, parseMove } from './xiangqi';
import { toSearchTerms, matchesSearchTerms } from './searchTerms';
import { canonicaliseNotationToken, parseNotationRecord } from './xiangqiNotation';
import { parseDhtmlXqRecord } from './dhtmlxq';
import { parseCloudBookResponse } from './cloudBook';
import { parseCloudPvResponse } from './cloudPv';
import { parseCloudRuleResponse } from './cloudRule';
import { normalizeStoredPreferencesValue } from './preferences';
import { readAutoSavedGame } from './autoSave';
import { planMoveLineImport } from './moveLineImportPlan';

/**
 * Every entry point here reads text the app did not write: a paste, a share
 * link, a library backup restored from a file. web-chess sweeps its six PGN
 * entry points this way; this repo had the guard on `moveImport` alone, which
 * is where its own quadratic bracket scan was caught. The rest were never
 * swept -- including the notation reader, which was added last and is the
 * one that pastes of a Chinese or WXF record land in. It was over the bound
 * by four and a half seconds when it was finally swept.
 *
 * The assertion is a time bound rather than a value: what makes a wrong file
 * dangerous is not that it parses to the wrong thing, it is that it never
 * comes back. Deep nesting is included because a JSON tree from a backup is
 * normalized by a function that recurses per node -- web-katrain overflowed
 * its stack on exactly that shape.
 *
 * Four families were missing from the list the rationale above describes, and
 * are here now:
 *
 * - **`parseDhtmlXqRecord`**, which is not merely *an* entry point for a paste
 *   but the *first* one: `planMoveLineImport` tries it before the coordinate
 *   and notation readers, so whatever it costs, every paste pays.
 * - **`planMoveLineImport`** itself, which is what the import box now calls.
 * - **The three cloud parsers.** Text the app did not write is exactly what a
 *   reply from a third-party server is, and a reply that never finishes
 *   parsing hangs the tab of a reader who only turned the book on.
 * - **The two storage readers.** `localStorage` is shared with every other tab
 *   on the origin and with anything the reader has installed; the app is not
 *   the only writer of what it reads back.
 */
const NASTY: Array<[string, string]> = [
    ['empty', ''],
    ['whitespace', '   \n\t  '],
    ['many open braces', '{'.repeat(20_000)],
    ['many open brackets', '['.repeat(20_000)],
    ['alternating delimiters', '{}[]'.repeat(20_000)],
    ['unclosed comment', '1. h2e2 {never closed'],
    ['unclosed bracket tag', '[Event "never closed'],
    ['long token', 'h'.repeat(200_000)],
    ['many moves', Array.from({ length: 40_000 }, () => 'h2e2').join(' ')],
    ['many numbered moves', Array.from({ length: 20_000 }, (_, i) => `${i}. h2e2 h9g7`).join(' ')],
    ['deep variation nesting', '('.repeat(5_000) + 'h2e2' + ')'.repeat(5_000)],
    ['deep json nesting', '['.repeat(5_000) + ']'.repeat(5_000)],
    ['bad fen tag', '[FEN "' + '/'.repeat(20_000) + '"]'],
    ['nul bytes', '\0\0\0h2e2\0\0'],
    ['lone surrogates', '\ud800\ud800\ud800'],
    ['minified script', 'function f(){return[1,2,3]}'.repeat(20_000)],
    // Shaped like moves, and that is the point: the notation reader spends a
    // full legal-move generation on anything move-shaped, so junk it can
    // discard cheaply is not what costs it. These are sized to the import
    // box's own 200,000-character limit.
    ['many chinese move tokens', '\u70ae\u4e8c\u5e73\u4e94 '.repeat(40_000)],
    ['many wxf move tokens', 'C2=5 '.repeat(40_000)],
    ['many move-shaped tokens naming nothing', 'C9=9 '.repeat(40_000)],
    ['many numbered notation lines', Array.from({ length: 20_000 }, (_, i) => `${i}. C2=5 C8=5`).join('\n')],
    // Shaped for the readers added below. A sweep only sweeps a parser once
    // the input looks like the thing that parser is looking for: PGN-shaped
    // junk is discarded by a DhtmlXQ or cloud reader in one test.
    ['dhtmlxq with many tags', '[DhtmlXQ]' + '[DhtmlXQ_comment1]note[/DhtmlXQ_comment1]'.repeat(20_000) + '[/DhtmlXQ]'],
    ['dhtmlxq unclosed tag', '[DhtmlXQ][DhtmlXQ_movelist]' + '0'.repeat(200_000)],
    ['dhtmlxq huge binit', `[DhtmlXQ][DhtmlXQ_binit]${'9'.repeat(200_000)}[/DhtmlXQ_binit][/DhtmlXQ]`],
    ['dhtmlxq nested open tags', '[DhtmlXQ]'.repeat(20_000)],
    ['cloud reply, many moves', Array.from({ length: 40_000 }, () => 'move:h2e2,score:1,rank:0,note:x,winrate:50').join('|')],
    ['cloud reply, one huge note', `move:h2e2,score:1,rank:0,note:${'a,'.repeat(80_000)},winrate:50`],
    ['cloud reply, bars only', '|'.repeat(200_000)],
    ['cloud reply, key-shaped commas', 'move:h2e2,' + 'score:1,'.repeat(25_000)],
    ['cloud reply, long pv', `score:1,depth:1,pv:${Array.from({ length: 40_000 }, () => 'h2e2').join('|')}`],
    ['stored json, wide object', `{${Array.from({ length: 40_000 }, (_, i) => `"k${i}":1`).join(',')}}`],
    ['stored json, huge array', `[${Array.from({ length: 100_000 }, () => '1').join(',')}]`],
    // The shapes the shared metadata scanner in `pgnText.ts` introduced. It
    // walks `[`, `{`, `;` and `%` openers, reads a tag pair with a sticky
    // quoted-string pattern, and falls back to the first `]` when that does not
    // match -- so a paste made of openers with no closer, or of tag pairs whose
    // quotes swallow the `]` that would end them, is where it would go
    // quadratic. The brace and bracket runs above cover the two older openers.
    // `many open braces` above is 20,000 characters, and at that size the
    // quadratic brace scan this sweep is meant to catch now finishes inside the
    // bound -- removing the guard leaves every case green. The importer accepts
    // 200,000, so the sweep asks at the size a reader can actually reach.
    ['many open braces at the import limit', '{'.repeat(200_000)],
    ['many escape lines', '%\n'.repeat(100_000)],
    ['many semicolon remarks', ';\n'.repeat(100_000)],
    ['escape line never terminated', '%' + 'a'.repeat(200_000)],
    ['tag openers with no closer', '[A "'.repeat(50_000)],
    ['tag pairs whose quotes eat the bracket', '[A "]" '.repeat(28_000)],
    ['quote run with one bracket at the end', '[A "' + '"'.repeat(100_000) + ']'],
];

for (const [name, input] of NASTY) {
    it(`survives: ${name}`, () => {
        const cpuStarted = cpuUsage();
        const started = performance.now();

        isMoveImportTextTooLarge(input);
        hasTooManyUciMoves(input);
        extractUciMoveLine(input);
        extractUciMoveTree(input);
        extractFenTag(input);
        stripRecordMetadata(input);
        decodeSavedMoveTreeParam(input);
        normalizeSavedGames(input);
        try { parseFenBoard(input); } catch { /* an invalid FEN is expected to throw */ }
        parseMove(input);
        matchesSearchTerms(input, toSearchTerms(input));
        canonicaliseNotationToken(input);
        parseNotationRecord(undefined, input);
        parseDhtmlXqRecord(input);
        parseCloudBookResponse(input);
        parseCloudPvResponse(input);
        parseCloudRuleResponse(input);
        normalizeStoredPreferencesValue(input);
        readAutoSavedGame({ getItem: () => input, setItem: () => {}, removeItem: () => {} });
        planMoveLineImport(input, input, {
            validateMoveSequence: () => ({ ok: true }),
            validateMoveTree: () => ({ ok: true }),
        });

        const elapsed = performance.now() - started;
        const cpu = cpuUsage(cpuStarted);
        const cpuMs = (cpu.user + cpu.system) / 1000;
        expect(elapsed, `${name} took ${elapsed.toFixed(0)}ms wall (${cpuMs.toFixed(0)}ms process CPU)`).toBeLessThan(1000);
    });
}

/**
 * The library restores a move tree from JSON, and the normalizer recurses once
 * per node. The node cap bounds how many nodes it will accept, which bounds
 * the depth -- this asserts that the bound is what stops it, rather than the
 * call stack.
 */
it('rejects a deeply nested saved tree without overflowing the stack', () => {
    const deep: Record<string, unknown> = { uci: 'h2e2' };
    let tip = deep;
    for (let i = 0; i < 20_000; i++) {
        const child: Record<string, unknown> = { uci: 'h2e2' };
        tip.children = [child];
        tip = child;
    }

    const started = performance.now();
    expect(() => normalizeSavedMoveTree([deep])).not.toThrow();
    expect(normalizeSavedMoveTree([deep])).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
});
