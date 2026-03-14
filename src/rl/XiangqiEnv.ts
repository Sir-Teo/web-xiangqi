/**
 * XiangqiEnv – a mini reinforcement-learning environment for Xiangqi.
 *
 * Design mirrors the OpenAI Gym / Gymnasium interface:
 *
 *   const env = new XiangqiEnv();
 *   let obs = env.reset();
 *
 *   while (!done) {
 *       const actions = env.legalActions();
 *       const action  = actions[Math.floor(Math.random() * actions.length)];
 *       const { observation, reward, done, info } = env.step(action);
 *       obs = observation;
 *   }
 *
 * Observation space : Float32Array[NUM_CHANNELS × 10 × 9]  (15 planes)
 * Action space      : integer in [0, 8100)  (from_sq * 90 + to_sq)
 * Reward            : +1 win for the acting player, −1 loss, 0 otherwise
 */

import {
    BoardState,
    Side,
    START_FEN,
    parseFenBoard,
    boardToFen,
    cloneBoardState,
    pieceSide,
    parseMove,
    validatePieceMove,
    hasAnyLegalMove,
    isInCheck,
    otherSide,
    squareToUci,
    legalMovesFrom,
} from "../utils/xiangqi";

import {
    BOARD_RANKS,
    BOARD_FILES,
    BOARD_SQUARES,
    NUM_CHANNELS,
    OBS_SIZE,
    ACTION_SPACE_SIZE,
    RED_PIECES,
    BLACK_PIECES,
    StepResult,
    StepInfo,
} from "./types";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Encode (file, rank) → flat square index [0, 89]. */
function squareIdx(file: number, rank: number): number {
    return rank * BOARD_FILES + file;
}

/** Decode flat square index → { file, rank }. */
function squareCoords(sq: number): { file: number; rank: number } {
    return { file: sq % BOARD_FILES, rank: Math.floor(sq / BOARD_FILES) };
}

/** Encode a (fromSq, toSq) pair as a single action integer. */
export function encodeAction(fromSq: number, toSq: number): number {
    return fromSq * BOARD_SQUARES + toSq;
}

/** Decode an action integer → { fromSq, toSq }. */
export function decodeAction(action: number): { fromSq: number; toSq: number } {
    return {
        fromSq: Math.floor(action / BOARD_SQUARES),
        toSq: action % BOARD_SQUARES,
    };
}

/** Convert an action integer to a UCI move string (e.g. "e0e1"). */
export function actionToUci(action: number): string {
    const { fromSq, toSq } = decodeAction(action);
    const from = squareCoords(fromSq);
    const to   = squareCoords(toSq);
    return squareToUci(from.file, from.rank) + squareToUci(to.file, to.rank);
}

/** Convert a UCI move string to an action integer. Returns -1 on failure. */
export function uciToAction(uci: string): number {
    const mv = parseMove(uci);
    if (!mv) return -1;
    return encodeAction(
        squareIdx(mv.fromFile, mv.fromRank),
        squareIdx(mv.toFile, mv.toRank),
    );
}

// ─── observation builder ───────────────────────────────────────────────────────

const PIECE_CHANNEL: Record<string, number> = {};
RED_PIECES.forEach((p, i) => { PIECE_CHANNEL[p] = i; });
BLACK_PIECES.forEach((p, i) => { PIECE_CHANNEL[p] = 7 + i; });

/**
 * Build a flat Float32Array observation from the current board state.
 * Layout: channel-major → [channel][rank][file]
 */
function buildObservation(board: BoardState, sideToMove: Side): Float32Array {
    const obs = new Float32Array(OBS_SIZE);

    for (let rank = 0; rank < BOARD_RANKS; rank++) {
        for (let file = 0; file < BOARD_FILES; file++) {
            const piece = board[rank][file];
            if (piece && piece in PIECE_CHANNEL) {
                const ch  = PIECE_CHANNEL[piece];
                const idx = ch * BOARD_RANKS * BOARD_FILES + rank * BOARD_FILES + file;
                obs[idx] = 1.0;
            }
        }
    }

    // Channel 14: side-to-move indicator (broadcast)
    const stmValue = sideToMove === "w" ? 1.0 : 0.0;
    const stmOffset = 14 * BOARD_RANKS * BOARD_FILES;
    obs.fill(stmValue, stmOffset, stmOffset + BOARD_RANKS * BOARD_FILES);

    return obs;
}

// ─── repetition tracking ──────────────────────────────────────────────────────

/**
 * Serialize the board + side-to-move into a compact string key for
 * repetition detection.  Using boardToFen keeps parity with the rest of
 * the codebase.
 */
function positionKey(board: BoardState, side: Side): string {
    return boardToFen(board, side);
}

// ─── XiangqiEnv ───────────────────────────────────────────────────────────────

export interface EnvOptions {
    /**
     * Starting FEN (board placement only, or full FEN).
     * Defaults to the standard opening position.
     */
    startFen?: string;
    /**
     * Maximum number of half-moves (plies) per episode before a draw is
     * declared.  Defaults to 300.
     */
    maxPly?: number;
}

export class XiangqiEnv {
    // ── configuration ──
    private readonly startFen: string;
    readonly maxPly: number;
    readonly actionSpaceSize = ACTION_SPACE_SIZE;
    readonly obsSize         = OBS_SIZE;

