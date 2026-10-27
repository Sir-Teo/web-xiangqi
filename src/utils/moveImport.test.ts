import { describe, expect, it } from 'vitest';
import {
    MAX_MOVE_IMPORT_TEXT_LENGTH,
    MAX_MOVE_IMPORT_TREE_NODES,
    MAX_MOVE_IMPORT_UCI_MOVES,
    extractFenTag,
    extractUciMoveLine,
    extractUciMoveTree,
    isMoveImportTextTooLarge,
    hasTooManyUciMoves,
} from './moveImport';
import { normalizeSavedGame } from './gameLibrary';

describe('reading a line of moves', () => {
    it('reads plain UCI', () => {
        expect(extractUciMoveLine('h2e2 h9g7 b0c2')).toEqual(['h2e2', 'h9g7', 'b0c2']);
    });

    it('reads the separators people actually paste', () => {
        expect(extractUciMoveLine('h2-e2 h9->g7 b0=>c2 c3:c4 g3x g4')).toContain('h2e2');
        expect(extractUciMoveLine('h2-e2')).toEqual(['h2e2']);
        expect(extractUciMoveLine('h2→e2')).toEqual(['h2e2']);
    });

    it('lowercases whatever case it is given', () => {
        expect(extractUciMoveLine('H2E2 H9G7')).toEqual(['h2e2', 'h9g7']);
    });

    it('steps over PGN headers, comments and move numbers', () => {
        expect(extractUciMoveLine('[Event "Test"]\n1. h2e2 {a comment} h9g7 ; trailing\n')).toEqual(['h2e2', 'h9g7']);
    });

    it('takes only the main line, skipping variations at any depth', () => {
        expect(extractUciMoveLine('h2e2 (h2d2 b9c7) h9g7')).toEqual(['h2e2', 'h9g7']);
        expect(extractUciMoveLine('h2e2 (h2d2 (b0c2 x) b9c7) h9g7')).toEqual(['h2e2', 'h9g7']);
    });

    it('preserves token boundaries and recovers malformed variation endings', () => {
        expect(extractUciMoveLine('h2(ignored)e2')).toEqual([]);
        expect(extractUciMoveLine('h2e2)h9g7')).toEqual(['h2e2', 'h9g7']);
        expect(extractUciMoveLine('h2e2 (b2e2 (炮🐎) h9g7')).toEqual(['h2e2']);
        expect(extractUciMoveLine('h2e2 (b2e2 (炮🐎))h9g7')).toEqual(['h2e2', 'h9g7']);
        const hidden = `h2e2 (${('b2e2 ').repeat(MAX_MOVE_IMPORT_UCI_MOVES + 1)}) h9g7`;
        expect(hasTooManyUciMoves(hidden)).toBe(false);
        expect(extractUciMoveLine(hidden)).toEqual(['h2e2', 'h9g7']);
    });

    it('finds nothing in text with no moves', () => {
        expect(extractUciMoveLine('')).toEqual([]);
        expect(extractUciMoveLine('no moves here')).toEqual([]);
    });

    it('stops at the cap, and stops at exactly the cap', () => {
        const many = Array.from({ length: MAX_MOVE_IMPORT_UCI_MOVES + 50 }, () => 'h2e2').join(' ');
        expect(extractUciMoveLine(many)).toHaveLength(MAX_MOVE_IMPORT_UCI_MOVES);
    });

    it('produces a line the library will actually accept at the cap', () => {
        const many = Array.from({ length: MAX_MOVE_IMPORT_UCI_MOVES + 50 }, () => 'h2e2').join(' ');
        const saved = normalizeSavedGame({
            id: 'g', savedAt: 1, gameMode: 'PvP', moves: extractUciMoveLine(many),
        });
        expect(saved).not.toBeNull();
    });
});

