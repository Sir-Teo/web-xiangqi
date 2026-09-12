import { normalizeRecordedResult, type RecordedResult } from './recordedResult';
import { truncateText } from './truncateText';

import { evaluationKindOverride, type EvaluationScoreKind } from './engineEvalReading';
import { normalizeStudyAnalysis, type StudyAnalysis } from './studyAnalysis';
import { normalizeMoveEvaluation, type MoveEvaluation } from './moveEvaluation';
import { normalizeMoveGlyphs, type MoveGlyphs } from './moveGlyphs';
import { normalizeGameMetadata, type GameMetadata } from './gameMetadata';
import type { GameMode } from '../App';
import { parseFenBoard } from './xiangqi';
import { describeSetupProblem } from './positionSetup';
import type {
    ReviewCriticalQuality,
    ReviewEngineSummary,
    ReviewKeyMoment,
    ReviewMoveQuality,
    ReviewSummary,
    SavedReviewAnnotation,
    SavedReviewSnapshot,
} from './review';
import { MAX_REPORTED_CENTIPAWN_LOSS, getWinPercentLossForMove, makeReviewLineSignatureFromMoves, rebuildSummaryFromAnnotations, reviewSideFromStartFen } from './review';
import { GAME_LIBRARY_STORAGE_KEY, LEGACY_STORAGE_KEYS, readVersionedStorage } from './storageKeys';
import { normalizeMoveComment } from './moveComment';
import { bestLineForMove } from './engineBestLine';

