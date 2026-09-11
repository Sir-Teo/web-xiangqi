import { extractPgnResult } from './pgnResult';
import { type RecordedResult } from './recordedResult';
import {
    MAX_MOVE_IMPORT_UCI_MOVES,
    extractFenTag,
    extractUciMoveTree,
    isMoveImportTextTooLarge,
    stripRecordMetadata,
} from './moveImport';
import { extractPgnHeaders } from './gameMetadata';
import { normalizeMoveComment } from './moveComment';
import { START_POSITION_FEN } from './xiangqi';
import { parseDhtmlXqRecord } from './dhtmlxq';
import { parseNotationRecord } from './xiangqiNotation';
import type { SavedMoveTreeNode } from './gameLibrary';

/** What the app should do with a pasted record, decided before anything is touched. */
export type MoveLineImportPlan =
    /** A position and nothing played from it. */
    | { kind: 'diagram'; startFen: string; rootComment?: string; rootResult?: RecordedResult }
    /** Nothing usable; `message` is what the reader is told, and why. */
    | { kind: 'error'; message: string }
    | {
        kind: 'line';
        recordedResult?: RecordedResult;
        rootResult?: RecordedResult;
        mainLinePinned?: true;
        rootComment?: string;
        moves: string[];
        startFen: string | undefined;
        moveTree: SavedMoveTreeNode[];
        hasVariations: boolean;
        /** Read from WXF or Chinese rather than from coordinates. */
        importedFromNotation: boolean;
        /** Tokens the notation reader understood as moves and could not place. */
        notationRejected: string[];
        /** The paste held more than one game and only the first was taken. */
        hadMoreGames: boolean;
        /**
         * A DhtmlXQ record's own notes, `[moveNumber, text]`, numbered from
         * one; the starting-position note (zero) is also carried as rootComment.
         * Empty for other formats. Carried as pairs
         * rather than a Map so the plan stays plain data.
         */
        dhtmlComments: [number, string][];
    };

export type ValidationLike = { ok: boolean; failedIndex?: number; move?: string; reason?: string };

export type MoveLineImportValidators = {
    validateMoveSequence: (moves: string[], startFen?: string) => ValidationLike;
    validateMoveTree: (tree: SavedMoveTreeNode[], startFen?: string) => ValidationLike;
};

/**
 * Read a pasted record and decide what it is, without changing anything.
 *
 * The order of the reads is the whole of it, and each step is here because a
 * later one would otherwise claim the record:
 *
 * 1. **Size**, before any parsing, so an enormous paste is refused rather than
 *    walked.
 * 2. **DhtmlXQ** -- the block every dpxq.com game page carries, and the paste a
 *    Chinese player most often has. It holds no coordinates the UCI extractor
 *    knows and no notation the reader knows, so it is read first: its digits
 *    would otherwise be mistaken for either.
 * 3. **Coordinates**, which is what a PGN from this app or any other holds.
 * 4. **Notation** -- WXF or Chinese -- but *only* when no coordinates were
 *    found, so a PGN that happens to carry a Chinese comment is still read as
 *    a PGN rather than re-read as notation.
 *
 * Validation is passed in rather than imported: the rules live in `useXiangqi`
 * with the board state, and this decides what to say about their verdict, not
 * what the verdict is.
 */
export function planMoveLineImport(
    text: string,
    fenInput: string,
    validators: MoveLineImportValidators
): MoveLineImportPlan {
    if (isMoveImportTextTooLarge(text)) {
        return { kind: 'error', message: `Move line is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.` };
    }

    const dhtml = parseDhtmlXqRecord(text);
    const outcome = dhtml ? {} : extractPgnResult(text);
    const source = outcome.source ?? text;
    if (outcome.error) return { kind: 'error', message: outcome.error };
    if (dhtml && dhtml.moves.length === 0 && dhtml.startFen) {
        return { kind: 'diagram', startFen: dhtml.startFen, rootComment: normalizeMoveComment(dhtml.comments.get(0)) };
    }

    const importedLine = dhtml
        ? { moves: dhtml.moves, moveTree: [] as SavedMoveTreeNode[], hasVariations: false, tooLarge: false, hadMoreGames: false, rootComment: undefined, rootResult: undefined }
        : extractUciMoveTree(source);
    const startFen = fenInput.trim() || dhtml?.startFen || extractFenTag(source) || undefined;

    const rootResult = importedLine.rootResult;
    const rootComment = dhtml ? normalizeMoveComment(dhtml.comments.get(0)) : importedLine.rootComment;
    let moves = importedLine.moves;
    let importedFromNotation = false;
    let notationRejected: string[] = [];
    if (moves.length === 0 && !dhtml) {
        const parsed = parseNotationRecord(startFen, stripRecordMetadata(source), MAX_MOVE_IMPORT_UCI_MOVES);
        notationRejected = parsed.rejected;
        if (parsed.moves.length > 0) {
            moves = parsed.moves;
            importedFromNotation = true;
        }
    }

    if (importedLine.tooLarge || moves.length > MAX_MOVE_IMPORT_UCI_MOVES) {
        return { kind: 'error', message: `Move line is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.` };
    }

    const isDiagramText = moves.length === 0 && (dhtml || /^(?:\s*(?:1-0|0-1|1\/2-1\/2|\*))?\s*$/.test(stripRecordMetadata(source)));
    if (moves.length === 0 && notationRejected.length === 0 && isDiagramText && (rootComment || startFen || outcome.result || rootResult)) {
        return { kind: 'diagram', startFen: startFen || START_POSITION_FEN, rootComment, rootResult: outcome.result ?? rootResult };
    }

    if (moves.length === 0) {
        // Telling someone the format is wrong when it was read fine and the
        // *position* is wrong sends them to fix the thing that already works.
        // A record for a handicap or a set-up game reaches here every time.
        return {
            kind: 'error',
            message: notationRejected.length > 0
                ? `Read ${notationRejected[0]} as a move, but it names no legal move in the starting position. If this record does not start from the opening, paste its FEN first.`
                : 'No moves found. Paste coordinates (b2e2 h9g7), WXF (C2=5 H8+7) or Chinese (炮二平五 马8进7).',
        };
    }

    const validation = validators.validateMoveSequence(moves, startFen);
    if (!validation.ok) {
        return {
            kind: 'error',
            message: validation.move
                ? `Move ${(validation.failedIndex ?? 0) + 1} ${validation.move}: ${validation.reason}`
                : String(validation.reason),
        };
    }

    // Variations are a PGN convention. A notation record does not use them, so
    // that path imports the line and says so rather than guessing at a tree.
    const hasVariations = importedLine.hasVariations && !importedFromNotation;
    if (hasVariations) {
        const treeValidation = validators.validateMoveTree(importedLine.moveTree, startFen);
        if (!treeValidation.ok) {
            return {
                kind: 'error',
                message: treeValidation.move
                    ? `Variation ${treeValidation.move}: ${treeValidation.reason}`
                    : String(treeValidation.reason),
            };
        }
    }

    return {
        kind: 'line',
        recordedResult: notationRejected.length ? undefined : outcome.result,
        rootResult,
        ...(extractPgnHeaders(source).xiangqimainline === '1' ? { mainLinePinned: true as const } : {}),
        rootComment,
        moves,
        startFen,
        moveTree: importedLine.moveTree,
        hasVariations,
        importedFromNotation,
        notationRejected,
        hadMoreGames: importedLine.hadMoreGames || Boolean(outcome.hadMoreGames),
        dhtmlComments: dhtml ? Array.from(dhtml.comments.entries()) : [],
    };
}
