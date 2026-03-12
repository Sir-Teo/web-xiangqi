import type { GameMode } from '../App';
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
type SavedResult = typeof SAVED_RESULTS[number];

export interface SavedGame {
    id: string;
    savedAt: number;
    gameMode: GameMode;
    moves: string[];            // UCI strings from root to leaf
    result?: SavedResult;
    label?: string;             // user-editable
    opening?: string;           // matched opening name
    finalEval?: number;
    review?: SavedReviewSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asFiniteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown) {
    return typeof value === 'string' ? value : undefined;
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
    const savedAt = asFiniteNumber(raw.savedAt);
    const rawGameMode = asString(raw.gameMode);
    const gameMode = rawGameMode && SAVED_GAME_MODES.includes(rawGameMode as GameMode)
        ? rawGameMode as GameMode
        : undefined;
    const moves = Array.isArray(raw.moves) ? raw.moves.filter((move): move is string => typeof move === 'string') : [];
    if (!id || typeof savedAt !== 'number' || !gameMode || moves.length === 0) {
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
        result,
        label: asString(raw.label),
        opening: asString(raw.opening),
        finalEval: asFiniteNumber(raw.finalEval),
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

function writeAll(games: SavedGame[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
    } catch {
        console.warn('Game library: localStorage write failed.');
    }
}

export function loadAllGames(): SavedGame[] {
    return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveGame(game: Omit<SavedGame, 'id' | 'savedAt'>): SavedGame {
    const saved: SavedGame = {
        ...game,
        id: crypto.randomUUID(),
        savedAt: Date.now(),
    };
    const games = readAll();
    games.push(saved);
    writeAll(games);
    return saved;
}

export function deleteGame(id: string): void {
    writeAll(readAll().filter((g) => g.id !== id));
}

export function renameGame(id: string, label: string): void {
    const games = readAll().map((g) => g.id === id ? { ...g, label } : g);
    writeAll(games);
}