describe('reading a tree of moves', () => {
    it('reads a straight line as a chain', () => {
        const { moves, moveTree, hasVariations } = extractUciMoveTree('h2e2 h9g7');
        expect(moves).toEqual(['h2e2', 'h9g7']);
        expect(moveTree).toEqual([{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }]);
        expect(hasVariations).toBe(false);
    });

    it('makes a variation an alternative to the move it replaces', () => {
        // (b9c7) is an alternative to h9g7, so both hang off h2e2, and b0c2
        // continues the main line after h9g7.
        const { moveTree, hasVariations } = extractUciMoveTree('h2e2 h9g7 (b9c7) b0c2');
        expect(hasVariations).toBe(true);
        expect(moveTree[0].children?.map(child => child.uci)).toEqual(['h9g7', 'b9c7']);
        expect(moveTree[0].children?.[0].children?.map(child => child.uci)).toEqual(['b0c2']);
        expect(moveTree[0].children?.[1].children).toBeUndefined();
    });

    it('keeps the main line when a variation closes', () => {
        expect(extractUciMoveTree('h2e2 (h2d2) h9g7').moves).toEqual(['h2e2', 'h9g7']);
    });

    it('reports when it had to stop early', () => {
        const many = Array.from({ length: MAX_MOVE_IMPORT_TREE_NODES + 10 }, () => 'h2e2').join(' ');
        const result = extractUciMoveTree(many);
        expect(result.tooLarge).toBe(true);
        expect(result.moves.length).toBeLessThanOrEqual(MAX_MOVE_IMPORT_TREE_NODES);
    });

    it('does not report a normal game as too large', () => {
        expect(extractUciMoveTree('h2e2 h9g7').tooLarge).toBe(false);
    });
});

describe('reading a start position', () => {
    it('finds a FEN tag and tidies its spacing', () => {
        expect(extractFenTag('[FEN  "rnbakabnr/9/9/9/9/9/9/9/9/RNBAKABNR   w - - 0 1"]'))
            .toBe('rnbakabnr/9/9/9/9/9/9/9/9/RNBAKABNR w - - 0 1');
    });

    it('is not fussy about the tag name case', () => {
        expect(extractFenTag('[fen "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"]')).toContain('4k4');
    });

    it('finds nothing when there is no tag', () => {
        expect(extractFenTag('h2e2 h9g7')).toBeNull();
        expect(extractFenTag('')).toBeNull();
    });
});

describe('a paste that is not really a game record', () => {
    it('still strips the tags and comments it is supposed to', () => {
        expect(extractUciMoveLine('[Event "h2e2"]\n1. h9g7 {h2e2} b0c2')).toEqual(['h9g7', 'b0c2']);
        expect(extractUciMoveLine('{h2e2} h9g7')).toEqual(['h9g7']);
        // An unterminated comment is left in place and what follows still
        // reads as moves, which is what the regex did too.
        expect(extractUciMoveLine('h9g7 {unterminated b0c2')).toEqual(['h9g7', 'b0c2']);
    });
});

describe('guarding against a huge paste', () => {
    it('flags text past the limit and passes text under it', () => {
        expect(isMoveImportTextTooLarge('h2e2')).toBe(false);
        expect(isMoveImportTextTooLarge('x'.repeat(MAX_MOVE_IMPORT_TEXT_LENGTH))).toBe(false);
        expect(isMoveImportTextTooLarge('x'.repeat(MAX_MOVE_IMPORT_TEXT_LENGTH + 1))).toBe(true);
    });
});