    // ── episode state ──
    private board!: BoardState;
    private sideToMove!: Side;
    private ply!: number;
    /** Counts half-moves since the last capture (for 50-move / draw rule). */
    private halfMoveClock!: number;
    /** Position frequency map for repetition detection. */
    private positionCounts!: Map<string, number>;
    private _done!: boolean;

    constructor(options: EnvOptions = {}) {
        this.startFen = options.startFen ?? START_FEN;
        this.maxPly   = options.maxPly   ?? 300;
        // Initialise lazily via reset()
        this.reset();
    }

    // ── public API ────────────────────────────────────────────────────────────

    /**
     * Start a new episode.
     * @returns Initial observation.
     */
    reset(): Float32Array {
        const fen   = this.startFen;
        const parts = fen.trim().split(/\s+/);
        this.board        = parseFenBoard(parts[0]);
        this.sideToMove   = (parts[1] === "b" ? "b" : "w") as Side;
        this.ply          = 0;
        this.halfMoveClock = 0;
        this.positionCounts = new Map();
        this._done        = false;

        const key = positionKey(this.board, this.sideToMove);
        this.positionCounts.set(key, 1);

        return buildObservation(this.board, this.sideToMove);
    }

    /**
     * Apply an action (integer from `legalActions()`).
     *
     * @param action - Encoded action integer.
     * @returns StepResult with (observation, reward, done, info).
     * @throws if the action is not legal in the current position.
     */
    step(action: number): StepResult {
        if (this._done) {
            throw new Error("Episode is over. Call reset() to start a new one.");
        }

        const uci  = actionToUci(action);
        const mv   = parseMove(uci);
        if (!mv) throw new Error(`Cannot parse action ${action} → "${uci}"`);

        const validation = validatePieceMove(this.board, mv, this.sideToMove);
        if (!validation.ok) {
            throw new Error(`Illegal action ${action} ("${uci}"): ${validation.reason}`);
        }

        // Apply the move
        const nextBoard = cloneBoardState(this.board);
        nextBoard[mv.toRank][mv.toFile]     = nextBoard[mv.fromRank][mv.fromFile];
        nextBoard[mv.fromRank][mv.fromFile] = "";

        const captured  = !!validation.captured;
        const movedSide = this.sideToMove;

        this.board      = nextBoard;
        this.sideToMove = otherSide(movedSide);
        this.ply       += 1;
        this.halfMoveClock = captured ? 0 : this.halfMoveClock + 1;

        // ── termination checks ────────────────────────────────────────────────
        let termination = "ongoing";
        let reward      = 0;

        const key = positionKey(this.board, this.sideToMove);
        const keyCount = (this.positionCounts.get(key) ?? 0) + 1;
        this.positionCounts.set(key, keyCount);

        const opponentHasMoves = hasAnyLegalMove(this.board, this.sideToMove);

        if (!opponentHasMoves) {
            const inCheck = isInCheck(this.board, this.sideToMove);
            if (inCheck) {
                // Checkmate – the side that just moved wins
                termination = "checkmate";
                reward = 1.0;  // reward is from the perspective of movedSide
            } else {
                // Stalemate – draw
                termination = "stalemate";
                reward = 0.0;
            }
            this._done = true;
        } else if (keyCount >= 3) {
            termination = "draw_repetition";
            reward      = 0.0;
            this._done  = true;
        } else if (this.halfMoveClock >= 120) {
            // 60 full moves (120 half-moves) without capture → draw
            termination = "draw_moves";
            reward      = 0.0;
            this._done  = true;
        } else if (this.ply >= this.maxPly) {
            termination = "draw_moves";
            reward      = 0.0;
            this._done  = true;
        }

        const legalCount = this._done
            ? 0
            : this.legalActions().length;

        const info: StepInfo = {
            termination,
            movedSide,
            moveUci: uci,
            ply: this.ply,
            legalActionCount: legalCount,
        };

        return {
            observation: buildObservation(this.board, this.sideToMove),
            reward,
            done: this._done,
            info,
        };
    }

    /**
     * Return all legal actions for the side to move as action integers.
     * Returns an empty array when the episode is over.
     */
    legalActions(): number[] {
        if (this._done) return [];

        const actions: number[] = [];
        for (let rank = 0; rank < BOARD_RANKS; rank++) {
            for (let file = 0; file < BOARD_FILES; file++) {
                const piece = this.board[rank][file];
                if (!piece || pieceSide(piece) !== this.sideToMove) continue;

                const targets = legalMovesFrom(this.board, file, rank, this.sideToMove);
                for (const t of targets) {
                    const fromSq = squareIdx(file, rank);
                    const toSq   = squareIdx(t.file, t.rank);
                    actions.push(encodeAction(fromSq, toSq));
                }
            }
        }
        return actions;
    }

    // ── read-only accessors ───────────────────────────────────────────────────

    /** Current observation without advancing the episode. */
    get observation(): Float32Array {
        return buildObservation(this.board, this.sideToMove);
    }

    /** Current side to move. */
    get currentSide(): Side {
        return this.sideToMove;
    }

    /** Number of half-moves played in this episode. */
    get currentPly(): number {
        return this.ply;
    }

    /** Whether the episode has ended. */
    get done(): boolean {
        return this._done;
    }

    /** Current board as a FEN string. */
    get fen(): string {
        return boardToFen(this.board, this.sideToMove, Math.floor(this.ply / 2) + 1);
    }
}
