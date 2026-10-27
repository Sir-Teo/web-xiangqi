import { firstPgnGame as firstGameOnly, pgnMetadataSpans } from './pgnText';
import { MAX_STUDY_LINE_MOVES, MAX_STUDY_TREE_NODES } from './studyLimits';
import { extractPgnHeaders } from './gameMetadata';
import { readRecordedResultPgn, type RecordedResult } from './recordedResult';
import { stripDelimited } from './stripDelimited';
import { parseEvalCommand, parsePgnMoveQuality } from './pgnEvaluation';
import { appendPgnGlyph } from './moveGlyphs';
import { readStudyAnalysisPgn } from './studyAnalysis';
import type { SavedMoveTreeNode } from './gameLibrary';
import { MAX_MOVE_COMMENT_LENGTH, normalizeMoveComment } from './moveComment';

export const MAX_MOVE_IMPORT_TEXT_LENGTH = 200_000;
export const MAX_MOVE_IMPORT_UCI_MOVES = MAX_STUDY_LINE_MOVES;
export const MAX_MOVE_IMPORT_TREE_NODES = MAX_STUDY_TREE_NODES;

function stripParentheticalVariations(text: string): string {
    if (!text.includes('(')) return text;
    let depth = 0;
    let start = 0;
    let result = '';
    // Copy unchanged ranges; visiting every character built large temporary
    // strings even for plain coordinate records and unrelated pasted text.
    for (const match of text.matchAll(/[()]/g)) {
        if (match[0] === '(') {
            if (depth === 0) result += text.slice(start, match.index);
            depth += 1;
            result += ' ';
        } else if (depth > 0) {
            depth -= 1;
            result += ' ';
            if (depth === 0) start = match.index + 1;
        }
    }
    return depth === 0 ? result + text.slice(start) : result;
}

/**
 * Tags, comments and semicolon remarks removed, so what is left is moves.
 *
 * Exported because the notation importer needs the same treatment: a Chinese
 * record pasted from a database carries the same `[Event "..."]` header and
 * `{...}` annotations as a PGN, and a comment word must not be offered to the
 * move parser.
 */
export function stripRecordMetadata(text: string): string {
    return stripPgnMetadata(text);
}

function stripPgnMetadata(text: string): string {
    const source = firstGameOnly(text).text;
    let out = '';
    let cursor = 0;
    for (const span of pgnMetadataSpans(source)) {
        out += source.slice(cursor, span.start) + ' ';
        cursor = span.end;
    }
    return cursor === 0 ? source : out + source.slice(cursor);
}

const UCI_SQUARE_PATTERN = /[a-i][0-9]/i;
const UCI_MOVE_PATTERN = /\b([a-i][0-9])([a-i][0-9])\b|\b([a-i][0-9])\s*(?:->|=>|[-x:→–—])\s*([a-i][0-9])\b/gi;
const UCI_TREE_TOKEN_PATTERN = /\(|\)|\b([a-i][0-9])([a-i][0-9])\b|\b([a-i][0-9])\s*(?:->|=>|[-x:→–—])\s*([a-i][0-9])\b/gi;
const UCI_ANNOTATED_TREE_TOKEN_PATTERN = new RegExp(`${UCI_TREE_TOKEN_PATTERN.source}|\\$\\d+|[!?]+`, 'gi');

function hasBranch(nodes: SavedMoveTreeNode[]): boolean {
    return nodes.some((node) => (node.children?.length ?? 0) > 1 || hasBranch(node.children ?? []));
}

function mainLineFromTree(line: SavedMoveTreeNode[]): string[] {
    return line.map((node) => node.uci);
}

function recoverFinalMainLine(currentLine: SavedMoveTreeNode[], stack: SavedMoveTreeNode[][]): SavedMoveTreeNode[] {
    if (stack.length === 0) return currentLine;
    return stack[0].length > 0 ? stack[0] : currentLine;
}

export function isMoveImportTextTooLarge(text: string): boolean {
    return String(text).length > MAX_MOVE_IMPORT_TEXT_LENGTH;
}

/**
 * Whether the text holds more moves than a line may carry.
 *
 * `extractUciMoveLine` stops at the cap so what it returns is always short
 * enough to save, which means its length can no longer signal an oversized
 * source — a caller checking `length > MAX` would never fire. Callers that
 * must *reject* rather than truncate ask here instead. Mirrors the `tooLarge`
 * flag `extractUciMoveTree` already returns.
 */
