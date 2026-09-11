import { stripDelimited } from './stripDelimited';
import { evaluationKindOverride } from './engineEvalReading';
import { readStudyAnalysisPgn } from './studyAnalysis';
import { normalizeEvalDepth, type MoveEvaluation } from './moveEvaluation';
import type { SavedMoveTreeNode } from './gameLibrary';
import type { ReviewMoveQuality } from './review';
import { MATE_SCORE_BASE } from './engineEvalReading';
import { normalizeMoveComment } from './moveComment';

export const MAX_MOVE_IMPORT_TEXT_LENGTH = 200_000;
export const MAX_MOVE_IMPORT_UCI_MOVES = 1024;
export const MAX_MOVE_IMPORT_TREE_NODES = 1024;

function stripParentheticalVariations(text: string): string {
    let depth = 0;
    let result = '';

    for (const char of text) {
        if (char === '(') {
            depth += 1;
            result += ' ';
            continue;
        }
        if (char === ')' && depth > 0) {
            depth -= 1;
            result += ' ';
            continue;
        }
        if (depth === 0) {
            result += char;
        }
    }

    return result;
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

/** A tag pair on its own line, which is how a PGN game announces itself. */
const PGN_TAG_LINE = /^\s*\[\s*[A-Za-z][A-Za-z0-9_]*\s+"/;
/** The token a PGN game ends with. */
const PGN_RESULT_LINE = /(?:^|\s)(?:1-0|0-1|1\/2-1\/2|\*)\s*$/;

/**
 * The first game in the text, and nothing after it.
 *
 * A file exported from a database holds many games, and pasting one used to
 * produce a single run-on game: `stripPgnMetadata` erases `[...]` tags outright,
 * so the second game's header vanished and its moves carried straight on from
 * the first game's last position. What the player saw depended on whether those
 * moves happened to be legal there -- a few junk moves appended if they were,
 * and a silent truncation at the first illegal one if they were not. Neither
 * says anything went wrong.
 *
 * A game ends at a result token, or where the next one's tag pairs begin. The
 * scan is line-based and skips anything inside a `{...}` comment, so a comment
 * containing a bracket or the word `1-0` cannot end the game early.
 */
function firstGameOnly(text: string): { text: string; truncated: boolean } {
    const lines = String(text).split(/\r?\n/);
    const kept: string[] = [];
    let seenMoveText = false;
    let braceDepth = 0;

    for (const line of lines) {
        const insideComment = braceDepth > 0;
        const opened = (line.match(/\{/g) ?? []).length;
        const closed = (line.match(/\}/g) ?? []).length;

        if (!insideComment && PGN_TAG_LINE.test(line)) {
            // Tags before any moves are this game's own header; tags after them
            // belong to the next game.
            if (seenMoveText) return { text: kept.join('\n'), truncated: true };
            kept.push(line);
            braceDepth = Math.max(0, braceDepth + opened - closed);
            continue;
        }

        kept.push(line);
        braceDepth = Math.max(0, braceDepth + opened - closed);

        if (!insideComment && line.trim()) {
            seenMoveText = true;
            if (PGN_RESULT_LINE.test(line)) {
                // A result ends this game; anything after it is another one.
                const rest = lines.slice(kept.length).join('').trim();
                return { text: kept.join('\n'), truncated: rest.length > 0 };
            }
        }
    }

    return { text: kept.join('\n'), truncated: false };
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

    for (const entry of uciTreeTokens(firstGame.text)) {
        if ('comment' in entry) {
            if (!commentTarget) continue;
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
            const quality = QUALITY_FOR_NAG[token] ?? QUALITY_FOR_SUFFIX[token];
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
        if (nodeCount >= MAX_MOVE_IMPORT_TREE_NODES) {
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
        currentLine = [...currentLine, node];
    }

    return {
        moves: mainLineFromTree(recoverFinalMainLine(currentLine, stack)),
        moveTree: root,
        hasVariations: root.length > 1 || hasBranch(root),
        tooLarge,
        hadMoreGames: firstGame.truncated,
    };
}


/** A move's review as a record carried it, for the moves that had one. */
export interface ImportedMoveAnnotation extends MoveEvaluation {
    /** Red-positive centipawns after the move, as this app stores an eval. */
    evalScore?: number;
    quality?: ReviewMoveQuality;
    /** Whatever prose the comment carried once the commands were taken out. */
    comment?: string;
}

/**
 * The standard glyphs, read back. `formatEvalCommand`'s counterparts live in
 * `pgnAnnotations.ts`; only the three this app writes are mapped, because the
 * rest of the NAG table is not a quality scale -- $3 is "very good move" and
 * $5 is "interesting", and guessing at a grade for them would put a label on a
 * move nobody graded.
 */
const QUALITY_FOR_NAG: Record<string, ReviewMoveQuality> = {
    $6: 'inaccuracy',
    $2: 'mistake',
    $4: 'blunder',
};

/** The same three as suffix symbols, which many records use instead. */
const QUALITY_FOR_SUFFIX: Record<string, ReviewMoveQuality> = {
    '?!': 'inaccuracy',
    '?': 'mistake',
    '??': 'blunder',
};

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

function parseEvalCommand(comment: string): Pick<MoveEvaluation, 'evalScore' | 'evalDepth' | 'evalScoreKind'> | undefined {
    // python-chess also writes a comma-separated depth and accepts signed
    // decimal shorthand. The depth is not a score and must not prevent the
    // evaluation from being read. Walk in source order across both score kinds.
    const commands = /\[%eval\s+(?:#([+-]?\d+)|([+-]?(?:\d+(?:\.\d*)?|\.\d+)))(?:,(\d+))?\s*\]/gi;
    for (const match of comment.matchAll(commands)) {
        const evalDepth = match[3] === undefined ? undefined : normalizeEvalDepth(Number(match[3]));
        const depth = evalDepth === undefined ? {} : { evalDepth };
        if (match[1] !== undefined) {
            const distance = Math.abs(Number(match[1]));
            // Larger distances cannot fit this app's existing mate sentinel.
            // In particular, subtracting an arbitrary distance can flip sides.
            if (!Number.isSafeInteger(distance) || distance > MATE_SCORE_BASE / 2) continue;
            return { evalScore: match[1].startsWith('-') ? -(MATE_SCORE_BASE - distance) : MATE_SCORE_BASE - distance, ...depth };
        }
        const score = Math.round(Number(match[2]) * 100);
        if (Number.isSafeInteger(score)) {
            const evalScoreKind = evaluationKindOverride(score, 'cp');
            return { evalScore: score, ...depth, ...(evalScoreKind ? { evalScoreKind } : {}) };
        }
    }
    return undefined;
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
                const quality = QUALITY_FOR_NAG[nag[0]];
                if (quality) annotate({ quality });
                index += nag[0].length;
                continue;
            }
        }
        if (ch === '?' || ch === '!') {
            const suffix = source.slice(index).match(/^(\?\?|\?!|\?)/);
            if (suffix) {
                const quality = QUALITY_FOR_SUFFIX[suffix[0]];
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
    const match = String(text).match(/\[\s*FEN\s+"((?:\\.|[^"\\])*)"\s*]/i);
    if (!match) return null;
    return match[1]
        .replace(/\\(["\\])/g, '$1')
        .trim()
        .replace(/\s+/g, ' ') || null;
}
