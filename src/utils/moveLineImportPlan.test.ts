import { describe, expect, it } from 'vitest';
import { planMoveLineImport, type MoveLineImportValidators } from './moveLineImportPlan';
import { MAX_MOVE_IMPORT_UCI_MOVES } from './moveImport';
import { DHTMLXQ_START_BINIT } from './dhtmlxq';

/**
 * The planner decides what a paste *is* and what to say about it. Whether a
 * move is legal is the board's job, so the validators are handed in — stubbed
 * here so a phrasing test cannot fail because the rules changed, with two
 * cases using rejections shaped like the real ones.
 */
const accepts: MoveLineImportValidators = {
    validateMoveSequence: () => ({ ok: true }),
    validateMoveTree: () => ({ ok: true }),
};
const rejectsAt = (failedIndex: number, move: string, reason: string): MoveLineImportValidators => ({
    validateMoveSequence: () => ({ ok: false, failedIndex, move, reason }),
    validateMoveTree: () => ({ ok: true }),
});

const plan = (text: string, fen = '', validators = accepts) => planMoveLineImport(text, fen, validators);

describe('planning an import', () => {
    it('accepts game details before the first move without accepting invalid move text', () => {
        expect(plan('[White "Alice"]\n[Event "Autumn Invitational"]\n\n*').kind).toBe('diagram');
        expect(plan('[Event "  "]\n\n*').kind).toBe('error');
        expect(plan('[Event "Autumn Invitational"]\n\nnot a game').kind).toBe('error');
        expect(plan('[Event "Autumn Invitational"]\n\nC5=9').kind).toBe('error');
    });
    it('reads plain coordinates', () => {
        const result = plan('h2e2 h9g7 b0c2');
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.moves).toEqual(['h2e2', 'h9g7', 'b0c2']);
        expect(result.importedFromNotation).toBe(false);
        expect(result.hasVariations).toBe(false);
    });

    it('reads a record written in WXF', () => {
        const result = plan('1. C2=5 H8+7 2. H2+3');
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.importedFromNotation).toBe(true);
        expect(result.moves[0]).toBe('h2e2');
    });

    it('reads a record written in Chinese', () => {
        const result = plan('1. 炮二平五 马8进7');
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.importedFromNotation).toBe(true);
        expect(result.moves[0]).toBe('h2e2');
    });

    it('still reads a PGN as a PGN when it happens to carry a Chinese comment', () => {
        // The notation reader runs only when no coordinates were found. If it
        // ran anyway it would re-read the comment and import a different game.
        const result = plan('1. h2e2 {炮二平五 is the central cannon} h9g7');
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.importedFromNotation).toBe(false);
        expect(result.moves).toEqual(['h2e2', 'h9g7']);
    });

    it('keeps the variations a PGN carries, and reports them', () => {
        const result = plan('1. h2e2 (1. b0c2 h9g7) h9g7 2. b0c2');
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.hasVariations).toBe(true);
        expect(result.moveTree.length).toBeGreaterThan(0);
    });

    it('never claims variations from a notation record, which has no way to write them', () => {
        const result = plan('1. C2=5 H8+7');
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.hasVariations).toBe(false);
    });

    it('takes the FEN the reader typed over the one in the record', () => {
        const withTag = '[FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"]\n1. h2e2';
        // Off the e-file: on it the two generals face each other, which is not
        // a position a game can start from and is now refused here.
        const typed = '3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1';
        const result = plan(withTag, typed);
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.startFen).toBe(typed);
    });
});

