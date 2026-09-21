import { parseResultTag, readRecordedResultPgn, type RecordedResult } from './recordedResult';
import { MAX_STUDY_LINE_MOVES, MAX_STUDY_TREE_NODES } from './studyLimits';
import { stripDelimited } from './stripDelimited';
import { atPgnLineStart, pgnLineEnd } from './pgnText';
import { extractPgnEvalCommands, parsePgnMoveQuality } from './pgnEvaluation';
import { appendPgnGlyph } from './moveGlyphs';
import { readStudyAnalysisPgn } from './studyAnalysis';
import { normalizeSavedGame, type SavedGame, type SavedMoveTreeNode, MAX_SAVED_GAMES } from './gameLibrary';
import { extractPgnMetadata } from './gameMetadata';
import { MAX_MOVE_COMMENT_LENGTH, normalizeMoveComment } from './moveComment';
import { describeFenProblem } from './positionSetup';
import { START_FEN, parseFenBoard, validateMoveStr, type BoardState, type Side } from './xiangqi';

// Encoded snapshot histories can make a supported study several MB of PGN.
// Parsing runs in a cancellable worker; per-game move/tree bounds still apply.
export const MAX_COLLECTION_TEXT_LENGTH = 8_000_000;
export const COLLECTION_SIZE_ERROR = 'Collection exceeds 8,000,000 characters. Split it into smaller files.';
export type CollectionGame = Omit<SavedGame, 'id' | 'savedAt'>;
type Token = { kind: 'tag' | 'comment' | 'symbol'; value: string };
const RESULTS: Record<string, SavedGame['result']> = { '1-0': 'red', '0-1': 'black', '1/2-1/2': 'draw', '*': 'ongoing' };

/** Sticky, exhaustive scanning: unknown movetext is rejected, never skipped. */
function* tokens(text: string): Generator<Token> {
    const tag = /\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"(?:\\.|[^"\\])*"\s*\]/y;
    const symbol = /(?:1\/2-1\/2|1-0|0-1|\*|\d+\.+|\$\d+|[!?]+|[()]|[^\s{}[\]();!?$*]+)/y;
    let i = 0;
    while (i < text.length) {
        if (/\s|\uFEFF/.test(text[i])) { i++; continue; }
        // A line ends at CR as well as LF. Asking only for LF made a whole
        // CR-separated file one escape line -- every game in it gone, reported
        // as "No games found" -- and ran a `;` remark to end of file, taking
        // the moves after it. Plain CR-separated records parse fine otherwise,
        // so these were gaps rather than an unsupported format.
        if (text[i] === '%' && atPgnLineStart(text, i)) {
            i = pgnLineEnd(text, i) + 1; continue;
        }
        if (text[i] === ';' || text[i] === '{') {
            const brace = text[i] === '{';
            const end = brace ? text.indexOf('}', i + 1) : pgnLineEnd(text, i + 1);
            if (brace && end < 0) throw new Error('Unclosed PGN comment. Nothing was imported.');
            yield { kind: 'comment', value: text.slice(i + 1, end < 0 ? text.length : end) };
            i = end < 0 ? text.length : end + 1;
            continue;
        }
        const pattern = text[i] === '[' ? tag : symbol;
        pattern.lastIndex = i;
        const match = pattern.exec(text);
        if (!match) throw new Error(`Unrecognized PGN text near “${text.slice(i, i + 24)}”.`);
        yield { kind: text[i] === '[' ? 'tag' : 'symbol', value: match[0] };
        i = pattern.lastIndex;
    }
}

