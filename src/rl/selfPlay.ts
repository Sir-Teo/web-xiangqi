/**
 * Self-play runner for the XiangqiEnv.
 *
 * Runs complete episodes between two agents and collects transitions and
 * episode-level statistics.
 *
 * @example
 * import { XiangqiEnv }  from "./XiangqiEnv";
 * import { RandomAgent } from "./agents";
 * import { runEpisode, runSelfPlay } from "./selfPlay";
 *
 * const env   = new XiangqiEnv();
 * const red   = new RandomAgent();
 * const black = new RandomAgent();
 *
 * const result = runEpisode(env, red, black);
 * console.log(result.outcome, result.ply, result.termination);
 *
 * const stats = runSelfPlay(env, red, black, 100);
 * console.log(stats); // { redWins, blackWins, draws, avgPly }
 */

import { XiangqiEnv }  from "./XiangqiEnv";
import { Agent }       from "./agents";
import { StepInfo }    from "./types";

// ─── types ────────────────────────────────────────────────────────────────────

/** A single (s, a, r, s', done) transition. */
export interface Transition {
    observation:     Float32Array;
    action:          number;
    reward:          number;
    nextObservation: Float32Array;
    done:            boolean;
    info:            StepInfo;
}

/** Summary of a completed episode. */
export interface EpisodeResult {
    /** "red" | "black" | "draw" */
    outcome:     string;
    /** Number of half-moves played. */
    ply:         number;
    /** Termination reason string from the last StepInfo. */
    termination: string;
    /** All transitions collected during the episode. */
    transitions: Transition[];
}

/** Aggregate statistics over multiple episodes. */
export interface SelfPlayStats {
    episodes:  number;
    redWins:   number;
    blackWins: number;
    draws:     number;
    avgPly:    number;
    terminationCounts: Record<string, number>;
}

// ─── runEpisode ───────────────────────────────────────────────────────────────

/**
 * Run a single episode to completion.
 *
 * @param env        - An XiangqiEnv instance (will be reset).
 * @param redAgent   - Agent that plays for red (side "w").
 * @param blackAgent - Agent that plays for black (side "b").
 * @param collectTransitions - Whether to store Transition objects (default true).
 *                             Set to false when only statistics are needed.
 */
export function runEpisode(
    env: XiangqiEnv,
    redAgent:   Agent,
    blackAgent: Agent,
    collectTransitions = true,
): EpisodeResult {
    let obs = env.reset();
    const transitions: Transition[] = [];
    let lastInfo: StepInfo = {
        termination:     "ongoing",
        movedSide:       "w",
        moveUci:         "",
        ply:             0,
        legalActionCount: 0,
    };

    while (!env.done) {
        const legalActions = env.legalActions();
        const agent  = env.currentSide === "w" ? redAgent : blackAgent;
        const action = agent.selectAction(obs, legalActions);

        const { observation: nextObs, reward, done, info } = env.step(action);
        lastInfo = info;

        if (collectTransitions) {
            transitions.push({
                observation:     obs,
                action,
                reward,
                nextObservation: nextObs,
                done,
                info,
            });
        }

        obs = nextObs;
    }

    // Determine episode outcome from the perspective of the board
    let outcome: string;
    if (lastInfo.termination === "checkmate") {
        outcome = lastInfo.movedSide === "w" ? "red" : "black";
    } else {
        outcome = "draw";
    }

    return {
        outcome,
        ply:         env.currentPly,
        termination: lastInfo.termination,
        transitions,
    };
}

// ─── runSelfPlay ──────────────────────────────────────────────────────────────

/**
 * Run `numEpisodes` episodes and return aggregate statistics.
 *
 * @param env        - XiangqiEnv instance.
 * @param redAgent   - Agent for red.
 * @param blackAgent - Agent for black.
 * @param numEpisodes - Number of episodes to play.
 * @param onEpisodeDone - Optional callback after each episode.
 */
export function runSelfPlay(
    env: XiangqiEnv,
    redAgent:   Agent,
    blackAgent: Agent,
    numEpisodes: number,
    onEpisodeDone?: (result: EpisodeResult, idx: number) => void,
): SelfPlayStats {
    let redWins   = 0;
    let blackWins = 0;
    let draws     = 0;
    let totalPly  = 0;
    const terminationCounts: Record<string, number> = {};

    for (let i = 0; i < numEpisodes; i++) {
        const result = runEpisode(env, redAgent, blackAgent, false);

        if      (result.outcome === "red")   redWins++;
        else if (result.outcome === "black") blackWins++;
        else                                 draws++;

        totalPly += result.ply;
        terminationCounts[result.termination] =
            (terminationCounts[result.termination] ?? 0) + 1;

        onEpisodeDone?.(result, i);
    }

    return {
        episodes: numEpisodes,
        redWins,
        blackWins,
        draws,
        avgPly: totalPly / numEpisodes,
        terminationCounts,
    };
}
