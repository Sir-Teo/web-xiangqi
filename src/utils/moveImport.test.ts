import { describe, expect, it } from 'vitest';
import {
    MAX_MOVE_IMPORT_TEXT_LENGTH,
    MAX_MOVE_IMPORT_TREE_NODES,
    MAX_MOVE_IMPORT_UCI_MOVES,
    extractFenTag,
    extractUciMoveLine,
    extractUciMoveTree,
    isMoveImportTextTooLarge,
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

describe('guarding against a huge paste', () => {
    it('flags text past the limit and passes text under it', () => {
        expect(isMoveImportTextTooLarge('h2e2')).toBe(false);
        expect(isMoveImportTextTooLarge('x'.repeat(MAX_MOVE_IMPORT_TEXT_LENGTH))).toBe(false);
        expect(isMoveImportTextTooLarge('x'.repeat(MAX_MOVE_IMPORT_TEXT_LENGTH + 1))).toBe(true);
    });
});
