import { describe, expect, it } from 'vitest';
import { extractUciMoveTree, extractFenTag, stripRecordMetadata } from './moveImport';
import { parseNotationRecord } from './xiangqiNotation';
import { START_FEN } from './xiangqi';

/**
 * Records as they actually arrive, rather than as they are written by hand.
 *
 * The import box takes a paste, and what people paste comes out of Windows
 * xiangqi software, a database export or a web page: CRLF line endings, a UTF-8
 * byte order mark, full-width punctuation, NAGs, a result token, several games
 * in one file. Every one of these is ordinary in the wild and none of them
 * appear in the hand-written fixtures the other import tests use.
 */

const LINE = ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0b0', 'a9b9'];

const expectLine = (result: { moves?: string[] } | null, label: string) => {
    expect(result, label).toBeTruthy();
    expect(result!.moves, label).toEqual(LINE);
};

describe('a record pasted from somewhere real', () => {
    it('reads a plain UCI line', () => {
        expectLine(extractUciMoveTree(LINE.join(' ')), 'plain');
    });

    it('survives Windows line endings', () => {
        expectLine(extractUciMoveTree(LINE.join('\r\n')), 'CRLF');
    });

    it('survives a UTF-8 byte order mark', () => {
        // What a file saved by Notepad begins with, and it is invisible.
        expectLine(extractUciMoveTree('﻿' + LINE.join(' ')), 'BOM');
    });

    it('survives tabs and runs of blank lines', () => {
        expectLine(extractUciMoveTree(`\t${LINE.slice(0, 2).join('\t')}\n\n\n${LINE.slice(2).join('  ')}\t`), 'whitespace');
    });

    it('ignores PGN tag pairs above the moves', () => {
        const pgn = `[Event "Test"]\r\n[Red "A"]\r\n[Black "B"]\r\n[Result "1-0"]\r\n\r\n${LINE.join(' ')} 1-0\r\n`;
        expectLine(extractUciMoveTree(pgn), 'tags + result');
    });

    it('ignores move numbers, NAGs and comments', () => {
        const pgn = `1. ${LINE[0]} $1 {a note} ${LINE[1]}?! 2. ${LINE[2]} ${LINE[3]} `
            + `3... ${LINE[4]} {[%eval 0.12]} ${LINE[5]}`;
        expectLine(extractUciMoveTree(pgn), 'decorated');
    });

    it('stops at the end of the first game in a multi-game file', () => {
        const other = ['c3c4', 'c6c5'];
        const pgn = `[Event "One"]\n\n${LINE.join(' ')} 1-0\n\n[Event "Two"]\n\n${other.join(' ')} 0-1\n`;
        const result = extractUciMoveTree(pgn);
        expect(result).toBeTruthy();
        expect(result!.moves.slice(0, LINE.length), 'first game').toEqual(LINE);
        expect(result!.moves, 'must not run the second game onto the first').toEqual(LINE);
    });

    it('reads a FEN tag with Windows line endings around it', () => {
        const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
        expect(extractFenTag(`[Event "x"]\r\n[FEN "${fen}"]\r\n\r\n${LINE.join(' ')}`)).toBe(fen);
    });
});

describe('a Chinese record pasted from somewhere real', () => {
    const CHINESE = '炮二平五 马８进７ 马二进三 车九平八';

    it('reads it after the metadata is stripped', () => {
        const parsed = parseNotationRecord(START_FEN, stripRecordMetadata(CHINESE), 1024);
        expect(parsed.moves.length, JSON.stringify(parsed)).toBeGreaterThan(0);
    });

    it('reads the same line with CRLF, a BOM and full-width spaces', () => {
        const plain = parseNotationRecord(START_FEN, stripRecordMetadata(CHINESE), 1024);
        const messy = '﻿' + CHINESE.split(' ').join('\r\n');
        const parsedMessy = parseNotationRecord(START_FEN, stripRecordMetadata(messy), 1024);
        expect(parsedMessy.moves).toEqual(plain.moves);
    });

    it('reads it with move numbers in front, as a database writes them', () => {
        const plain = parseNotationRecord(START_FEN, stripRecordMetadata(CHINESE), 1024);
        const numbered = '1. 炮二平五 马８进７\r\n2. 马二进三 车九平八\r\n';
        const parsedNumbered = parseNotationRecord(START_FEN, stripRecordMetadata(numbered), 1024);
        expect(parsedNumbered.moves).toEqual(plain.moves);
    });
});