type Cursor = { board: BoardState; side: Side; children: SavedMoveTreeNode[]; ply: number; node?: SavedMoveTreeNode; parent?: Cursor };
function parseGame(input: Token[]): CollectionGame {
    let seenMovetext = false;
    for (const token of input) {
        if (token.kind === 'symbol') seenMovetext = true;
        if (token.kind === 'tag' && seenMovetext) throw new Error('A header appears inside the movetext.');
    }
    const headers = input.filter(t => t.kind === 'tag').map(t => t.value).join('\n');
    const tags: Record<string, string> = Object.create(null);
    for (const token of input.filter(t => t.kind === 'tag')) {
        const match = /^\[\s*(\w+)\s+"((?:\\.|[^"\\])*)"/.exec(token.value)!;
        const key = match[1].toLowerCase();
        if (key in tags) throw new Error(`Duplicate ${match[1]} header.`);
        tags[key] = match[2].replace(/\\(["\\])/g, '$1');
    }
    if (tags.variant && !/^(xiangqi|chinese chess)$/i.test(tags.variant)) throw new Error(`Unsupported variant: ${tags.variant}. Choose Xiangqi coordinate PGN.`);
    if (tags.result && !(Object.hasOwn(RESULTS, tags.result))) throw new Error('Invalid Result header.');
    const fen = tags.fen || `${START_FEN} w - - 0 1`;
    const base = normalizeSavedGame({ id: 'preview', savedAt: 1, gameMode: 'PvP', moves: [], startFen: fen });
    // `normalizeSavedGame` only says yes or no, and this reader's whole job is
    // to say which game and what about it. The same sentence the New Game
    // field and the editor give; the fallback cannot fire while the library's
    // own FEN test is this function, and is here so that if they ever part
    // company the reader still gets a refusal rather than a pass.
    if (!base) throw new Error(`Invalid starting FEN. ${describeFenProblem(fen) ?? 'It does not describe a position a game could reach.'}`);
    const root: SavedMoveTreeNode[] = [];
    let cursor: Cursor = { board: parseFenBoard(fen), side: fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w', children: root, ply: 0 };
    const stack: Cursor[] = [];
    let nodes = 0;
    let result: string | undefined;
    let rootComment: string | undefined;
    let rootResult: RecordedResult | undefined;
    /** Inside a variation whose first move has not been read yet. */
    let awaitingVariationMove = false;
    function addComment(text: string) {
        if (!text.trim()) return;
        // A note between `(` and the variation's first move is about the
        // position there, and a move tree has nowhere to put one: notes live
        // on moves, and only the root has a note about a position.
        // docs/audit-2026-09-11.md settles what may not happen with it --
        // "a preface before a variation's first move is not assigned to its
        // parent; position-preface storage remains unsupported" -- and this
        // reader's own rule settles the rest: unknown movetext is rejected,
        // never skipped.
        //
        // It did neither. `(` walks the cursor back to the branch point, and
        // that cursor still carries the *previous* move, so the preface was
        // attached to the move the variation branches from -- silently, and
        // with any `[%eval]` inside it, putting a score on a move it says
        // nothing about. Only where the branch point had no move at all -- a
        // variation on ply 1 -- did the refusal below fire, so one file
        // behaved two ways depending on how deep its variations were.
        if (awaitingVariationMove) throw new Error('Attach a variation note to its first move.');
        const recordedResult = readRecordedResultPgn(text);
        const withoutResult = stripDelimited(text, '[%xqresult ', ']', '');
        if (!cursor.node) {
            // Unreachable now that the variation preface is handled above:
            // outside one, the cursor only lacks a move before the first is
            // played. Kept as a guard rather than a claim.
            if (nodes > 0) throw new Error('Attach a variation note to its first move.');
            if (recordedResult) rootResult = recordedResult;
            const { prose } = extractPgnEvalCommands(stripDelimited(withoutResult, '[%xqanalysis ', ']', ''));
            const joined = [rootComment, prose].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            if (joined.length > MAX_MOVE_COMMENT_LENGTH) throw new Error(`A starting-position note exceeds ${MAX_MOVE_COMMENT_LENGTH} characters.`);
            rootComment = normalizeMoveComment(joined);
            return;
        }
        if (recordedResult) cursor.node.recordedResult = recordedResult;
        const analysis = readStudyAnalysisPgn(text);
        if (analysis && analysis.move === cursor.node.uci) cursor.node.analysis = analysis;
        const { evaluation, prose } = extractPgnEvalCommands(stripDelimited(withoutResult, '[%xqanalysis ', ']', ''));
        if (evaluation) {
            cursor.node.evalScore = evaluation.evalScore;
            cursor.node.evalDepth = evaluation.evalDepth;
            cursor.node.evalScoreKind = evaluation.evalScoreKind;
        }
        const joined = [cursor.node.comment, prose].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (joined.length > MAX_MOVE_COMMENT_LENGTH) throw new Error(`A move note exceeds ${MAX_MOVE_COMMENT_LENGTH} characters.`);
        cursor.node.comment = normalizeMoveComment(joined);
    }
    for (const token of input) {
        if (token.kind === 'tag') continue;
        if (token.kind === 'comment') { addComment(token.value); continue; }
        const value = token.value;
        if (/^\d+\.+$/.test(value)) continue;
        if (/^(\$\d+|[!?]+)$/.test(value)) {
            const hasGlyph = cursor.node ? appendPgnGlyph(cursor.node, value) : false;
            const quality = parsePgnMoveQuality(value);
            if (quality && cursor.node) cursor.node.quality = quality;
            else if (!hasGlyph) addComment(value);
            continue;
        }
        if (value === '(') {
            if (!cursor.parent) throw new Error('A variation has no preceding move.');
            stack.push(cursor); cursor = cursor.parent; awaitingVariationMove = true; continue;
        }
        if (value === ')') {
            const previous = stack.pop();
            if (!previous || cursor === previous.parent) throw new Error('Unmatched or empty variation.');
            cursor = previous; awaitingVariationMove = false; continue;
        }
        if (Object.hasOwn(RESULTS, value)) {
            if (stack.length) throw new Error('Result marker inside a variation.');
            result = value; continue;
        }
        if (result) throw new Error('Moves follow the game result.');
        if (!/^[a-i][0-9][a-i][0-9]$/i.test(value)) throw new Error(`Unsupported move “${value}”. Use coordinate PGN such as h2e2 h9g7.`);
        if (++nodes > MAX_STUDY_TREE_NODES) throw new Error('A study exceeds 8,192 moves across its variations.');
        if (cursor.ply >= MAX_STUDY_LINE_MOVES) throw new Error('A line exceeds 1,024 moves.');
        const uci = value.toLowerCase();
        const checked = validateMoveStr(uci, cursor.board, cursor.side);
        if (!checked.ok || !checked.mv) throw new Error(`Illegal move ${uci}: ${checked.reason || 'invalid move'}.`);
        const board = cursor.board.map(row => [...row]);
        const mv = checked.mv;
        board[mv.toRank][mv.toFile] = board[mv.fromRank][mv.fromFile];
        board[mv.fromRank][mv.fromFile] = '';
        const node: SavedMoveTreeNode = { uci, children: [] };
        cursor.children.push(node);
        cursor = { board, side: cursor.side === 'w' ? 'b' : 'w', node, parent: cursor, children: node.children!, ply: cursor.ply + 1 };
        awaitingVariationMove = false;
    }
    if (stack.length) throw new Error('Unclosed variation.');
    if (!nodes && !rootComment && !tags.fen && !rootResult && !parseResultTag(result ?? tags.result)) throw new Error('No moves found.');
    if (result && tags.result && result !== tags.result) throw new Error('The Result header disagrees with the final result marker.');
    const moves: string[] = [];
    let finalNode = root[0];
    for (let node = root[0]; node; node = node.children?.[0] as SavedMoveTreeNode) { moves.push(node.uci); finalNode = node; }
    const declared = parseResultTag(result ?? tags.result);
    if (declared) { if (finalNode) finalNode.recordedResult = declared; else rootResult = declared; }
    return { gameMode: 'PvP', moves, moveTree: root, startFen: tags.fen, rootComment, ...(rootResult ? { rootResult } : {}),
        ...(nodes && tags.xiangqimainline === '1' ? { mainLinePinned: true as const } : {}),
        metadata: extractPgnMetadata(headers), opening: tags.opening,
        ...(finalNode?.evalScore === undefined ? {} : { finalEval: finalNode.evalScore, finalEvalKind: finalNode.evalScoreKind }),
        result: RESULTS[result || tags.result || '*'] };
}

/** Token-aware game boundaries, including multiple games on one physical line. */
export function parsePgnCollection(text: string): CollectionGame[] {
    if (text.length > MAX_COLLECTION_TEXT_LENGTH) throw new Error(COLLECTION_SIZE_ERROR);
    const games: CollectionGame[] = [];
    let current: Token[] = [];
    let depth = 0;
    let hasMoves = false;
    let ended = false;
    const finish = () => {
        if (!current.length) return;
        if (games.length >= MAX_SAVED_GAMES) throw new Error(`A collection can contain at most ${MAX_SAVED_GAMES} games.`);
        try { games.push(parseGame(current)); }
        catch (error) { throw new Error(`Game ${games.length + 1}: ${error instanceof Error ? error.message : 'Invalid PGN'}`); }
        current = []; depth = 0; hasMoves = false; ended = false;
    };
    for (const token of tokens(text)) {
        if ((ended && token.kind !== 'comment') || (token.kind === 'tag' && hasMoves && depth === 0)) finish();
        current.push(token);
        if (token.kind !== 'symbol') continue;
        if (token.value === '(') depth++;
        else if (token.value === ')') depth--;
        else if (Object.hasOwn(RESULTS, token.value) && depth === 0) ended = true;
        else if (!/^\d+\.+$/.test(token.value)) hasMoves = true;
    }
    finish();
    if (!games.length) throw new Error('No games found. Choose a Xiangqi coordinate PGN file.');
    return games;
}
