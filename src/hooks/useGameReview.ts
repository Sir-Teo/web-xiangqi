import { useCallback, useRef, useState } from 'react';
import type { MoveTreeNode } from './useXiangqi';

export const REVIEW_DEPTH = 10;

export type ReviewStatus = 'idle' | 'running' | 'done';

export interface ReviewSummary {
    totalMoves: number;
    accuracy: number;
    bestCount: number;
    goodCount: number;
    inaccuracyCount: number;
    mistakeCount: number;
    blunderCount: number;
}

type EvalOverrides = Map<string, number> | Record<string, number> | null | undefined;

function getEvalOverride(nodeId: string, evalOverrides: EvalOverrides) {
    if (!evalOverrides) return undefined;
    if (evalOverrides instanceof Map) {
        return evalOverrides.get(nodeId);
    }
    return evalOverrides[nodeId];
}

export function computeReviewSummary(
    activeLineNodeIds: string[],
    treeNodes: Record<string, MoveTreeNode>,
    evalOverrides?: EvalOverrides
): ReviewSummary {
    const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    let evaluated = 0;

    for (const nodeId of activeLineNodeIds) {
        const node = treeNodes[nodeId];
        const overrideEval = getEvalOverride(nodeId, evalOverrides);
        const currentEval = typeof overrideEval === 'number' ? overrideEval : node?.record?.evalScore;
        const parentOverride = node?.parentId ? getEvalOverride(node.parentId, evalOverrides) : undefined;
        const parentEval = node?.parentId
            ? (typeof parentOverride === 'number' ? parentOverride : treeNodes[node.parentId]?.record?.evalScore)
            : 0;
        if (typeof currentEval !== 'number' || typeof parentEval !== 'number') continue;
        evaluated++;
        const delta = Math.abs(currentEval - parentEval);
        if (delta <= 40) counts.best++;
        else if (delta <= 90) counts.good++;
        else if (delta <= 180) counts.inaccuracy++;
        else if (delta <= 320) counts.mistake++;
        else counts.blunder++;
    }

    const weights = { best: 100, good: 80, inaccuracy: 55, mistake: 30, blunder: 0 };
    const weightedSum =
        counts.best * weights.best + counts.good * weights.good +
        counts.inaccuracy * weights.inaccuracy + counts.mistake * weights.mistake;
    const accuracy = evaluated > 0 ? Math.round(weightedSum / evaluated) : 0;

    return { totalMoves: evaluated, accuracy, bestCount: counts.best, goodCount: counts.good,
        inaccuracyCount: counts.inaccuracy, mistakeCount: counts.mistake, blunderCount: counts.blunder };
}

/**
 * Lightweight review state manager.
 * App.tsx drives the engine; this hook manages review status + summary.
 */
export function useGameReview() {
    const [status, setStatus] = useState<ReviewStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [summary, setSummary] = useState<ReviewSummary | null>(null);

    const totalRef = useRef(0);

    const startReview = useCallback((totalSteps: number) => {
        totalRef.current = Math.max(0, totalSteps);
        setStatus('running');
        setProgress(0);
        setSummary(null);
        return totalRef.current > 0;
    }, []);

    const updateReviewProgress = useCallback((completedSteps: number, totalSteps?: number) => {
        if (typeof totalSteps === 'number') {
            totalRef.current = Math.max(0, totalSteps);
        }
        setProgress(totalRef.current > 0 ? completedSteps / totalRef.current : 1);
    }, []);

    const completeReview = useCallback((nextSummary: ReviewSummary) => {
        setSummary(nextSummary);
        setStatus('done');
        setProgress(1);
    }, []);

    const cancelReview = useCallback(() => {
        setStatus('idle');
        setProgress(0);
        setSummary(null);
    }, []);

    const resetReview = useCallback(() => {
        setStatus('idle');
        setProgress(0);
        setSummary(null);
    }, []);

    return {
        status,
        progress,
        summary,
        startReview,
        updateReviewProgress,
        completeReview,
        cancelReview,
        resetReview,
    };
}