export function hasTooManyUciMoves(text: string): boolean {
    // A coordinate move requires a square. Skip metadata/variation allocation
    // for unrelated text and notation records that contain none.
    if (!UCI_SQUARE_PATTERN.test(text)) return false;
    const cleaned = stripParentheticalVariations(stripPgnMetadata(text));
    let seen = 0;
    for (const _ of cleaned.matchAll(UCI_MOVE_PATTERN)) {
        seen += 1;
        if (seen > MAX_MOVE_IMPORT_UCI_MOVES) return true;
    }
    return false;
}

export function extractUciMoveLine(text: string): string[] {
    if (!UCI_SQUARE_PATTERN.test(text)) return [];
    const cleaned = stripParentheticalVariations(stripPgnMetadata(text));
    const moves: string[] = [];
    for (const match of cleaned.matchAll(UCI_MOVE_PATTERN)) {
        // Checked before the push, the way extractUciMoveTree does it. Testing
        // after meant returning one move past the cap, and the library refuses
        // a line longer than the cap — so the longest importable game could not
        // then be saved.
        if (moves.length >= MAX_MOVE_IMPORT_UCI_MOVES) break;
        const from = match[1] ?? match[3];
        const to = match[2] ?? match[4];
        moves.push(`${from}${to}`.toLowerCase());
    }
    return moves;
}

/** Read comments separately so their parentheses/coordinates cannot become moves. */
function* uciTreeTokens(source: string): Generator<{ comment: string } | { match: RegExpMatchArray }> {
    let cursor = 0;
    for (const span of pgnMetadataSpans(source)) {
        const gap = source.slice(cursor, span.start);
        // Metadata-only lines have no move tokens between their spans. Avoid
        // creating a regex iterator for every empty remark or escape line.
        if (gap.trim()) for (const match of gap.matchAll(UCI_ANNOTATED_TREE_TOKEN_PATTERN)) yield { match };
        // Empty remarks carry neither annotations nor prose. Avoid running the
        // annotation readers for every blank line in comment-heavy records.
        if (span.comment?.trim()) yield { comment: span.comment };
        cursor = span.end;
    }
    for (const match of source.slice(cursor).matchAll(UCI_ANNOTATED_TREE_TOKEN_PATTERN)) yield { match };
}

/** Later prose cannot alter a full normalized prefix. A truncated trailing
 * space still needs the ordinary merge, which can trim it away. */
function hasFullComment(comment: string | undefined): boolean {
    return comment?.length === MAX_MOVE_COMMENT_LENGTH && !comment.endsWith(' ');
}

/** With no coordinate squares, only top-level notes and results can survive.
 * Track parentheses between metadata spans without allocating move tokens or
 * variation paths for every fragment of an unrelated paste. */
function readRootOnlyMetadata(source: string): { rootComment?: string; rootResult?: RecordedResult } {
    let depth = 0;
    let cursor = 0;
    let rootComment: string | undefined;
    let rootResult: RecordedResult | undefined;
    for (const span of pgnMetadataSpans(source)) {
        for (let index = cursor; index < span.start; index++) {
            if (source[index] === '(') depth++;
            else if (source[index] === ')') depth = Math.max(0, depth - 1);
        }
        cursor = span.end;
        if (depth || !span.comment?.trim()) continue;
        rootResult = readRecordedResultPgn(span.comment) ?? rootResult;
        if (!hasFullComment(rootComment)) {
            const note = parseFreeTextComment(span.comment);
            rootComment = normalizeMoveComment([rootComment, note].filter(Boolean).join(' '));
        }
    }
    return { ...(rootComment ? { rootComment } : {}), ...(rootResult ? { rootResult } : {}) };
}

