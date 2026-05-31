import type { GameMode } from '../App';
import { parseFenBoard } from './xiangqi';
import type {
    ReviewCriticalQuality,
    ReviewKeyMoment,
    ReviewMoveQuality,
    ReviewSummary,
    SavedReviewAnnotation,
    SavedReviewSnapshot,
} from './review';
import { makeReviewLineSignatureFromMoves } from './review';

const STORAGE_KEY = 'xiangqi-game-library';
const SAVED_GAME_MODES = ['PvP', 'PvAI-Black', 'PvAI-Red', 'AIvAI'] as const;
const REVIEW_MOVE_QUALITIES: ReviewMoveQuality[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
const REVIEW_CRITICAL_QUALITIES: ReviewCriticalQuality[] = ['inaccuracy', 'mistake', 'blunder'];
const SAVED_RESULTS = ['red', 'black', 'draw', 'ongoing'] as const;
const MAX_SAVED_TREE_NODES = 512;
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

function asString(value: unknown) {
    return typeof value === 'string' ? value : undefined;
}

function normalizeSavedMove(value: unknown): string | null {
    const move = asString(value)?.trim().toLowerCase();
    return move && /^[a-i][0-9][a-i][0-9]$/.test(move) ? move : null;
}

function normalizeSavedMoves(value: unknown): string[] | null {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return null;
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

function normalizeSavedReviewAnnotation(raw: unknown): SavedReviewAnnotation | null {
    if (!isRecord(raw)) return null;
    const moveIndex = asFiniteNumber(raw.moveIndex);
    if (typeof moveIndex !== 'number' || moveIndex < 0) return null;

    return {
        moveIndex,
        evalScore: asFiniteNumber(raw.evalScore),
        bestMove: asString(raw.bestMove),
        quality: asMoveQuality(raw.quality),
        swing: asFiniteNumber(raw.swing),
        reviewNote: asString(raw.reviewNote),
    };
}

function normalizeReviewKeyMoment(raw: unknown, fallbackNodeId: string): ReviewKeyMoment | null {
    if (!isRecord(raw)) return null;
    const moveIndex = asFiniteNumber(raw.moveIndex);
    const jumpTarget = asFiniteNumber(raw.jumpTarget);
    const ply = asFiniteNumber(raw.ply);
    const swing = asFiniteNumber(raw.swing);
    const evalBefore = asFiniteNumber(raw.evalBefore);
    const evalAfter = asFiniteNumber(raw.evalAfter);
    const quality = asCriticalQuality(raw.quality);
    const side = raw.side === 'black' ? 'black' : raw.side === 'red' ? 'red' : undefined;
    const playedMove = asString(raw.playedMove);
    const note = asString(raw.note);

    if (
        typeof moveIndex !== 'number' ||
        typeof jumpTarget !== 'number' ||
        typeof ply !== 'number' ||
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
        nodeId: asString(raw.nodeId) ?? fallbackNodeId,
        moveIndex,
        jumpTarget,
        ply,
        side,
        quality,
        swing,
        evalBefore,
        evalAfter,
        bestMove: asString(raw.bestMove),
        playedMove,
        note,
    };
}

function normalizeReviewSummary(raw: unknown, moves: string[]): ReviewSummary | null {
    if (!isRecord(raw)) return null;

    const keyMoments = Array.isArray(raw.keyMoments)
        ? raw.keyMoments
            .map((moment, index) => normalizeReviewKeyMoment(moment, `saved-${index}`))
            .filter((moment): moment is ReviewKeyMoment => Boolean(moment))
        : [];

    return {
        totalMoves: asFiniteNumber(raw.totalMoves) ?? moves.length,
        accuracy: asFiniteNumber(raw.accuracy) ?? 0,
        bestCount: asFiniteNumber(raw.bestCount) ?? 0,
        goodCount: asFiniteNumber(raw.goodCount) ?? 0,
        inaccuracyCount: asFiniteNumber(raw.inaccuracyCount) ?? 0,
        mistakeCount: asFiniteNumber(raw.mistakeCount) ?? 0,
        blunderCount: asFiniteNumber(raw.blunderCount) ?? 0,
        reviewedAt: asFiniteNumber(raw.reviewedAt) ?? Date.now(),
        lineSignature: asString(raw.lineSignature) ?? makeReviewLineSignatureFromMoves(moves),
        keyMoments,
    };
}

function normalizeSavedReview(raw: unknown, moves: string[]): SavedReviewSnapshot | undefined {
    if (!isRecord(raw)) return undefined;

    const summary = normalizeReviewSummary(raw.summary ?? raw, moves);
    if (!summary) return undefined;

    const annotations = Array.isArray(raw.annotations)
        ? raw.annotations
            .map((annotation) => normalizeSavedReviewAnnotation(annotation))
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
    if (!id || typeof savedAt !== 'number' || !gameMode || (moves.length === 0 && !startFen)) {
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
        label: asString(raw.label),
        opening: asString(raw.opening),
        finalEval: asFiniteNumber(raw.finalEval),
        moveTree,
        review: normalizeSavedReview(raw.review, moves),
    };
}

export function normalizeSavedGames(raw: unknown): SavedGame[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((game) => normalizeSavedGame(game))
        .filter((game): game is SavedGame => Boolean(game));
}

function readAll(): SavedGame[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return normalizeSavedGames(JSON.parse(raw));
    } catch {
        return [];
    }
}

function writeAll(games: SavedGame[]): boolean {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
        return true;
    } catch {
        console.warn('Game library: localStorage write failed.');
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
    const saved: SavedGame = {
        ...game,
        id: createSavedGameId(),
        savedAt: Date.now(),
    };
    const games = readAll();
    games.push(saved);
    return writeAll(games) ? saved : null;
}

export function deleteGame(id: string): boolean {
    return writeAll(readAll().filter((g) => g.id !== id));
}

export function renameGame(id: string, label: string): boolean {
    const games = readAll().map((g) => g.id === id ? { ...g, label } : g);
    return writeAll(games);
}
