import { expect, it } from 'vitest';
import {
    extractUciMoveLine,
    extractUciMoveTree,
    extractFenTag,
    extractAnnotatedMainLine,
    stripRecordMetadata,
    isMoveImportTextTooLarge,
    hasTooManyUciMoves,
} from './moveImport';
import { decodeSavedMoveTreeParam } from './shareTree';
import { normalizeSavedGames, normalizeSavedMoveTree } from './gameLibrary';
import { parseFenBoard, parseMove } from './xiangqi';
import { toSearchTerms, matchesSearchTerms } from './searchTerms';
import { canonicaliseNotationToken, parseNotationRecord } from './xiangqiNotation';

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
];

for (const [name, input] of NASTY) {
    it(`survives: ${name}`, () => {
        const started = performance.now();

        isMoveImportTextTooLarge(input);
        hasTooManyUciMoves(input);
        extractUciMoveLine(input);
        extractUciMoveTree(input);
        extractFenTag(input);
        stripRecordMetadata(input);
        extractAnnotatedMainLine(input);
        decodeSavedMoveTreeParam(input);
        normalizeSavedGames(input);
        try { parseFenBoard(input); } catch { /* an invalid FEN is expected to throw */ }
        parseMove(input);
        matchesSearchTerms(input, toSearchTerms(input));
        canonicaliseNotationToken(input);
        parseNotationRecord(undefined, input);

        const elapsed = performance.now() - started;
        expect(elapsed, `${name} took ${elapsed.toFixed(0)}ms`).toBeLessThan(1000);
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