describe('what the reader is told when it will not import', () => {
    /**
     * The position a record starts from is checked here, before its moves are,
     * and it is checked on both paths. A `[FEN "..."]` header with no moves
     * after it used to come back as a `diagram` plan carrying an unusable FEN:
     * the caller then refused it and set the error belonging to the FEN field,
     * so a record pasted into the move box was rejected under a different box,
     * and one imported from a file with no dialog open said nothing at all.
     */
    it('refuses a record whose own FEN cannot start a game, and says which part', () => {
        for (const [fen, expected] of [
            ['not a position at all', /piece layout is unreadable/],
            ['3k5/9/9/9/9/9/9/9/9/4KR3 x - - 0 1', /side to move must be "w" or "b"/],
            ['3k5/9/9/9/9/9/9/9/9/3K5 w - - 0 1', /generals face each other/],
            ['3k5/9/9/9/9/9/1P7/9/9/4K4 w - - 0 1', /must be on its starting file/],
        ] as const) {
            // No moves: the diagram path, which had no check at all.
            const diagram = plan(`[FEN "${fen}"]`);
            expect(diagram.kind, fen).toBe('error');
            if (diagram.kind !== 'error') continue;
            expect(diagram.message, fen).toMatch(/^This record's FEN cannot start a game\./);
            expect(diagram.message, fen).toMatch(expected);

            // And with moves, where the validator used to answer "Invalid
            // start FEN" a step later.
            const line = plan(`[FEN "${fen}"]\n1. h2e2`);
            expect(line.kind, fen).toBe('error');
            if (line.kind !== 'error') continue;
            expect(line.message, fen).toMatch(expected);
        }
    });

    it('blames the field the reader filled when that is where the FEN came from', () => {
        const result = plan('1. h2e2', '3k5/9/9/9/9/9/9/9/9/3K5 w - - 0 1');
        expect(result.kind).toBe('error');
        if (result.kind !== 'error') return;
        expect(result.message).toMatch(/^The FEN above cannot start a game\. .*generals face each other/);
    });

    it('still takes a record with a FEN that is fine', () => {
        const ok = plan('[FEN "3k5/9/9/9/9/9/9/9/9/4KR3 w - - 0 1"]');
        expect(ok.kind).toBe('diagram');
        if (ok.kind !== 'diagram') return;
        expect(ok.startFen).toBe('3k5/9/9/9/9/9/9/9/9/4KR3 w - - 0 1');
    });

    it('refuses a paste too large to walk, and names the limit', () => {
        const huge = 'h2e2 '.repeat(60_000);
        const result = plan(huge);
        expect(result.kind).toBe('error');
        if (result.kind !== 'error') return;
        expect(result.message).toContain(String(MAX_MOVE_IMPORT_UCI_MOVES));
    });

    it('refuses a line longer than the cap', () => {
        const long = Array.from({ length: MAX_MOVE_IMPORT_UCI_MOVES + 40 }, () => 'h2e2').join(' ');
        const result = plan(long);
        expect(result.kind).toBe('error');
        if (result.kind !== 'error') return;
        expect(result.message).toContain('too large');
    });

    it('names the three formats it accepts when it found no moves at all', () => {
        const result = plan('this is not a game record');
        expect(result.kind).toBe('error');
        if (result.kind !== 'error') return;
        expect(result.message).toContain('b2e2');
        expect(result.message).toContain('C2=5');
        expect(result.message).toContain('炮二平五');
    });

    it('sends a reader to the FEN box, not the format docs, when the moves read but the position is wrong', () => {
        // A handicap or set-up game reaches here every time: the notation was
        // understood, it just names nothing legal from the opening array.
        const result = plan('1. C2+5');
        expect(result.kind).toBe('error');
        if (result.kind !== 'error') return;
        expect(result.message).toContain('paste its FEN first');
        expect(result.message).not.toContain('No moves found');
    });

    it('counts the failing move from one, the way the record is numbered', () => {
        const result = plan('h2e2 h9g7 a0a9', '', rejectsAt(2, 'a0a9', 'rook path blocked'));
        expect(result.kind).toBe('error');
        if (result.kind !== 'error') return;
        expect(result.message).toBe('Move 3 a0a9: rook path blocked');
    });

    it('gives the reason alone when the failure names no move', () => {
        const bad: MoveLineImportValidators = {
            validateMoveSequence: () => ({ ok: false, failedIndex: 0, move: '', reason: 'Invalid start FEN' }),
            validateMoveTree: () => ({ ok: true }),
        };
        const result = plan('h2e2', '', bad);
        expect(result.kind).toBe('error');
        if (result.kind !== 'error') return;
        expect(result.message).toBe('Invalid start FEN');
    });

    it('says a variation is the problem when it is the variation that fails', () => {
        const badTree: MoveLineImportValidators = {
            validateMoveSequence: () => ({ ok: true }),
            validateMoveTree: () => ({ ok: false, move: 'a0a9', reason: 'rook path blocked' }),
        };
        const result = plan('1. h2e2 (1. a0a9) h9g7', '', badTree);
        expect(result.kind).toBe('error');
        if (result.kind !== 'error') return;
        expect(result.message).toBe('Variation a0a9: rook path blocked');
    });

    it('does not consult the tree validator when the record has no variations', () => {
        let asked = false;
        const watching: MoveLineImportValidators = {
            validateMoveSequence: () => ({ ok: true }),
            validateMoveTree: () => { asked = true; return { ok: false, reason: 'should not be asked' }; },
        };
        expect(plan('h2e2 h9g7', '', watching).kind).toBe('line');
        expect(asked).toBe(false);
    });
});

describe('a Chinese record whose non-move text reads as moves', () => {
    // The notation reader only runs when no coordinates were found, and it is
    // handed `stripRecordMetadata(source)`. Anything that scanner fails to take
    // out reaches it as notation -- and a `%` escape line or a `;` remark can
    // hold a real Chinese move, so the failure is not a stray token but a
    // different game, imported without a word.
    const GAME = '1. \u70ae\u4e8c\u5e73\u4e94 \u9a6c8\u8fdb7 2. \u9a6c\u4e8c\u8fdb\u4e09 \u8f669\u5e738';
    const PLAYED = ['h2e2', 'h9g7', 'h0g2', 'i9h9'];

    it('reads the game itself, so the cases below mean something', () => {
        expect(plan(GAME)).toMatchObject({ kind: 'line', moves: PLAYED, importedFromNotation: true });
    });

    it('ignores a % escape line even when it holds a legal Chinese move', () => {
        // Read as notation, this line used to turn the record into
        // ['b0c2', 'b7e7'] -- not the game on the page, and no error either.
        for (const ending of ['\n', '\r', '\r\n']) {
            expect(plan(`% \u9a6c8\u8fdb7 \u5ffd\u7565${ending}${GAME}`), JSON.stringify(ending))
                .toMatchObject({ kind: 'line', moves: PLAYED });
        }
    });

    it('ends a ; remark at the line ending even when it holds a legal Chinese move', () => {
        for (const ending of ['\n', '\r', '\r\n']) {
            const source = `1. \u70ae\u4e8c\u5e73\u4e94 ; \u9a6c8\u8fdb7 \u6ce8${ending}\u9a6c8\u8fdb7 2. \u9a6c\u4e8c\u8fdb\u4e09 \u8f669\u5e738`;
            expect(plan(source), JSON.stringify(ending)).toMatchObject({ kind: 'line', moves: PLAYED });
        }
    });
});

describe('a DhtmlXQ record, which is read before anything else', () => {
    // Its digits look like coordinates to one reader and like notation to the
    // other, so whichever ran first would claim it and import a different game.
    const wrap = (...parts: string[]) => ['[DhtmlXQ]', ...parts, '[/DhtmlXQ]'].join('\n');

    /** A set-up position: two generals and a chariot each, nothing else. */
    const customBinit = (() => {
        const digits = Array(32).fill('99');
        digits[0] = '89';   // red chariot i0
        digits[4] = '49';   // red general e0
        digits[16] = '00';  // black chariot a9
        digits[20] = '30';  // black general d9, off Red's file
        return digits.join('');
    })();

    it('is a diagram when it carries a set-up position and no moves', () => {
        const result = plan(wrap(`[DhtmlXQ_binit]${customBinit}[/DhtmlXQ_binit]`));
        expect(result.kind).toBe('diagram');
        if (result.kind !== 'diagram') return;
        expect(result.startFen).toMatch(/ w - - 0 1$/);
    });

    it('is not a diagram when the position is just the opening array', () => {
        // A block saying "standard position, no moves" carries nothing to load.
        const result = plan(wrap(`[DhtmlXQ_binit]${DHTMLXQ_START_BINIT}[/DhtmlXQ_binit]`));
        expect(result.kind).toBe('error');
    });

    it('carries its own notes across, numbered from the move they sit on', () => {
        const result = plan(wrap(
            `[DhtmlXQ_binit]${DHTMLXQ_START_BINIT}[/DhtmlXQ_binit]`,
            '[DhtmlXQ_movelist]7747[/DhtmlXQ_movelist]',
            '[DhtmlXQ_comment1]The central cannon.[/DhtmlXQ_comment1]',
        ));
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.dhtmlComments).toEqual([[1, 'The central cannon.']]);
        expect(result.importedFromNotation).toBe(false);
    });

    it('leaves the notes empty for every other kind of record', () => {
        const result = plan('h2e2 h9g7');
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.dhtmlComments).toEqual([]);
    });
});

describe('a paste holding more than one game', () => {
    it('says so, so the caller can offer the collection importer', () => {
        const two = '[Event "A"]\n1. h2e2 h9g7 *\n\n[Event "B"]\n1. b0c2 b9c7 *\n';
        const result = plan(two);
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.hadMoreGames).toBe(true);
        expect(result.moves).toEqual(['h2e2', 'h9g7']);
    });

    it('says nothing of the sort for a single game', () => {
        const result = plan('[Event "A"]\n1. h2e2 h9g7 *\n');
        expect(result.kind).toBe('line');
        if (result.kind !== 'line') return;
        expect(result.hadMoreGames).toBe(false);
    });
});

describe('the plan touches nothing', () => {
    it('is decided from the text alone, so the same paste plans the same way twice', () => {
        const text = '1. h2e2 h9g7 2. b0c2 b9c7';
        expect(JSON.stringify(plan(text))).toBe(JSON.stringify(plan(text)));
    });
});
