/**
 * Minimal agent implementations for the XiangqiEnv.
 *
 * An "agent" is any object that implements:
 *
 *   interface Agent {
 *       selectAction(observation: Float32Array, legalActions: number[]): number;
 *   }
 *
 * This module ships with:
 *   - RandomAgent   – picks a uniformly random legal action (useful baseline)
 *   - GreedyAgent   – picks the action with the highest score from a value fn
 */

export interface Agent {
    selectAction(observation: Float32Array, legalActions: number[]): number;
}

// ─── RandomAgent ──────────────────────────────────────────────────────────────

/**
 * Selects a uniformly random legal action on every turn.
 * Useful as a baseline opponent and for smoke-testing environments.
 */
export class RandomAgent implements Agent {
    selectAction(_obs: Float32Array, legalActions: number[]): number {
        if (legalActions.length === 0) {
            throw new Error("RandomAgent: no legal actions available");
        }
        const idx = Math.floor(Math.random() * legalActions.length);
        return legalActions[idx];
    }
}

// ─── GreedyAgent ──────────────────────────────────────────────────────────────

/**
 * Selects the action with the highest score according to a user-supplied
 * scoring function.  Ties are broken randomly.
 *
 * @example
 * // Prefer captures (actions with higher action index tend toward far squares,
 * // but a real scoring fn would inspect the observation).
 * const agent = new GreedyAgent((obs, action) => Math.random());
 */
export class GreedyAgent implements Agent {
    constructor(
        private readonly scoreAction: (
            observation: Float32Array,
            action: number,
        ) => number,
    ) {}

    selectAction(observation: Float32Array, legalActions: number[]): number {
        if (legalActions.length === 0) {
            throw new Error("GreedyAgent: no legal actions available");
        }

        let bestScore = -Infinity;
        let bestActions: number[] = [];

        for (const action of legalActions) {
            const score = this.scoreAction(observation, action);
            if (score > bestScore) {
                bestScore   = score;
                bestActions = [action];
            } else if (score === bestScore) {
                bestActions.push(action);
            }
        }

        const idx = Math.floor(Math.random() * bestActions.length);
        return bestActions[idx];
    }
}
