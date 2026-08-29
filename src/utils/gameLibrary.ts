import type { GameMode } from '../App';
import { findKing, inPalace, isInCheck, kingsFacing, otherSide, parseFenBoard } from './xiangqi';
import type {
    ReviewCriticalQuality,
    ReviewEngineSummary,
    ReviewKeyMoment,
    ReviewMoveQuality,
    ReviewSummary,
    SavedReviewAnnotation,
    SavedReviewSnapshot,
} from './review';
import { MAX_REPORTED_CENTIPAWN_LOSS, getWinPercentLossForMove, makeReviewLineSignatureFromMoves } from './review';
import { GAME_LIBRARY_STORAGE_KEY, readVersionedStorage } from './storageKeys';

export { GAME_LIBRARY_STORAGE_KEY };
const SAVED_GAME_MODES = ['PvP', 'PvAI-Black', 'PvAI-Red', 'AIvAI'] as const;
const REVIEW_MOVE_QUALITIES: ReviewMoveQuality[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
const REVIEW_CRITICAL_QUALITIES: ReviewCriticalQuality[] = ['inaccuracy', 'mistake', 'blunder'];
const REVIEW_ENGINE_TIERS: ReviewEngineSummary['tier'][] = ['low', 'mid', 'high'];
const SAVED_RESULTS = ['red', 'black', 'draw', 'ongoing'] as const;
const MAX_LIBRARY_JSON_LENGTH = 3_000_000;
const MAX_SAVED_GAMES = 500;
const MAX_SAVED_MOVES = 1024;
const MAX_SAVED_TREE_NODES = MAX_SAVED_MOVES;
const MAX_SAVED_LABEL_LENGTH = 120;
const MAX_SAVED_OPENING_LENGTH = 160;
const MAX_REVIEW_TEXT_LENGTH = 500;
const MAX_REVIEW_LINE_SIGNATURE_LENGTH = 8192;
const MAX_REVIEW_NODE_ID_LENGTH = 96;
const MAX_REVIEW_KEY_MOMENTS = 128;
const MAX_REVIEW_ANNOTATIONS = 1024;
const MAX_REVIEW_ENGINE_DEPTH = 128;
const MAX_REVIEW_ENGINE_MOVE_TIME_MS = 600_000;
/**
 * A stored average can only be as large as the per-move bound the review now
 * applies, so reading is clamped to the same figure. Without this, a review
 * saved before that bound existed keeps an inflated average — the same game
 * re-reviewed scores 525 where the old record says 5017 — and the library both
 * sorts by this value and averages it across games, so the two scales would be
 * silently compared. Clamping does not recover the true figure for an old
 * record; it keeps every record on one scale, which is what sorting needs.
 */
const MAX_REVIEW_AVERAGE_CENTIPAWN_LOSS = MAX_REPORTED_CENTIPAWN_LOSS;
type SavedResult = typeof SAVED_RESULTS[number];

export interface SavedMoveTreeNode {
    uci: string;
    children?: SavedMoveTreeNode[];
}

export interface SavedGame {
    id: string;
    savedAt: number;
    gameMode: GameMode;
    moves: string[];            // UCI strings from root to leaf
    startFen?: string;          // root position for custom-FEN games
    result?: SavedResult;
    label?: string;             // user-editable
    opening?: string;           // matched opening name
    finalEval?: number;
    moveTree?: SavedMoveTreeNode[];
    review?: SavedReviewSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asFiniteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asValidTimestamp(value: unknown) {
    const timestamp = asFiniteNumber(value);
    if (typeof timestamp !== 'number') return undefined;
    return Number.isFinite(new Date(timestamp).getTime()) ? timestamp : undefined;
}

function asNonNegativeInteger(value: unknown) {
    const number = asFiniteNumber(value);
    return typeof number === 'number' && number >= 0 ? Math.trunc(number) : undefined;
}

function asClampedInteger(value: unknown, min: number, max: number) {
    const number = asFiniteNumber(value);
    if (typeof number !== 'number') return undefined;
    return Math.max(min, Math.min(max, Math.trunc(number)));
}

function asWinPercentLoss(value: unknown) {
    const number = asFiniteNumber(value);
    if (typeof number !== 'number') return undefined;
    return Math.max(0, Math.min(100, number));
}

function asString(value: unknown) {
    return typeof value === 'string' ? value : undefined;
}

function asBoundedString(value: unknown, maxLength: number) {
    const text = asString(value);
    if (typeof text !== 'string') return undefined;
    return text.trim().slice(0, maxLength);
}

function normalizeSavedMove(value: unknown): string | null {
    const move = asString(value)?.trim().toLowerCase();
    return move && /^[a-i][0-9][a-i][0-9]$/.test(move) ? move : null;
}

function normalizeSavedMoves(value: unknown): string[] | null {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return null;
    if (value.length > MAX_SAVED_MOVES) return null;
    const moves: string[] = [];
    for (const rawMove of value) {
        const move = normalizeSavedMove(rawMove);
        if (!move) return null;
        moves.push(move);
    }
    return moves;
}

function normalizeSavedMoveTreeNode(raw: unknown, state: { count: number }): SavedMoveTreeNode | null {
    if (!isRecord(raw)) return null;
    const uci = normalizeSavedMove(raw.uci);
    if (!uci) return null;
    state.count += 1;
    if (state.count > MAX_SAVED_TREE_NODES) return null;

    const rawChildren = raw.children;
    if (rawChildren !== undefined && !Array.isArray(rawChildren)) return null;
    const children = Array.isArray(rawChildren)
        ? rawChildren.map((child) => normalizeSavedMoveTreeNode(child, state))
        : [];
    if (children.some((child) => child === null)) return null;
    const normalizedChildren = children.filter((child): child is SavedMoveTreeNode => Boolean(child));
    return normalizedChildren.length > 0 ? { uci, children: normalizedChildren } : { uci };
}

export function normalizeSavedMoveTree(value: unknown): SavedMoveTreeNode[] | undefined | null {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return null;
    const state = { count: 0 };
    const tree = value.map((node) => normalizeSavedMoveTreeNode(node, state));
    if (tree.some((node) => node === null)) return null;
    return tree.filter((node): node is SavedMoveTreeNode => Boolean(node));
}

function normalizeStartFen(value: unknown): string | undefined | null {
    const fen = asString(value)?.trim();
    if (!fen) return undefined;
    try {
        const parts = fen.split(/\s+/);
        if (parts.length < 2) return null;
        const board = parseFenBoard(parts[0]);
        const flat = board.flat();
        if (flat.filter((piece) => piece === 'K').length !== 1) return null;
        if (flat.filter((piece) => piece === 'k').length !== 1) return null;
        if (parts[1] !== 'w' && parts[1] !== 'b') return null;
        const side = parts[1] === 'b' ? 'b' : 'w';
        const redKing = findKing(board, 'w');
        const blackKing = findKing(board, 'b');
        if (!redKing || !blackKing) return null;
        if (!inPalace('w', redKing.file, redKing.rank)) return null;
        if (!inPalace('b', blackKing.file, blackKing.rank)) return null;
        if (kingsFacing(board)) return null;
        if (isInCheck(board, otherSide(side))) return null;
        return fen;
    } catch {
        return null;
    }
}

function asMoveQuality(value: unknown): ReviewMoveQuality | undefined {
    return typeof value === 'string' && REVIEW_MOVE_QUALITIES.includes(value as ReviewMoveQuality)
        ? value as ReviewMoveQuality
        : undefined;
}

function asCriticalQuality(value: unknown): ReviewCriticalQuality | undefined {
    return typeof value === 'string' && REVIEW_CRITICAL_QUALITIES.includes(value as ReviewCriticalQuality)
        ? value as ReviewCriticalQuality
        : undefined;
}

function normalizeReviewEngineSummary(raw: unknown): ReviewEngineSummary | undefined {
    if (!isRecord(raw)) return undefined;
    const tier = typeof raw.tier === 'string' && REVIEW_ENGINE_TIERS.includes(raw.tier as ReviewEngineSummary['tier'])
        ? raw.tier as ReviewEngineSummary['tier']
        : undefined;
    const baseDepth = asClampedInteger(raw.baseDepth, 1, MAX_REVIEW_ENGINE_DEPTH);
    const baseMoveTimeMs = asClampedInteger(raw.baseMoveTimeMs, 1, MAX_REVIEW_ENGINE_MOVE_TIME_MS);
    if (!tier || typeof baseDepth !== 'number' || typeof baseMoveTimeMs !== 'number') return undefined;

    const revisitDepth = asClampedInteger(raw.revisitDepth, 1, MAX_REVIEW_ENGINE_DEPTH);
    const revisitMoveTimeMs = asClampedInteger(raw.revisitMoveTimeMs, 1, MAX_REVIEW_ENGINE_MOVE_TIME_MS);
    return {
        tier,
        baseDepth,
        baseMoveTimeMs,
        ...(typeof revisitDepth === 'number' && typeof revisitMoveTimeMs === 'number'
            ? { revisitDepth, revisitMoveTimeMs }
            : {}),
    };
}

function normalizeSavedReviewAnnotation(raw: unknown, moveCount: number): SavedReviewAnnotation | null {
    if (!isRecord(raw)) return null;
    const moveIndex = asNonNegativeInteger(raw.moveIndex);
    if (typeof moveIndex !== 'number' || moveIndex < 0 || moveIndex >= moveCount) return null;

    return {
        moveIndex,
        evalScore: asFiniteNumber(raw.evalScore),
        bestMove: normalizeSavedMove(raw.bestMove) ?? undefined,
        quality: asMoveQuality(raw.quality),
        swing: asFiniteNumber(raw.swing),
        winPercentLoss: asWinPercentLoss(raw.winPercentLoss),
        reviewNote: asBoundedString(raw.reviewNote, MAX_REVIEW_TEXT_LENGTH) || undefined,
    };
}

function normalizeReviewKeyMoment(raw: unknown, fallbackNodeId: string, moveCount: number): ReviewKeyMoment | null {
    if (!isRecord(raw)) return null;
    const moveIndex = asNonNegativeInteger(raw.moveIndex);
    const jumpTarget = asNonNegativeInteger(raw.jumpTarget);
    const ply = asNonNegativeInteger(raw.ply);
    const swing = asFiniteNumber(raw.swing);
    const evalBefore = asFiniteNumber(raw.evalBefore);
    const evalAfter = asFiniteNumber(raw.evalAfter);
    const quality = asCriticalQuality(raw.quality);
    const side = raw.side === 'black' ? 'black' : raw.side === 'red' ? 'red' : undefined;
    const playedMove = normalizeSavedMove(raw.playedMove);
    const note = asBoundedString(raw.note, MAX_REVIEW_TEXT_LENGTH);
    const rawWinPercentLoss = asWinPercentLoss(raw.winPercentLoss);

    if (
        typeof moveIndex !== 'number' ||
        typeof jumpTarget !== 'number' ||
        typeof ply !== 'number' ||
        moveIndex >= moveCount ||
        jumpTarget >= moveCount ||
        typeof swing !== 'number' ||
        typeof evalBefore !== 'number' ||
        typeof evalAfter !== 'number' ||
        !quality ||
        !side ||
        !playedMove ||
        !note
    ) {
        return null;
    }

    return {
        nodeId: asBoundedString(raw.nodeId, MAX_REVIEW_NODE_ID_LENGTH) || fallbackNodeId,
        moveIndex,
        jumpTarget,
        ply,
        side,
        quality,
        swing,
        winPercentLoss: rawWinPercentLoss ?? getWinPercentLossForMove(evalBefore, evalAfter, side),
        evalBefore,
        evalAfter,
        bestMove: normalizeSavedMove(raw.bestMove) ?? undefined,
        playedMove,
        note,
    };
}

function normalizeReviewSummary(raw: unknown, moves: string[]): ReviewSummary | null {
    if (!isRecord(raw)) return null;

    const keyMoments = Array.isArray(raw.keyMoments)
        ? raw.keyMoments
            .slice(0, MAX_REVIEW_KEY_MOMENTS)
            .map((moment, index) => normalizeReviewKeyMoment(moment, `saved-${index}`, moves.length))
            .filter((moment): moment is ReviewKeyMoment => Boolean(moment))
        : [];
    const totalMoves = asNonNegativeInteger(raw.totalMoves);

    return {
        totalMoves: typeof totalMoves === 'number' && totalMoves <= moves.length ? totalMoves : moves.length,
        accuracy: asClampedInteger(raw.accuracy, 0, 100) ?? 0,
        averageCentipawnLoss: asClampedInteger(raw.averageCentipawnLoss, 0, MAX_REVIEW_AVERAGE_CENTIPAWN_LOSS),
        redAccuracy: asClampedInteger(raw.redAccuracy, 0, 100),
        blackAccuracy: asClampedInteger(raw.blackAccuracy, 0, 100),
        redAverageCentipawnLoss: asClampedInteger(raw.redAverageCentipawnLoss, 0, MAX_REVIEW_AVERAGE_CENTIPAWN_LOSS),
        blackAverageCentipawnLoss: asClampedInteger(raw.blackAverageCentipawnLoss, 0, MAX_REVIEW_AVERAGE_CENTIPAWN_LOSS),
        bestCount: asClampedInteger(raw.bestCount, 0, moves.length) ?? 0,
        goodCount: asClampedInteger(raw.goodCount, 0, moves.length) ?? 0,
        inaccuracyCount: asClampedInteger(raw.inaccuracyCount, 0, moves.length) ?? 0,
        mistakeCount: asClampedInteger(raw.mistakeCount, 0, moves.length) ?? 0,
        blunderCount: asClampedInteger(raw.blunderCount, 0, moves.length) ?? 0,
        reviewedAt: asValidTimestamp(raw.reviewedAt) ?? Date.now(),
        lineSignature: asBoundedString(raw.lineSignature, MAX_REVIEW_LINE_SIGNATURE_LENGTH) || makeReviewLineSignatureFromMoves(moves),
        engine: normalizeReviewEngineSummary(raw.engine),
        keyMoments,
    };
}

function normalizeSavedReview(raw: unknown, moves: string[]): SavedReviewSnapshot | undefined {
    if (!isRecord(raw)) return undefined;

    const summary = normalizeReviewSummary(raw.summary ?? raw, moves);
    if (!summary) return undefined;

    const annotations = Array.isArray(raw.annotations)
        ? raw.annotations
            .slice(0, MAX_REVIEW_ANNOTATIONS)
            .map((annotation) => normalizeSavedReviewAnnotation(annotation, moves.length))
            .filter((annotation): annotation is SavedReviewAnnotation => Boolean(annotation))
        : [];

    return { summary, annotations };
}

export function normalizeSavedGame(raw: unknown): SavedGame | null {
    if (!isRecord(raw)) return null;

    const id = asString(raw.id);
    const savedAt = asValidTimestamp(raw.savedAt);
    const rawGameMode = asString(raw.gameMode);
    const gameMode = rawGameMode && SAVED_GAME_MODES.includes(rawGameMode as GameMode)
        ? rawGameMode as GameMode
        : undefined;
    const moves = normalizeSavedMoves(raw.moves);
    const moveTree = normalizeSavedMoveTree(raw.moveTree);
    const startFen = normalizeStartFen(raw.startFen);
    if (!moves || moveTree === null || startFen === null) {
        return null;
    }
    if (!id || typeof savedAt !== 'number' || !gameMode || (moves.length === 0 && !startFen && !moveTree?.length)) {
        return null;
    }

    const result = typeof raw.result === 'string' && SAVED_RESULTS.includes(raw.result as SavedResult)
        ? raw.result as SavedResult
        : 'ongoing';

    return {
        id,
        savedAt,
        gameMode,
        moves,
        startFen,
        result,
        label: asBoundedString(raw.label, MAX_SAVED_LABEL_LENGTH),
        opening: asBoundedString(raw.opening, MAX_SAVED_OPENING_LENGTH),
        finalEval: asFiniteNumber(raw.finalEval),
        moveTree,
        review: normalizeSavedReview(raw.review, moves),
    };
}

export function normalizeSavedGames(raw: unknown): SavedGame[] {
    if (!Array.isArray(raw)) return [];
    const games: SavedGame[] = [];
    for (const rawGame of raw) {
        const game = normalizeSavedGame(rawGame);
        if (game) games.push(game);
    }
    return games
        .sort((a, b) => a.savedAt - b.savedAt)
        .slice(-MAX_SAVED_GAMES);
}

function readAllResult(): { games: SavedGame[]; mutationBlocked: boolean } {
    try {
        const raw = readVersionedStorage(GAME_LIBRARY_STORAGE_KEY);
        if (!raw) return { games: [], mutationBlocked: false };
        if (raw.length > MAX_LIBRARY_JSON_LENGTH) {
            return { games: [], mutationBlocked: true };
        }
        return { games: normalizeSavedGames(JSON.parse(raw)), mutationBlocked: false };
    } catch {
        return { games: [], mutationBlocked: false };
    }
}

function readAll(): SavedGame[] {
    return readAllResult().games;
}

function writeAll(games: SavedGame[]): boolean {
    try {
        localStorage.setItem(GAME_LIBRARY_STORAGE_KEY, JSON.stringify(games));
        return true;
    } catch {
        return false;
    }
}

function createSavedGameId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadAllGames(): SavedGame[] {
    return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveGame(game: Omit<SavedGame, 'id' | 'savedAt'>): SavedGame | null {
    const saved = normalizeSavedGame({
        ...game,
        id: createSavedGameId(),
        savedAt: Date.now(),
    });
    if (!saved) return null;
    const { games, mutationBlocked } = readAllResult();
    if (mutationBlocked) {
        return null;
    }
    games.push(saved);
    return writeAll(games.slice(-MAX_SAVED_GAMES)) ? saved : null;
}

export function deleteGame(id: string): boolean {
    const { games, mutationBlocked } = readAllResult();
    if (mutationBlocked) {
        return false;
    }
    return writeAll(games.filter((g) => g.id !== id));
}

export function renameGame(id: string, label: string): boolean {
    const normalizedLabel = asBoundedString(label, MAX_SAVED_LABEL_LENGTH) ?? '';
    const { games, mutationBlocked } = readAllResult();
    if (mutationBlocked) {
        return false;
    }
    const renamed = games.map((g) => g.id === id ? { ...g, label: normalizedLabel } : g);
    return writeAll(renamed);
}
