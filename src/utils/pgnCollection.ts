import { stripDelimited } from './stripDelimited';
import { extractPgnEvalCommands, parsePgnMoveQuality } from './pgnEvaluation';
import { readStudyAnalysisPgn } from './studyAnalysis';
import { normalizeSavedGame, type SavedGame, type SavedMoveTreeNode, MAX_SAVED_GAMES } from './gameLibrary';
import { extractPgnMetadata } from './gameMetadata';
import { MAX_MOVE_COMMENT_LENGTH, normalizeMoveComment } from './moveComment';
import { START_FEN, parseFenBoard, validateMoveStr, type BoardState, type Side } from './xiangqi';

export const MAX_COLLECTION_TEXT_LENGTH = 1_000_000;
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
        if (text[i] === '%' && (i === 0 || text[i - 1] === '\n')) {
            const end = text.indexOf('\n', i); i = end < 0 ? text.length : end + 1; continue;
        }
        if (text[i] === ';' || text[i] === '{') {
            const brace = text[i] === '{';
            const end = text.indexOf(brace ? '}' : '\n', i + 1);
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

type Cursor = { board: BoardState; side: Side; children: SavedMoveTreeNode[]; node?: SavedMoveTreeNode; parent?: Cursor };
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
    if (!base) throw new Error('Invalid starting FEN.');
    const root: SavedMoveTreeNode[] = [];
    let cursor: Cursor = { board: parseFenBoard(fen), side: fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w', children: root };
    const stack: Cursor[] = [];
    let nodes = 0;
    let result: string | undefined;
    function addComment(text: string) {
        if (!text.trim()) return;
        if (!cursor.node) throw new Error('Notes before the first move are not supported. Attach the note to a move before importing.');
        const analysis = readStudyAnalysisPgn(text);
        if (analysis && analysis.move === cursor.node.uci) cursor.node.analysis = analysis;
        const { evaluation, prose } = extractPgnEvalCommands(stripDelimited(text, '[%xqanalysis ', ']', ''));
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
            const quality = parsePgnMoveQuality(value);
            if (quality && cursor.node) cursor.node.quality = quality;
            else addComment(value);
            continue;
        }
        if (value === '(') {
            if (!cursor.parent) throw new Error('A variation has no preceding move.');
            stack.push(cursor); cursor = cursor.parent; continue;
        }
        if (value === ')') {
            const previous = stack.pop();
            if (!previous || cursor === previous.parent) throw new Error('Unmatched or empty variation.');
            cursor = previous; continue;
        }
        if (Object.hasOwn(RESULTS, value)) {
            if (stack.length) throw new Error('Result marker inside a variation.');
            result = value; continue;
        }
        if (result) throw new Error('Moves follow the game result.');
        if (!/^[a-i][0-9][a-i][0-9]$/i.test(value)) throw new Error(`Unsupported move “${value}”. Use coordinate PGN such as h2e2 h9g7.`);
        if (++nodes > 1024) throw new Error('A game exceeds 1,024 moves including variations.');
        const uci = value.toLowerCase();
        const checked = validateMoveStr(uci, cursor.board, cursor.side);
        if (!checked.ok || !checked.mv) throw new Error(`Illegal move ${uci}: ${checked.reason || 'invalid move'}.`);
        const board = cursor.board.map(row => [...row]);
        const mv = checked.mv;
        board[mv.toRank][mv.toFile] = board[mv.fromRank][mv.fromFile];
        board[mv.fromRank][mv.fromFile] = '';
        const node: SavedMoveTreeNode = { uci, children: [] };
        cursor.children.push(node);
        cursor = { board, side: cursor.side === 'w' ? 'b' : 'w', node, parent: cursor, children: node.children! };
    }
    if (stack.length) throw new Error('Unclosed variation.');
    if (!nodes) throw new Error('No moves found.');
    if (result && tags.result && result !== tags.result) throw new Error('The Result header disagrees with the final result marker.');
    const moves: string[] = [];
    let finalNode = root[0];
    for (let node = root[0]; node; node = node.children?.[0] as SavedMoveTreeNode) { moves.push(node.uci); finalNode = node; }
    return { gameMode: 'PvP', moves, moveTree: root, startFen: tags.fen,
        metadata: extractPgnMetadata(headers), opening: tags.opening,
        ...(finalNode.evalScore === undefined ? {} : { finalEval: finalNode.evalScore, finalEvalKind: finalNode.evalScoreKind }),
        result: RESULTS[result || tags.result || '*'] };
}

/** Token-aware game boundaries, including multiple games on one physical line. */
export function parsePgnCollection(text: string): CollectionGame[] {
    if (text.length > MAX_COLLECTION_TEXT_LENGTH) throw new Error('Collection exceeds 1,000,000 characters. Split it into smaller files.');
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