export { GAME_LIBRARY_STORAGE_KEY };
const SAVED_GAME_MODES = ['PvP', 'PvAI-Black', 'PvAI-Red', 'AIvAI'] as const;
const REVIEW_MOVE_QUALITIES: ReviewMoveQuality[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
const REVIEW_CRITICAL_QUALITIES: ReviewCriticalQuality[] = ['inaccuracy', 'mistake', 'blunder'];
const REVIEW_ENGINE_TIERS: ReviewEngineSummary['tier'][] = ['low', 'mid', 'high'];
const SAVED_RESULTS = ['red', 'black', 'draw', 'ongoing'] as const;
export const MAX_LIBRARY_JSON_LENGTH = 3_000_000;
export const MAX_SAVED_GAMES = 500;
export const MAX_SAVED_MOVES = 1024;
export const MAX_SAVED_TREE_NODES = MAX_SAVED_MOVES;
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

export interface SavedMoveTreeNode extends MoveEvaluation, MoveGlyphs {
    recordedResult?: RecordedResult;
    uci: string;
    /** The reader's note on this move; see `utils/moveComment`. */
    comment?: string;
    analysis?: StudyAnalysis;
    children?: SavedMoveTreeNode[];
}

export interface SavedGame {
    rootResult?: RecordedResult;
    metadata?: GameMetadata;
    rootComment?: string;
    /** First-child order is an explicit study main line, separate from the cursor. */
    mainLinePinned?: true;
    id: string;
    savedAt: number;
    gameMode: GameMode;
    moves: string[];            // UCI strings from root to the saved cursor
    startFen?: string;          // root position for custom-FEN games
    result?: SavedResult;
    label?: string;             // user-editable
    opening?: string;           // matched opening name
    finalEval?: number;
    finalEvalKind?: EvaluationScoreKind;
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
    return truncateText(text.trim(), maxLength);
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
    // A note is bounded and folded on the way back out of storage, not only on
    // the way in: this reader also sees records written by an older build and
    // by anything that hand-edits localStorage. A note that cannot be read is
    // dropped rather than failing the node, since losing a sentence is better
    // than losing the variation it sits on.
    const comment = normalizeMoveComment(raw.comment);
    const nags = normalizeMoveGlyphs(raw.nags);
    const analysis = normalizeStudyAnalysis(raw.analysis, undefined, uci);
    return {
        uci,
        ...(comment ? { comment } : {}),
        ...(nags ? { nags } : {}),
        ...(analysis ? { analysis } : {}),
        ...(normalizeRecordedResult(raw.recordedResult) ? { recordedResult: normalizeRecordedResult(raw.recordedResult) } : {}),
        ...normalizeMoveEvaluation(raw),
        ...(normalizedChildren.length > 0 ? { children: normalizedChildren } : {}),
    };
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
        if (parts[1] !== 'w' && parts[1] !== 'b') return null;
        if (describeSetupProblem(board, parts[1])) return null;
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
        evalScoreKind: evaluationKindOverride(asFiniteNumber(raw.evalScore) ?? NaN, raw.evalScoreKind),
        bestMove: normalizeSavedMove(raw.bestMove) ?? undefined,
        // Bounded and re-checked on read like everything else here, and paired
        // with the move it starts from: a saved review may predate the field
        // entirely, or come from a build whose line and recommendation were
        // written by different searches.
        bestLine: bestLineForMove(normalizeSavedMove(raw.bestMove) ?? undefined, raw.bestLine),
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
        ...(evaluationKindOverride(evalBefore, raw.evalBeforeKind) ? { evalBeforeKind: evaluationKindOverride(evalBefore, raw.evalBeforeKind) } : {}),
        evalAfter,
        ...(evaluationKindOverride(evalAfter, raw.evalAfterKind) ? { evalAfterKind: evaluationKindOverride(evalAfter, raw.evalAfterKind) } : {}),
        bestMove: normalizeSavedMove(raw.bestMove) ?? undefined,
        // Whitelisted like every other field here, which is why it had to be
        // added rather than arriving for free: a key moment read back without
        // it showed the move the engine preferred and not the line it was
        // for, so a review looked different after a trip through the library.
        bestLine: bestLineForMove(normalizeSavedMove(raw.bestMove) ?? undefined, raw.bestLine),
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

function normalizeSavedReview(raw: unknown, moves: string[], startFen?: string): SavedReviewSnapshot | undefined {
    if (!isRecord(raw)) return undefined;

    const summary = normalizeReviewSummary(raw.summary ?? raw, moves);
    if (!summary) return undefined;

    const annotations = Array.isArray(raw.annotations)
        ? raw.annotations
            .slice(0, MAX_REVIEW_ANNOTATIONS)
            .map((annotation) => normalizeSavedReviewAnnotation(annotation, moves.length))
            .filter((annotation): annotation is SavedReviewAnnotation => Boolean(annotation))
        : [];

    // Rebuilt here rather than trusted as stored, so every reader sees the
    // same number: the library card and the loaded game used to disagree,
    // because only the load path recomputed. This is the read boundary, which
    // is where the guard belongs -- the same argument as `storage.ts` guarding
    // failure once instead of at each call site.
    // Only the accuracy figures are recomputed here, and only because they are
    // the ones this change moved: they used to be a flat mean and are now
    // weighted by how volatile the game was around each move, so a summary
    // written before that reports a number the current code cannot produce.
    // The library card and the loaded game were disagreeing for exactly that
    // reason -- only the load path recomputed.
    //
    // Everything else stays as normalization left it. The counts, the average
    // centipawn loss and the move count are not scale-dependent, and this file
    // has its own validation and fallbacks for them that a wholesale rebuild
    // would quietly override.
    // The first mover comes from the start position: a study set up with
    // Black to move had its Red and Black accuracies swapped on every read.
    const rebuilt = rebuildSummaryFromAnnotations(annotations, summary, reviewSideFromStartFen(startFen));
    return {
        summary: {
            ...summary,
            accuracy: rebuilt.accuracy,
            redAccuracy: rebuilt.redAccuracy,
            blackAccuracy: rebuilt.blackAccuracy,
        },
        annotations,
    };
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
    const rootComment = normalizeMoveComment(raw.rootComment);
    const metadata = normalizeGameMetadata(raw.metadata);
    if (!moves || moveTree === null || startFen === null) {
        return null;
    }
    if (!id || typeof savedAt !== 'number' || !gameMode || (moves.length === 0 && !startFen && !moveTree?.length && !rootComment && !normalizeRecordedResult(raw.rootResult) && !metadata)) {
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
        rootComment,
        ...(normalizeRecordedResult(raw.rootResult) ? { rootResult: normalizeRecordedResult(raw.rootResult) } : {}),
        ...(raw.mainLinePinned === true && (moves.length || moveTree?.length) ? { mainLinePinned: true as const } : {}),
        result,
        metadata,
        label: asBoundedString(raw.label, MAX_SAVED_LABEL_LENGTH),
        opening: asBoundedString(raw.opening, MAX_SAVED_OPENING_LENGTH),
        finalEval: asFiniteNumber(raw.finalEval),
        finalEvalKind: evaluationKindOverride(asFiniteNumber(raw.finalEval) ?? NaN, raw.finalEvalKind),
        moveTree,
        review: normalizeSavedReview(raw.review, moves, startFen),
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

export interface LibraryState {
    games: SavedGame[];
    mutationBlocked: boolean;
    raw: string | null;
}

export function loadLibraryState(): LibraryState {
    let raw: string | null = null;
    try {
        // Read directly first: the general preference reader deliberately treats
        // inaccessible storage as absent, which is unsafe for library writes.
        raw = localStorage.getItem(GAME_LIBRARY_STORAGE_KEY);
        if (raw === null) {
            raw = localStorage.getItem(LEGACY_STORAGE_KEYS[GAME_LIBRARY_STORAGE_KEY]);
            if (raw !== null) readVersionedStorage(GAME_LIBRARY_STORAGE_KEY);
        }
        if (raw === null) return { games: [], mutationBlocked: false, raw };
        if (raw.length > MAX_LIBRARY_JSON_LENGTH) {
            return { games: [], mutationBlocked: true, raw };
        }
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return { games: [], mutationBlocked: true, raw };
        const games = normalizeSavedGames(parsed);
        const duplicateIds = new Set(games.map(game => game.id)).size !== games.length;
        return { games, mutationBlocked: games.length !== parsed.length || duplicateIds, raw };
    } catch {
        return { games: [], mutationBlocked: true, raw };
    }
}

const readAllResult = loadLibraryState;

function readAll(): SavedGame[] {
    return readAllResult().games;
}

function writeAll(games: SavedGame[]): boolean {
    try {
        const serialized = JSON.stringify(games);
        // Never report success for data the next read would refuse.
        if (serialized.length > MAX_LIBRARY_JSON_LENGTH) return false;
        localStorage.setItem(GAME_LIBRARY_STORAGE_KEY, serialized);
        return true;
    } catch {
        return false;
    }
}

export function createSavedGameId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Newest first, which is a convenience rather than a contract.
 *
 * Nothing downstream depends on it: the library panel sorts what it is handed
 * with its own comparator and a sort the reader chooses, and the position
 * explorer indexes by position and does not care about order. Reversing this
 * line is invisible to the app, which a mutation sweep confirms — it is an
 * equivalent mutant, not a gap in the tests.
 *
 * Left in because a caller reading "all games" is entitled to a sensible
 * order, and noted because the line looks load-bearing and is not.
 */
export function loadAllGames(): SavedGame[] {
    return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export type SaveGameResult =
    | { game: SavedGame; error: null }
    | { game: null; error: string };

export function saveGameWithResult(game: Omit<SavedGame, 'id' | 'savedAt'>): SaveGameResult {
    const saved = normalizeSavedGame({ ...game, id: createSavedGameId(), savedAt: Date.now() });
    if (!saved) return { game: null, error: 'This game could not be saved because its data is invalid.' };
    const { games, mutationBlocked } = readAllResult();
    if (mutationBlocked) {
        return { game: null, error: 'Your saved library could not be read. It has been preserved; export the current game as PGN to keep it separately.' };
    }
    if (games.length >= MAX_SAVED_GAMES) {
        return { game: null, error: `Your library is full (${MAX_SAVED_GAMES} games). Export a saved game before removing it to make room. Your existing games have been kept.` };
    }
    return writeAll([...games, saved])
        ? { game: saved, error: null }
        : { game: null, error: 'Could not save: browser storage is full, blocked, or the library is too large. Export this game as PGN to keep a copy.' };
}

/** Compatibility for callers that only need success/failure. */
export function saveGame(game: Omit<SavedGame, 'id' | 'savedAt'>): SavedGame | null {
    return saveGameWithResult(game).game;
}

/** Replace an explicitly selected study, checking the source again at the write. */
export function updateSavedGameWithResult(source: SavedGame, replacement: Omit<SavedGame, 'id' | 'savedAt'>): SaveGameResult {
    const fail = (error: string): SaveGameResult => ({ game: null, error });
    const state = loadLibraryState();
    if (state.mutationBlocked) return fail('Your saved library could not be read. Update was cancelled; the original data has been kept.');
    const index = state.games.findIndex(game => game.id === source.id);
    if (index < 0) return fail('This study is no longer in the library. Use Save to keep a new copy.');
    const current = state.games[index];
    // The label is edited independently in the library. Preserve its newest
    // value; a rename does not invalidate the board's source content.
    const content = (game: SavedGame) => JSON.stringify({ ...game, label: undefined });
    const expected = normalizeSavedGame(source);
    if (!expected || content(current) !== content(expected)) {
        return fail('This saved study changed since it was opened. Update was cancelled. Reload that version, or use Save to keep your board as a separate copy.');
    }
    const updated = normalizeSavedGame({ ...replacement, id: current.id, savedAt: current.savedAt, label: current.label });
    if (!updated) return fail('This study could not be updated because its data is invalid. The saved version has been kept.');
    const games = [...state.games]; games[index] = updated;
    return writeAll(games) ? { game: updated, error: null }
        : fail('Could not update: browser storage is full, blocked, or the study is too large. The saved version has been kept.');
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

/** Versioned, portable backup. Recovery downloads use LibraryState.raw instead. */
export function exportLibraryBackup(): string | null {
    const state = loadLibraryState();
    if (state.mutationBlocked) return null;
    return JSON.stringify({ format: 'web-xiangqi-library', version: 1, games: state.games });
}

export type LibraryRestorePreview = {
    added: number;
    duplicates: number;
    error: string | null;
};

function prepareLibraryRestore(text: string): LibraryRestorePreview & { games: SavedGame[] } {
    const failure = (error: string) => ({ games: [], added: 0, duplicates: 0, error });
    // Leave room for the versioned envelope around a maximum-size library.
    if (text.length > MAX_LIBRARY_JSON_LENGTH + 1024) return failure('This backup is too large.');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return failure('This file is not valid JSON.'); }
    if (!isRecord(parsed) || parsed.format !== 'web-xiangqi-library' || parsed.version !== 1 || !Array.isArray(parsed.games)) {
        return failure('Choose a version 1 Web Xiangqi library backup.');
    }
    if (parsed.games.length > MAX_SAVED_GAMES) return failure(`A library can hold at most ${MAX_SAVED_GAMES} games.`);
    const incoming = normalizeSavedGames(parsed.games);
    if (incoming.length !== parsed.games.length || new Set(incoming.map(game => game.id)).size !== incoming.length) {
        return failure('This backup contains invalid games or duplicate game IDs. Nothing was restored.');
    }
    const current = loadLibraryState();
    if (current.mutationBlocked) return failure('Your existing library could not be read. Download its recovery file before repairing browser storage.');
    const byId = new Map(current.games.map(game => [game.id, game]));
    const additions: SavedGame[] = [];
    let duplicates = 0;
    for (const game of incoming) {
        const existing = byId.get(game.id);
        if (!existing) additions.push(game);
        else if (JSON.stringify(existing) === JSON.stringify(game)) duplicates += 1;
        else return failure('A game in this backup conflicts with a saved game of the same ID. Nothing was restored.');
    }
    const games = [...current.games, ...additions];
    if (games.length > MAX_SAVED_GAMES) return failure(`Restoring these games would exceed the ${MAX_SAVED_GAMES}-game limit.`);
    if (JSON.stringify(games).length > MAX_LIBRARY_JSON_LENGTH) return failure('The combined library would be too large. Nothing was restored.');
    return { games, added: additions.length, duplicates, error: null };
}

export function previewLibraryRestore(text: string): LibraryRestorePreview {
    const { added, duplicates, error } = prepareLibraryRestore(text);
    return { added, duplicates, error };
}

export function restoreLibraryBackup(text: string): LibraryRestorePreview {
    // Re-read at confirmation time so a stale preview cannot replace newer data.
    const { games, added, duplicates, error } = prepareLibraryRestore(text);
    if (error) return { added: 0, duplicates, error };
    if (added && !writeAll(games)) return { added: 0, duplicates, error: 'Browser storage refused the restore. Your existing library has been kept.' };
    return { added, duplicates, error: null };
}

/** Append a reviewed collection in one write, re-reading storage at confirmation. */
export function saveGameCollection(incoming: Omit<SavedGame, 'id' | 'savedAt'>[]): { added: number; error: string | null } {
    const fail = (error: string) => ({ added: 0, error });
    if (!incoming.length || incoming.length > MAX_SAVED_GAMES) return fail(`Choose between 1 and ${MAX_SAVED_GAMES} games.`);
    const current = loadLibraryState();
    if (current.mutationBlocked) return fail('Your existing library could not be read. Download its recovery file before importing.');
    if (current.games.length + incoming.length > MAX_SAVED_GAMES) return fail(`These games would exceed the ${MAX_SAVED_GAMES}-game library limit. Nothing was imported.`);
    const savedAt = Date.now();
    const additions = incoming.map(game => normalizeSavedGame({ ...game, id: createSavedGameId(), savedAt }));
    if (additions.some(game => !game)) return fail('The collection contains invalid game data. Nothing was imported.');
    const games = [...current.games, ...additions as SavedGame[]];
    if (!writeAll(games)) return fail('Browser storage is full, blocked, or the combined library is too large. Nothing was imported.');
    return { added: additions.length, error: null };
}
