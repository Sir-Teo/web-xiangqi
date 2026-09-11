import { describe, expect, it } from 'vitest';
import { extractAnnotatedMainLine, extractUciMoveLine, stripRecordMetadata } from './moveImport';
import { exportPgn } from './gameExport';
import { MATE_SCORE_BASE } from './engineEvalReading';
import type { MoveRecord } from '../hooks/useXiangqi';

const record = (uci: string, ply: number, extra: Partial<MoveRecord> = {}): MoveRecord => ({
    uci, piece: ply % 2 === 1 ? 'C' : 'c', captured: '', board: [],
    sideToMove: ply % 2 === 1 ? 'b' : 'w', inCheck: false, ply, ...extra,
});

describe('reading a review back out of a PGN', () => {
    it('round trips what this app writes', () => {
        const moves = [
            record('h2e2', 1, { evalScore: 38, quality: 'best' }),
            record('h9g7', 2, { evalScore: -180, quality: 'mistake', bestMove: 'b9c7' }),
            record('b0c2', 3, { evalScore: 210, quality: 'inaccuracy', bestMove: 'c3c4' }),
            record('b9c7', 4, { evalScore: -820, quality: 'blunder', bestMove: 'h7e7' }),
        ];
        const parsed = extractAnnotatedMainLine(exportPgn(moves, { date: '2026.08.31' }));
        expect(parsed.moves).toEqual(['h2e2', 'h9g7', 'b0c2', 'b9c7']);
        expect(parsed.annotations).toEqual([
            { evalScore: 38 },
            { evalScore: -180, quality: 'mistake' },
            { evalScore: 210, quality: 'inaccuracy' },
            { evalScore: -820, quality: 'blunder' },
        ]);
    });

    it('walks the same main line as the plain extractor', () => {
        // Two parsers that disagree about which moves the line holds would put
        // an annotation on the wrong move, so this is the property that matters.
        const pgn = `[Variant "Xiangqi"]\n[FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"]\n\n` +
            `1. h2e2 { [%eval 0.38] } h9g7 $2 { [%eval -1.80] Better was b9c7 } ` +
            `2. b0c2 (2. h0g2 $4 { [%eval -3.00] } b9c7) b9c7 *\n`;
        expect(extractAnnotatedMainLine(pgn).moves).toEqual(extractUciMoveLine(stripRecordMetadata(pgn)));
    });

    it('ignores annotations inside a variation', () => {
        // They belong to moves that were not played.
        const pgn = `1. h2e2 { [%eval 0.38] } (1. h0g2 $4 { [%eval -9.99] }) h9g7 *`;
        const parsed = extractAnnotatedMainLine(pgn);
        expect(parsed.moves).toEqual(['h2e2', 'h9g7']);
        expect(parsed.annotations).toEqual([{ evalScore: 38 }, {}]);
    });

    it('is not fooled by coordinates hiding in a FEN tag', () => {
        // "1c5c1" contains "c5c1", which reads as a move. Tags are consumed
        // whole, so it never reaches the move matcher.
        const pgn = `[FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"]\n\n1. h2e2 *`;
        expect(extractAnnotatedMainLine(pgn).moves).toEqual(['h2e2']);
    });

    it('reads a mate back as the score this app encodes', () => {
        expect(extractAnnotatedMainLine('1. h2e2 { [%eval #3] } *').annotations[0])
            .toEqual({ evalScore: MATE_SCORE_BASE - 3 });
        expect(extractAnnotatedMainLine('1. h2e2 { [%eval #-3] } *').annotations[0])
            .toEqual({ evalScore: -(MATE_SCORE_BASE - 3) });
    });

    it('accepts signed scores, decimal shorthand and optional depth suffixes', () => {
        for (const [value, expected, evalDepth] of [
            ['+0.42,18', 42, 18], ['-.75,21', -75, 21], ['42.,0', 4200, 0], ['.5', 50, undefined],
            ['#+3,24', MATE_SCORE_BASE - 3, 24], ['#-0,0', -MATE_SCORE_BASE, 0],
        ] as const) {
            expect(extractAnnotatedMainLine(`h2e2 {[%eval ${value}]}`).annotations[0]).toEqual({ evalScore: expected, evalDepth });
        }
    });

    it('takes the first valid evaluation in a comment regardless of score kind', () => {
        expect(extractAnnotatedMainLine('h2e2 {[%eval +.42,18] [%eval #3]}').annotations[0]).toEqual({ evalScore: 42, evalDepth: 18 });
        expect(extractAnnotatedMainLine('h2e2 {[%eval #-30001] [%eval -.42,18]}').annotations[0]).toEqual({ evalScore: -42, evalDepth: 18 });
    });

    it('rejects malformed evaluations and values that cannot be represented safely', () => {
        for (const value of ['Infinity', 'NaN', '0.42,-1', '0.42,fast', '0.42,1.5', '1e3', '#30001', '#-30001', '9'.repeat(310), '#3.5']) {
            expect(extractAnnotatedMainLine(`h2e2 {[%eval ${value}]}`).annotations[0]).toEqual({});
        }
    });

    it('accepts the suffix symbols other tools write instead of NAGs', () => {
        const parsed = extractAnnotatedMainLine('1. h2e2?! h9g7? 2. b0c2?? b9c7 *');
        expect(parsed.annotations.map((a) => a.quality))
            .toEqual(['inaccuracy', 'mistake', 'blunder', undefined]);
    });

    it('leaves a grade off the NAGs that are not a quality scale', () => {
        // $3 is "very good move" and $5 "interesting"; neither is a grade on
        // this app's ladder, and inventing one would label a move nobody graded.
        expect(extractAnnotatedMainLine('1. h2e2 $3 h9g7 $5 *').annotations)
            .toEqual([{}, {}]);
    });

    it('says nothing about a record with no annotations at all', () => {
        const parsed = extractAnnotatedMainLine('1. h2e2 h9g7 2. b0c2 *');
        expect(parsed.moves).toEqual(['h2e2', 'h9g7', 'b0c2']);
        expect(parsed.annotations).toEqual([{}, {}, {}]);
    });

    it('does not attach a leading annotation to nothing', () => {
        expect(() => extractAnnotatedMainLine('{ [%eval 0.10] } $4 1. h2e2 *')).not.toThrow();
        expect(extractAnnotatedMainLine('{ [%eval 0.10] } $4 1. h2e2 *').annotations).toEqual([{}]);
    });

    it('survives an unclosed comment or variation', () => {
        expect(extractAnnotatedMainLine('1. h2e2 { unterminated').moves).toEqual(['h2e2']);
        expect(extractAnnotatedMainLine('1. h2e2 (1. h0g2').moves).toEqual(['h2e2']);
    });
});

describe('a mate that has already happened', () => {
    it('keeps its side through the round trip', () => {
        // Black mated writes as a distance of -0, and `${-0}` is "0", so it
        // used to write as `#0` and read back as red's mate. Found by sweeping
        // generated games rather than by reading the code.
        expect(extractAnnotatedMainLine('1. h2e2 { [%eval #-0] } *').annotations[0])
            .toEqual({ evalScore: -MATE_SCORE_BASE });
        expect(extractAnnotatedMainLine('1. h2e2 { [%eval #0] } *').annotations[0])
            .toEqual({ evalScore: MATE_SCORE_BASE });
    });

    it('is written with its sign in the first place', () => {
        const black = exportPgn([record('h2e2', 1, { evalScore: -MATE_SCORE_BASE })], { date: '2026.08.31' });
        expect(black).toContain('[%eval #-0]');
        const red = exportPgn([record('h2e2', 1, { evalScore: MATE_SCORE_BASE })], { date: '2026.08.31' });
        expect(red).toContain('[%eval #0]');
    });
});