export function extractUciMoveTree(text: string): {
    rootResult?: RecordedResult;
    rootComment?: string;
    moves: string[];
    moveTree: SavedMoveTreeNode[];
    hasVariations: boolean;
    tooLarge: boolean;
    /** The paste held more than one game and only the first was read. */
    hadMoreGames: boolean;
} {
    const firstGame = firstGameOnly(text);
    if (!UCI_SQUARE_PATTERN.test(firstGame.text)) {
        return { moves: [], moveTree: [], hasVariations: false, tooLarge: false,
            hadMoreGames: firstGame.truncated, ...readRootOnlyMetadata(firstGame.text) };
    }
    const root: SavedMoveTreeNode[] = [];
    const stack: SavedMoveTreeNode[][] = [];
    let currentLine: SavedMoveTreeNode[] = [];
    let nodeCount = 0;
    let tooLarge = false;
    let commentTarget: SavedMoveTreeNode | undefined;
    let rootComment: string | undefined;
    let rootResult: RecordedResult | undefined;

    for (const entry of uciTreeTokens(firstGame.text)) {
        if ('comment' in entry) {
            if (!commentTarget) {
                if (nodeCount === 0 && stack.length === 0) {
                    rootResult = readRecordedResultPgn(entry.comment) ?? rootResult;
                    if (!hasFullComment(rootComment)) {
                        const note = parseFreeTextComment(entry.comment);
                        rootComment = normalizeMoveComment([rootComment, note].filter(Boolean).join(' '));
                    }
                }
                continue;
            }
            const recordedResult = readRecordedResultPgn(entry.comment);
            if (recordedResult) commentTarget.recordedResult = recordedResult;
            const snapshot = readStudyAnalysisPgn(entry.comment);
            if (snapshot?.move === commentTarget.uci) commentTarget.analysis = snapshot;
            const evaluation = parseEvalCommand(entry.comment);
            if (evaluation) {
                commentTarget.evalScore = evaluation.evalScore;
                commentTarget.evalDepth = evaluation.evalDepth;
                commentTarget.evalScoreKind = evaluation.evalScoreKind;
            }
            if (!hasFullComment(commentTarget.comment)) {
                const note = parseFreeTextComment(entry.comment);
                if (note) commentTarget.comment = normalizeMoveComment([commentTarget.comment, note].filter(Boolean).join(' '));
            }
            continue;
        }
        const match = entry.match;
        const token = match[0];
        if (token.startsWith('$') || /^[!?]+$/.test(token)) {
            if (commentTarget) appendPgnGlyph(commentTarget, token);
            const quality = parsePgnMoveQuality(token);
            if (quality && commentTarget) commentTarget.quality = quality;
            continue;
        }
        if (token === '(') {
            stack.push(currentLine);
            currentLine = currentLine.slice(0, -1);
            commentTarget = undefined;
            continue;
        }
        if (token === ')') {
            currentLine = stack.pop() ?? currentLine;
            commentTarget = currentLine[currentLine.length - 1];
            continue;
        }

        const from = match[1] ?? match[3];
        const to = match[2] ?? match[4];
        if (!from || !to) continue;
        if (nodeCount >= MAX_MOVE_IMPORT_TREE_NODES || currentLine.length >= MAX_MOVE_IMPORT_UCI_MOVES) {
            tooLarge = true;
            break;
        }

        nodeCount += 1;
        const node: SavedMoveTreeNode = { uci: `${from}${to}`.toLowerCase() };
        commentTarget = node;
        const parent = currentLine[currentLine.length - 1];
        if (parent) {
            if (!parent.children) parent.children = [];
            parent.children.push(node);
        } else {
            root.push(node);
        }
        // Entering a variation already copies the path. Appending here owns
        // this array, so a straight line needs no growing per-move copies.
        currentLine.push(node);
    }

    return {
        moves: mainLineFromTree(recoverFinalMainLine(currentLine, stack)),
        moveTree: root,
        hasVariations: root.length > 1 || hasBranch(root),
        tooLarge,
        hadMoreGames: firstGame.truncated,
        ...(rootComment ? { rootComment } : {}),
        ...(rootResult ? { rootResult } : {}),
    };
}


/**
 * The prose left in a PGN comment once the machine-readable parts are removed.
 *
 * A comment written by this app reads `{ [%eval 0.42] Better was b2e2 Note }`,
 * and the note is the only part a person wrote. Bracketed `[%...]` commands go
 * first -- there are more of them in the wild than this app writes, and none
 * are prose -- then the "Better was <move>" the exporter adds, then anything
 * left is the note.
 *
 * A comment carrying only commands leaves nothing, which is the common case and
 * has to produce no note rather than an empty one.
 */
function parseFreeTextComment(comment: string): string | undefined {
    // An unclosed command repeated through a large note makes a greedy
    // bracket regex rescan the suffix at every opener. Scan each run once.
    const prose = stripDelimited(comment, '[%', ']')
        .replace(/\bBetter was\s+[a-i][0-9][a-i][0-9]\b/gi, ' ');
    return normalizeMoveComment(prose);
}

export function extractFenTag(text: string): string | null {
    return extractPgnHeaders(String(text)).fen?.trim().replace(/\s+/g, ' ') || null;
}
