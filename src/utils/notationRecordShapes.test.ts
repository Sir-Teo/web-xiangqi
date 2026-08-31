import { describe, expect, it } from 'vitest';
import { canonicaliseNotationToken, parseNotationRecord } from './xiangqiNotation';

/**
 * The ways a record is actually written down, all naming one game.
 *
 * A record is pasted from somewhere -- a database, a forum post, a book being
 * typed up -- and those sources disagree about punctuation while agreeing
 * completely about the moves. This asserts the agreement.
 *
 * It exists because the disagreements were not being read as decoration and
 * ignored, which would have been harmless. They were being read as decoration
 * and *skipped*, which is not the same thing. Skipping the token that carries
 * a move leaves the board a move behind, and the next token is then matched
 * against a position the record never reached -- where, because the opening is
 * symmetric and files are numbered from each player's own right, it is very
 * often a legal move for the other side.
 *
 * So `1.C2=5 H8+7` did not import as one move and a complaint. It imported as
 * `b0c2`: a single move belonging to neither half of that line, with nothing
 * rejected, no error, and no notice. Three of the shapes below did that.
 */

/** Red's central cannon and Black's horse: the first two plies, whatever the spelling. */
const TRUTH = ['h2e2', 'h9g7'];

const RECORDS: Array<[string, string]> = [
    ['a number and a space', '1. C2=5 H8+7'],
    ['a number against the move', '1.C2=5 H8+7'],
    ['a number against a Chinese move', '1.炮二平五 马8进7'],
    ['full-width numbering', '１． C2=5 H8+7'],
    ['full-width numbering against the move', '１．炮二平五 马8进7'],
    ['no numbering at all', 'C2=5 H8+7'],
    ['an ellipsis before black', '1. C2=5 1... H8+7'],
    ['an ellipsis against the move', '1. C2=5 1...H8+7'],
    ['a bracketed number', '1) C2=5 H8+7'],
    ['a result on the end', '1. C2=5 H8+7 1-0'],
    ['a Chinese result on the end', '1. 炮二平五 马8进7 红胜'],
    ['tabs between', '1.\tC2=5\tH8+7'],
    ['a line break between', '1. C2=5\nH8+7'],
    ['a dot for the traverse', '1. C2.5 H8+7'],
    ['annotations on both moves', '1. C2=5! H8+7?!'],
    ['a check mark on the reply', '1. C2=5 H8+7+'],
];

describe('one game, written the ways records write it', () => {
    for (const [name, text] of RECORDS) {
        it(`reads it with ${name}`, () => {
            const parsed = parseNotationRecord(undefined, text);
            expect(parsed.rejected, name).toEqual([]);
            expect(parsed.moves, name).toEqual(TRUTH);
        });
    }

    it('still refuses the punctuation on its own', () => {
        // The stripping above must not turn a move number into a move. This is
        // the shape check's whole job and the reason it exists.
        for (const token of ['1.', '2...', '10.', '１．', '1)', '1-0', '0-1', '$1', '红胜']) {
            expect(canonicaliseNotationToken(token), token).toBeNull();
        }
    });

    it('leaves a numeral that belongs to the move alone', () => {
        // A soldier on a file stacked more than three deep is counted from the
        // front, and that count opens the token: 四兵進一 in Chinese, and in
        // WXF `45+1`, which drops the piece letter entirely and is therefore
        // nothing but numerals and an action.
        //
        // This is why the separator is required rather than optional. A
        // numeral is only a move number when a full stop or a bracket follows
        // it, and none of these has one.
        expect(canonicaliseNotationToken('四兵進一')).not.toBeNull();
        expect(canonicaliseNotationToken('45+1')).not.toBeNull();
        expect(canonicaliseNotationToken('15+1')).not.toBeNull();
    });
});
