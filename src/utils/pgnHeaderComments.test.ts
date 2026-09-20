import { describe, expect, it } from 'vitest';
import { extractPgnHeaders, extractPgnMetadata } from './gameMetadata';
import { extractFenTag, extractUciMoveLine, extractUciMoveTree } from './moveImport';
import { planMoveLineImport } from './moveLineImportPlan';
import { extractPgnResult } from './pgnResult';
import { START_POSITION_FEN } from './xiangqi';

const fen = START_POSITION_FEN.replace(' w - - 0 1', ' b - - 0 42');
const validators = { validateMoveSequence: () => ({ ok: true }), validateMoveTree: () => ({ ok: true }) };

describe('comments around the first PGN headers', () => {
    it.each(['{Preparation note}', '; Preparation note'])('keeps moves and metadata after %s', comment => {
        const source = `${comment}\r\n[Event "Training"]\r\nh2e2 $1 {Move note} h9g7 *`;
        expect(extractUciMoveLine(source)).toEqual(['h2e2', 'h9g7']);
        expect(extractUciMoveTree(source)).toMatchObject({ rootComment: 'Preparation note', hadMoreGames: false,
            moveTree: [{ uci: 'h2e2', nags: [1], comment: 'Move note', children: [{ uci: 'h9g7' }] }] });
        expect(planMoveLineImport(source, '', validators)).toMatchObject({ kind: 'line', moves: ['h2e2', 'h9g7'], rootComment: 'Preparation note' });
        expect(extractPgnMetadata(source)).toEqual({ event: 'Training' });
    });

    it('reads interleaved headers without taking FEN, metadata or results from their comments', () => {
        const source = `{Example [FEN "fake"] [Event "Fake"] 1-0}\n[Event "Training"]
; [FEN "also fake"] [Result "invalid"] {
[FEN "${fen}"] {Between headers} [Result "*"]
h9g7 (a9a8 {Variation 0-1}) h2e2 *`;
        expect(extractFenTag(source)).toBe(fen);
        expect(extractPgnMetadata(source)).toEqual({ event: 'Training' });
        expect(extractPgnResult(source)).toMatchObject({ source, hadMoreGames: false });
        expect(planMoveLineImport(source, '', validators)).toMatchObject({ kind: 'line', startFen: fen, moves: ['h9g7', 'h2e2'], hasVariations: true });
    });

    it('still stops at a later game, even when headers share a line or the first has no result', () => {
        for (const ending of ['', '*']) {
            const source = `{First note}\n[Event "First"] h2e2 h9g7 ${ending} [Event "Second"] b2e2 b9c7 *`;
            expect(extractUciMoveTree(source)).toMatchObject({ moves: ['h2e2', 'h9g7'], hadMoreGames: true });
            expect(extractPgnMetadata(source)).toEqual({ event: 'First' });
        }
    });

    it('never uses a later, malformed or commented-out FEN as the starting position', () => {
        for (const source of [`{[FEN "${fen}"]} h2e2`, `; [FEN "${fen}"]\nh2e2`, `h2e2 * [FEN "${fen}"]`, `[broken [FEN "${fen}"]`, `{unclosed [FEN "${fen}"]`]) {
            expect(extractFenTag(source), source).toBeNull();
        }
    });

    it('checks Result headers after comments and rejects mismatches before loading', () => {
        expect(planMoveLineImport('{Note}\n[Result "1-0"]\nh2e2 0-1', '', validators)).toMatchObject({ kind: 'error', message: 'The Result header disagrees with the final result marker.' });
        expect(extractPgnResult('; Note\n[Result "invalid"] h2e2 *')).toEqual({ error: 'Invalid Result header.' });
    });

    it('does not confuse quoted comment delimiters or non-nesting brace comments with game boundaries', () => {
        const source = '{Literal { brace}\n[Event "A { B ; C"]\nh2e2 {0-1} h9g7 *';
        expect(extractPgnHeaders(source)).toEqual({ event: 'A { B ; C' });
        expect(extractUciMoveTree(source)).toMatchObject({ moves: ['h2e2', 'h9g7'], hadMoreGames: false });
    });
});
