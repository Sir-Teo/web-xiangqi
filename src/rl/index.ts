/**
 * Xiangqi Reinforcement Learning Environment
 *
 * Public API:
 *
 *   XiangqiEnv   – the environment (reset / step / legalActions)
 *   actionToUci  – decode action integer → UCI string
 *   uciToAction  – encode UCI string → action integer
 *   encodeAction – (fromSq, toSq) → action integer
 *   decodeAction – action integer → { fromSq, toSq }
 *
 *   RandomAgent  – selects a uniformly random legal move
 *   GreedyAgent  – selects highest-scored legal move
 *
 *   runEpisode   – run one episode to completion
 *   runSelfPlay  – run N episodes and collect statistics
 *
 *   Types: StepResult, StepInfo, Transition, EpisodeResult, SelfPlayStats
 *          BOARD_RANKS, BOARD_FILES, ACTION_SPACE_SIZE, OBS_SIZE, NUM_CHANNELS
 */

export { XiangqiEnv, encodeAction, decodeAction, actionToUci, uciToAction } from "./XiangqiEnv";
export type { EnvOptions }                                                    from "./XiangqiEnv";

export { RandomAgent, GreedyAgent }                                           from "./agents";
export type { Agent }                                                         from "./agents";

export { runEpisode, runSelfPlay }                                            from "./selfPlay";
export type { Transition, EpisodeResult, SelfPlayStats }                      from "./selfPlay";

export {
    BOARD_RANKS,
    BOARD_FILES,
    BOARD_SQUARES,
    NUM_CHANNELS,
    OBS_SIZE,
    ACTION_SPACE_SIZE,
    RED_PIECES,
    BLACK_PIECES,
} from "./types";
export type { StepResult, StepInfo }                                          from "./types";
