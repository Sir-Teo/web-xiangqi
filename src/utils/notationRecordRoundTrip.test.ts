import { describe, expect, it } from 'vitest';
import { START_FEN, parseFenBoard } from './xiangqi';
import { formatLineInStyle, parseNotationRecord } from './xiangqiNotation';

/**
 * A whole game written in Chinese and in WXF, then read back.
 *
 * `xiangqiNotation.test.ts` round trips every legal move in five *positions*,
 * which pins the formatter and the parser against each other one move at a
 * time. A whole game is a different claim, and the one a user actually makes
 * when they paste a record:
 *
 * - it threads the board across 120 plies, so a formatter that is right about
 *   a move but wrong about the position it leaves behind desynchronises here
 *   and nowhere else;
 * - the front/rear markers (前/後, `+`/`-`) only arise once pieces double up
 *   on a file, which does not happen in an opening excerpt;
 * - the tokeniser meets a realistic record rather than a single line.
 *
 * `realWorldPgn.test.ts` covers pasted Chinese, but in three-move fragments.
 *
 * The fixture is the same 120-ply engine self-play game
 * `exportRoundTripLong.test.ts` uses, so both round trips describe one game.
 */
const LONG = [
    'b2e2', 'b9c7', 'b0c2', 'a9b9', 'c3c4', 'b7a7', 'h0i2', 'i6i5', 'i0i1', 'g6g5',
    'a0a1', 'h9g7', 'h2h6', 'c9e7', 'i1b1', 'i5i4', 'b1b9', 'c7b9', 'i3i4', 'i9i4',
    'c0a2', 'b9c7', 'h6g6', 'h7h2', 'c2b4', 'a7a3', 'a1h1', 'h2a2', 'b4a2', 'i4i2',
    'h1h7', 'i2i7', 'h7i7', 'g9i7', 'e3e4', 'a6a5', 'a2c3', 'i7g9', 'e4e5', 'e6e5',
    'g6g9', 'f9e8', 'e2e7', 'e9f9', 'g9g5', 'g7f5', 'e7i7', 'f5g3', 'g5a5', 'g3e4',
    'c3d1', 'e4d2', 'd0e1', 'd2b3', 'a5a4', 'c7e6', 'i7i5', 'e8d7', 'e0d0', 'e6f8',
    'i5i2', 'f8g6', 'i2f2', 'c6c5', 'c4c5', 'b3c5', 'd1c3', 'd9e8', 'f2c2', 'c5a4',
    'c3a4', 'g6f4', 'c2f2', 'f4d3', 'f2f1', 'd3b4', 'd0e0', 'e5e4', 'a4b6', 'a3e3',
    'e1f2', 'f9e9', 'f1h1', 'e4f4', 'h1f1', 'f4e4', 'b6c8', 'e9d9', 'f1h1', 'e4d4',
    'h1h2', 'e3e5', 'h2h6', 'e5e6', 'h6h5', 'e8f7', 'c8a7', 'e6e5', 'a7b5', 'd4e4',
    'f0e1', 'b4d3', 'e0f0', 'd3f4', 'h5h2', 'f4h3', 'b5d6', 'e4f4', 'd6c4', 'e5e4',
    'c4d6', 'e4e8', 'g0e2', 'e8e6', 'd6b5', 'e6e7', 'e2c4', 'e7e4', 'c4e2', 'e4e5',
];

/** The record as a database writes it: numbered pairs, one per line. */
function asNumberedRecord(tokens: string[]): string {
    const lines: string[] = [];
    for (let index = 0; index < tokens.length; index += 2) {
        const number = index / 2 + 1;
        lines.push(`${number}. ${tokens[index]}${tokens[index + 1] ? ` ${tokens[index + 1]}` : ''}`);
    }
    return lines.join('\n');
}

const STYLES = ['wxf', 'chinese'] as const;

describe('a whole game written in notation and read back', () => {
    for (const style of STYLES) {
        it(`names all 120 plies in ${style} without repeating itself`, () => {
            const text = formatLineInStyle(parseFenBoard(START_FEN), LONG, style, LONG.length);
            const tokens = text.split(/\s+/).filter(Boolean);
            expect(tokens).toHaveLength(LONG.length);
            // A token that came back empty or as raw UCI would round trip fine
            // and mean the formatter had given up somewhere in the middle.
            for (const [index, token] of tokens.entries()) {
                expect(token, `ply ${index + 1}`).not.toMatch(/^[a-i][0-9][a-i][0-9]$/i);
                expect(token.length, `ply ${index + 1}`).toBeGreaterThan(0);
            }
        });

        it(`reads ${style} back as the same game`, () => {
            const text = formatLineInStyle(parseFenBoard(START_FEN), LONG, style, LONG.length);
            const parsed = parseNotationRecord(undefined, text);
            expect(parsed.rejected).toEqual([]);
            expect(parsed.moves).toEqual(LONG);
        });

        it(`reads ${style} back when it is numbered the way a database writes it`, () => {
            const text = formatLineInStyle(parseFenBoard(START_FEN), LONG, style, LONG.length);
            const parsed = parseNotationRecord(undefined, asNumberedRecord(text.split(/\s+/).filter(Boolean)));
            expect(parsed.rejected).toEqual([]);
            expect(parsed.moves).toEqual(LONG);
        });
    }

    it('actually reaches the doubled-file case the round trips are meant to cover', () => {
        // Without this the two round trips above could be passing on simple
        // shapes alone, and a later change to the fixture could quietly remove
        // the tandem case without any test noticing.
        //
        // Checked precisely on purpose: in WXF `+` and `-` are also advance and
        // retreat, so "contains a plus or minus" matches nearly every move and
        // asserts nothing. The tandem marker is the *leading* character.
        const chineseTokens = formatLineInStyle(parseFenBoard(START_FEN), LONG, 'chinese', LONG.length)
            .split(/\s+/).filter(Boolean);
        const wxfTokens = formatLineInStyle(parseFenBoard(START_FEN), LONG, 'wxf', LONG.length)
            .split(/\s+/).filter(Boolean);

        // Both advisors reach the same file twice in this game: 後士進5 / -A+5.
        expect(chineseTokens.filter((token) => /^[前後中]/.test(token))).toEqual(['後士進5', '後仕進五']);
        expect(wxfTokens.filter((token) => /^[+-]/.test(token))).toEqual(['-A+5', '-A+5']);
    });
});
