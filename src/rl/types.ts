/**
 * Reinforcement Learning types for Xiangqi.
 *
 * Observation: Float32Array of shape [NUM_CHANNELS, 10, 9].
 *   Channels 0-6:  Red pieces  (R, N, B, A, K, C, P)
 *   Channels 7-13: Black pieces (r, n, b, a, k, c, p)
 *   Channel  14:   Side to move (1.0 = red, 0.0 = black, broadcast across all squares)
 *
 * Action: integer in [0, ACTION_SPACE_SIZE).
 *   Encoded as fromSquare * 90 + toSquare, where square = rank * 9 + file.
 */

export const BOARD_RANKS = 10;
export const BOARD_FILES = 9;
export const BOARD_SQUARES = BOARD_RANKS * BOARD_FILES; // 90

/** Number of feature-plane channels in the observation. */
export const NUM_CHANNELS = 15;

/** Total observation size (flattened). */
export const OBS_SIZE = NUM_CHANNELS * BOARD_RANKS * BOARD_FILES; // 1350

/** Total size of the discrete action space. */
export const ACTION_SPACE_SIZE = BOARD_SQUARES * BOARD_SQUARES; // 8100

/** Piece types in channel order. Uppercase = red, lowercase = black. */
export const RED_PIECES   = ["R", "N", "B", "A", "K", "C", "P"] as const;
export const BLACK_PIECES = ["r", "n", "b", "a", "k", "c", "p"] as const;

/** Environment step result. */
export interface StepResult {
    /** Flattened [NUM_CHANNELS × 10 × 9] observation after the step. */
    observation: Float32Array;
    /** Scalar reward for the acting player (+1 win, −1 loss, 0 draw/ongoing). */
    reward: number;
    /** Whether the episode has ended. */
    done: boolean;
    /** Extra diagnostics. */
    info: StepInfo;
}

export interface StepInfo {
    /** "ongoing" | "checkmate" | "stalemate" | "draw_repetition" | "draw_moves" */
    termination: string;
    /** Side that just moved ("w" | "b"). */
    movedSide: "w" | "b";
    /** UCI move string that was applied. */
    moveUci: string;
    /** Number of half-moves played so far. */
    ply: number;
    /** Number of legal actions available to the next player (0 if done). */
    legalActionCount: number;
}