describe('telling an oversized source from a full one', () => {
    const line = (n: number) => Array.from({ length: n }, () => 'b2e2').join(' ');

    it('caps what it extracts so the result can always be saved', () => {
        expect(extractUciMoveLine(line(MAX_MOVE_IMPORT_UCI_MOVES + 2)))
            .toHaveLength(MAX_MOVE_IMPORT_UCI_MOVES);
    });

    it('still reports a source that carried more than the cap', () => {
        // The extracted length can no longer say this, so a caller that must
        // reject rather than truncate has to ask separately.
        expect(hasTooManyUciMoves(line(MAX_MOVE_IMPORT_UCI_MOVES + 1))).toBe(true);
    });

    it('treats a line exactly at the cap as importable', () => {
        expect(hasTooManyUciMoves(line(MAX_MOVE_IMPORT_UCI_MOVES))).toBe(false);
    });

    it('says nothing is oversized about ordinary input', () => {
        expect(hasTooManyUciMoves('h2e2 h9g7')).toBe(false);
        expect(hasTooManyUciMoves('')).toBe(false);
    });
});

describe('parts of a record that are not moves', () => {
    /**
     * Both readers, because they are separate walks of the same text: one
     * strips the metadata and scans what is left, one tokenises as it goes. A
     * fix applied to one and not the other is a disagreement about what the
     * movetext is.
     */
    const readers = {
        line: (text: string) => extractUciMoveLine(text),
        tree: (text: string) => extractUciMoveTree(text).moves,
    };
    const allReaders = (text: string) =>
        Object.fromEntries(Object.entries(readers).map(([name, read]) => [name, read(text)]));
    const onlyTheGame = (text: string) =>
        expect(allReaders(text), text).toEqual({ line: ['h2e2', 'h9g7'], tree: ['h2e2', 'h9g7'] });

    it('ends a ; remark at the line ending the file actually uses', () => {
        // A record saved with CR alone -- an old Mac editor, or a paste out of
        // one. Terminating the remark only at LF swallowed the rest of the file
        // into it, and every move after the first comment vanished.
        onlyTheGame('1. h2e2 ; comment\rh9g7 *');
        onlyTheGame('1. h2e2 ; comment\nh9g7 *');
        onlyTheGame('1. h2e2 ; comment\r\nh9g7 *');
    });

    it('keeps the remark itself, wherever the line ended', () => {
        for (const ending of ['\r', '\n', '\r\n']) {
            const read = extractUciMoveTree(`h2e2 ; A note${ending}h9g7 *`);
            expect(read.moveTree[0].comment, JSON.stringify(ending)).toBe('A note');
        }
    });

    it('does not end a header at a ] inside its quoted value', () => {
        // `]` is legal inside a tag value. Ending the tag at the first one left
        // `a3a4"]` behind as movetext, and the game was rejected at the move
        // after it with "not your piece".
        onlyTheGame('[Event "Demo ] a3a4"]\n\n1. h2e2 h9g7 *');
        onlyTheGame('[Event "Demo"]\n\n1. h2e2 h9g7 *');
        expect(extractFenTag('[Event "] a3a4"]\n[FEN "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"]'))
            .toBe('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
    });

    it('still strips a header that is not a well-formed pair', () => {
        // The fallback rule -- everything to the first `]` -- has to stay, or a
        // malformed header's contents start reading as moves.
        onlyTheGame('[Event a3a4]\n\n1. h2e2 h9g7 *');
        onlyTheGame('[a3a4]\n\n1. h2e2 h9g7 *');
    });

    it('ignores a % escape line instead of reading it as moves', () => {
        // The format reserves a line starting with `%` for other software. It
        // was being walked for coordinates, which inserted a move nobody played
        // and rejected the real ones.
        onlyTheGame('% a3a4 is ignored\n[Event "Demo"]\n\n1. h2e2 h9g7 *');
        onlyTheGame('% a3a4 is ignored\r[Event "Demo"]\r\r1. h2e2 h9g7 *');
        onlyTheGame('1. h2e2\n% a3a4 is ignored\nh9g7 *');
    });

    it('does not drop the escape line\'s note as if it were a comment', () => {
        expect(extractUciMoveTree('% Not a comment\nh2e2 *').rootComment).toBeUndefined();
        const around = extractUciMoveTree('h2e2\n% Not a comment\nh9g7 *').moveTree;
        expect(around[0].comment).toBeUndefined();
        expect(around[0].children?.[0].comment).toBeUndefined();
    });

    it('reads a % that is not at the start of a line as ordinary text', () => {
        expect(extractUciMoveLine('h2e2 % h9g7')).toEqual(['h2e2', 'h9g7']);
    });
});

/**
 * A record whose brackets do not balance still gives up its moves.
 *
 * Someone pastes half a game: the copy stopped inside a variation, or a
 * messaging app ate a character. `extractUciMoveTree` finishes with whatever
 * it has, and `recoverFinalMainLine` decides what the main line was --
 * the outermost frame if anything was played there, and otherwise the line it
 * ended on.
 *
 * That second half had no test. The first is the common shape
 * (`h2e2 h9g7 (b0c2`), where the outermost frame holds two moves; the case
 * where the record *opens* with `(` leaves that frame empty, and taking it
 * anyway hands back nothing. Dropping the `.length > 0` check loses every move
 * of such a paste, and the whole suite passed.
 */
describe('a paste with unbalanced brackets keeps its moves', () => {
    const line = (text: string) => extractUciMoveTree(text).moves;

    it('keeps the outer line when a variation is left open inside it', () => {
        expect(line('h2e2 h9g7 (b0c2 b9c7')).toEqual(['h2e2', 'h9g7']);
    });

    it('keeps the moves when the record opens with the bracket', () => {
        // The outermost frame never received a move, so it is the wrong answer
        // even though it exists.
        expect(line('(h2e2 h9g7')).toEqual(['h2e2', 'h9g7']);
        expect(line('((h2e2 h9g7')).toEqual(['h2e2', 'h9g7']);
    });

    it('is not upset by a bracket that closes nothing, or by one alone', () => {
        expect(line(') h2e2 h9g7')).toEqual(['h2e2', 'h9g7']);
        expect(line('(')).toEqual([]);
    });
});

describe('comments after the retained prose limit', () => {
    it('keeps a later root result even when leading prose is full', () => {
        const full = 'x'.repeat(500);
        const parsed = extractUciMoveTree(`{${full}} {Later prose} {[%xqresult 1-0]} h2e2 *`);
        expect(parsed.rootComment).toBe(full);
        expect(parsed.rootResult).toBe('red-wins');
        expect(parsed.moves).toEqual(['h2e2']);
    });

    it('keeps later evaluations and results on a move with a full note', () => {
        const full = 'x'.repeat(500);
        const parsed = extractUciMoveTree(`h2e2 {${full}} {Later prose} {[%eval -.42,18] [%xqresult 0-1]} h9g7 *`);
        expect(parsed.moveTree[0]).toMatchObject({
            comment: full, evalScore: -42, evalDepth: 18, recordedResult: 'black-wins',
        });
        expect(parsed.moves).toEqual(['h2e2', 'h9g7']);
    });

    it('preserves merging at a truncated space or Unicode boundary', () => {
        const prefix = 'x'.repeat(499);
        expect(extractUciMoveTree(`{${prefix} y} {[%eval .1]} h2e2 *`).rootComment).toBe(prefix);
        expect(extractUciMoveTree(`{${prefix} y} {z} h2e2 *`).rootComment).toBe(prefix + ' ');
        expect(extractUciMoveTree(`{${prefix}🐎} {z} h2e2 *`).rootComment).toBe(prefix + ' ');
    });
});

it('reads root-only metadata with the same variation and escape rules as a coordinate record', () => {
    for (const header of ['', '[Event "h0"]\n']) {
        const parsed = extractUciMoveTree(header + '{Root} ({Hidden [%xqresult 0-1]}) ) {End} {[%xqresult 1-0]}\n% ignored\n; Last note\r*');
        expect(parsed).toMatchObject({
            moves: [], moveTree: [], hasVariations: false, tooLarge: false,
            rootComment: 'Root End Last note', rootResult: 'red-wins',
        });
    }
});
