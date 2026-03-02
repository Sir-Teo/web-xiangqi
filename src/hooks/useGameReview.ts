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

export function computeReviewSummary(
    activeLineNodeIds: string[],
    treeNodes: Record<string, MoveTreeNode>
): ReviewSummary {
    const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    let evaluated = 0;

    for (const nodeId of activeLineNodeIds) {
        const node = treeNodes[nodeId];
        const currentEval = node?.record?.evalScore;
        const parentEval = node?.parentId ? treeNodes[node.parentId]?.record?.evalScore : 0;
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
 * App.tsx drives the engine; this hook manages the queue + status.
 */
export function useGameReview() {
    const [status, setStatus] = useState<ReviewStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [summary, setSummary] = useState<ReviewSummary | null>(null);

    // nodeIds still waiting for an engine eval
    const queueRef = useRef<string[]>([]);
    const totalRef = useRef(0);

    const getNextNodeId = useCallback((): string | null => {
        return queueRef.current[0] ?? null;
    }, []);

    const advanceQueue = useCallback(() => {
        queueRef.current = queueRef.current.slice(1);
        const done = totalRef.current - queueRef.current.length;
        setProgress(done / Math.max(1, totalRef.current));
        return queueRef.current[0] ?? null; // next nodeId or null if done
    }, []);

    const beginReview = useCallback((
        activeLineNodeIds: string[],
        treeNodes: Record<string, MoveTreeNode>
    ) => {
        const queue = activeLineNodeIds.filter((nodeId) => {
            const node = treeNodes[nodeId];
            return node?.record && typeof node.record.evalScore !== 'number';
        });

        if (queue.length === 0) {
            const s = computeReviewSummary(activeLineNodeIds, treeNodes);
            setSummary(s);
            setStatus('done');
            return false; // nothing to do
        }

        queueRef.current = queue;
        totalRef.current = queue.length;
        setStatus('running');
        setProgress(0);
        setSummary(null);
        return true; // review started, caller should kick off first search
    }, []);

    const finishReview = useCallback((
        activeLineNodeIds: string[],
        treeNodes: Record<string, MoveTreeNode>
    ) => {
        const s = computeReviewSummary(activeLineNodeIds, treeNodes);
        setSummary(s);
        setStatus('done');
        setProgress(1);
        queueRef.current = [];
    }, []);

    const cancelReview = useCallback(() => {
        queueRef.current = [];
        setStatus('idle');
    }, []);

    const resetReview = useCallback(() => {
        queueRef.current = [];
        setStatus('idle');
        setProgress(0);
        setSummary(null);
    }, []);

    return {
        status,
        progress,
        summary,
        getNextNodeId,
        advanceQueue,
        beginReview,
        finishReview,
        cancelReview,
        resetReview,
    };
}
