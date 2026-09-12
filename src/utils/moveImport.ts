import { firstPgnGame as firstGameOnly } from './pgnText';
import { MAX_STUDY_LINE_MOVES, MAX_STUDY_TREE_NODES } from './studyLimits';
import { extractPgnHeaders } from './gameMetadata';
import { readRecordedResultPgn, type RecordedResult } from './recordedResult';
import { stripDelimited } from './stripDelimited';
import { parseEvalCommand, parsePgnMoveQuality } from './pgnEvaluation';
import { appendPgnGlyph, normalizeMoveGlyphs, parsePgnGlyph, type MoveGlyphs } from './moveGlyphs';
import { readStudyAnalysisPgn } from './studyAnalysis';
import type { MoveEvaluation } from './moveEvaluation';
import type { SavedMoveTreeNode } from './gameLibrary';
import type { ReviewMoveQuality } from './review';
import { normalizeMoveComment } from './moveComment';

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
    const withoutTags = stripDelimited(firstGameOnly(text).text, '[', ']');
    return stripDelimited(withoutTags, '{', '}').replace(/;.*$/gm, ' ');
}

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
    const cleaned = stripParentheticalVariations(stripPgnMetadata(text));
    let seen = 0;
    for (const _ of cleaned.matchAll(UCI_MOVE_PATTERN)) {
        seen += 1;
        if (seen > MAX_MOVE_IMPORT_UCI_MOVES) return true;
    }
    return false;
}

export function extractUciMoveLine(text: string): string[] {
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
    const delimiters = /[[{;]/g;
    const missingClosers = new Set<string>();
    let cursor = 0;
    for (let delimiter = delimiters.exec(source); delimiter; delimiter = delimiters.exec(source)) {
        const start = delimiter.index;
        const opener = delimiter[0];
        const close = opener === '[' ? ']' : opener === '{' ? '}' : '\n';
        const end = missingClosers.has(close) ? -1 : source.indexOf(close, start + 1);
        if (end < 0 && opener !== ';') {
            // Preserve the coordinate reader's existing incomplete-delimiter
            // recovery without repeatedly scanning the remaining suffix.
            missingClosers.add(close);
            continue;
        }
        for (const match of source.slice(cursor, start).matchAll(UCI_ANNOTATED_TREE_TOKEN_PATTERN)) yield { match };
        if (opener !== '[') yield { comment: source.slice(start + 1, end < 0 ? source.length : end) };
        cursor = end < 0 ? source.length : end + 1;
        delimiters.lastIndex = cursor;
    }
    for (const match of source.slice(cursor).matchAll(UCI_ANNOTATED_TREE_TOKEN_PATTERN)) yield { match };
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
                    const note = parseFreeTextComment(entry.comment);
                    rootComment = normalizeMoveComment([rootComment, note].filter(Boolean).join(' '));
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
            const note = parseFreeTextComment(entry.comment);
            if (note) commentTarget.comment = normalizeMoveComment([commentTarget.comment, note].filter(Boolean).join(' '));
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


/** A move's review as a record carried it, for the moves that had one. */
export interface ImportedMoveAnnotation extends MoveEvaluation, MoveGlyphs {
    /** Red-positive centipawns after the move, as this app stores an eval. */
    evalScore?: number;
    quality?: ReviewMoveQuality;
    /** Whatever prose the comment carried once the commands were taken out. */
    comment?: string;
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

/**
 * The main line *with* whatever each move was annotated with.
 *
 * A separate pass from `extractUciMoveLine`, and it returns the moves as well
 * as the annotations so a caller can check the two agree rather than trusting
 * two parsers to have walked the same line.
 *
 * It has to tokenise rather than strip, and the order matters: `[%eval 0.38]`
 * lives *inside* a `{...}` comment, so stripping `[...]` tags first -- which is
 * what the plain extractor does, and must do, because a FEN tag contains
 * substrings that read as coordinates -- would remove the evaluation along with
 * the headers. Consuming `{` before `[` means a comment is taken whole and the
 * `[` inside it is never seen as a tag.
 *
 * Variations are skipped. An annotation inside one belongs to a move that was
 * not played, and this reports the game.
 */
export function extractAnnotatedMainLine(text: string): {
    moves: string[];
    annotations: ImportedMoveAnnotation[];
} {
    // This one reads the raw text rather than going through stripPgnMetadata,
    // so it needs the same game boundary applied on its own.
    const source = firstGameOnly(String(text)).text;
    const moves: string[] = [];
    const annotations: ImportedMoveAnnotation[] = [];
    let depth = 0;
    let index = 0;

    const annotate = (patch: ImportedMoveAnnotation) => {
        if (depth > 0 || annotations.length === 0) return;
        const current = annotations[annotations.length - 1];
        if (patch.nags) patch.nags = normalizeMoveGlyphs([...(current.nags ?? []), ...patch.nags]);
        if (patch.comment && current.comment) patch.comment = normalizeMoveComment(`${current.comment} ${patch.comment}`);
        Object.assign(current, patch);
    };

    while (index < source.length) {
        const ch = source[index];

        if (ch === '{' || ch === ';') {
            const end = source.indexOf(ch === '{' ? '}' : '\n', index + 1);
            const comment = source.slice(index + 1, end < 0 ? source.length : end);
            const evaluation = parseEvalCommand(comment);
            if (evaluation !== undefined) {
                annotate({ ...evaluation, evalDepth: evaluation.evalDepth, evalScoreKind: evaluation.evalScoreKind });
            }
            const note = parseFreeTextComment(comment);
            if (note) annotate({ comment: note });
            index = end < 0 ? source.length : end + 1;
            continue;
        }
        if (ch === '[') {
            const end = source.indexOf(']', index + 1);
            index = end < 0 ? source.length : end + 1;
            continue;
        }
        if (ch === '(') { depth += 1; index += 1; continue; }
        if (ch === ')') { depth = Math.max(0, depth - 1); index += 1; continue; }
        if (ch === '$') {
            const nag = source.slice(index).match(/^\$\d+/);
            if (nag) {
                const code = parsePgnGlyph(nag[0]);
                if (code !== undefined) annotate({ nags: [code] });
                const quality = parsePgnMoveQuality(nag[0]);
                if (quality) annotate({ quality });
                index += nag[0].length;
                continue;
            }
        }
        if (ch === '?' || ch === '!') {
            const suffix = source.slice(index).match(/^[!?]+/);
            if (suffix) {
                const code = parsePgnGlyph(suffix[0]);
                if (code !== undefined) annotate({ nags: [code] });
                const quality = parsePgnMoveQuality(suffix[0]);
                if (quality) annotate({ quality });
                index += suffix[0].length;
                continue;
            }
        }

        const move = source.slice(index).match(/^([a-i][0-9])\s*(?:->|=>|[-x:\u2192\u2013\u2014])?\s*([a-i][0-9])/i);
        if (move && (index === 0 || !/[a-z0-9]/i.test(source[index - 1]))) {
            const after = source[index + move[0].length];
            if (after === undefined || !/[a-z0-9]/i.test(after)) {
                if (depth === 0) {
                    if (moves.length >= MAX_MOVE_IMPORT_UCI_MOVES) break;
                    moves.push(`${move[1]}${move[2]}`.toLowerCase());
                    annotations.push({});
                }
                index += move[0].length;
                continue;
            }
        }

        index += 1;
    }

    return { moves, annotations };
}

export function extractFenTag(text: string): string | null {
    return extractPgnHeaders(String(text)).fen?.trim().replace(/\s+/g, ' ') || null;
}
