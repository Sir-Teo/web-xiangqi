import { useCallback, useRef, useState } from 'react';
import type { ReviewSummary } from '../utils/review';

export type ReviewStatus = 'idle' | 'running' | 'done';

/**
 * Lightweight review state manager.
 * App.tsx drives the engine; this hook manages review status + summary.
 */
export function useGameReview() {
    const [status, setStatus] = useState<ReviewStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [summary, setSummary] = useState<ReviewSummary | null>(null);
    /**
     * The same progress in the units it is counted in. A percentage cannot say
     * how much work is left, and on a long game that is what a reader wants:
     * see `formatReviewProgressDetail`.
     */
    const [completedSteps, setCompletedSteps] = useState(0);
    const [totalSteps, setTotalSteps] = useState(0);

    const totalRef = useRef(0);

    const startReview = useCallback((totalSteps: number) => {
        totalRef.current = Math.max(0, totalSteps);
        setStatus('running');
        setProgress(0);
        setCompletedSteps(0);
        setTotalSteps(totalRef.current);
        setSummary(null);
        return totalRef.current > 0;
    }, []);

    const updateReviewProgress = useCallback((completed: number, total?: number) => {
        if (typeof total === 'number') {
            totalRef.current = Math.max(0, total);
            setTotalSteps(totalRef.current);
        }
        setCompletedSteps(completed);
        setProgress(totalRef.current > 0 ? completed / totalRef.current : 1);
    }, []);

    const completeReview = useCallback((nextSummary: ReviewSummary) => {
        setSummary(nextSummary);
        setStatus('done');
        setProgress(1);
        setCompletedSteps(totalRef.current);
    }, []);

    const hydrateReview = useCallback((nextSummary: ReviewSummary | null) => {
        setSummary(nextSummary);
        setStatus(nextSummary ? 'done' : 'idle');
        setProgress(nextSummary ? 1 : 0);
    }, []);

    const cancelReview = useCallback(() => {
        setStatus('idle');
        setProgress(0);
        setCompletedSteps(0);
        setTotalSteps(0);
        setSummary(null);
    }, []);

    const resetReview = useCallback(() => {
        setStatus('idle');
        setProgress(0);
        setCompletedSteps(0);
        setTotalSteps(0);
        setSummary(null);
    }, []);

    return {
        status,
        progress,
        completedSteps,
        totalSteps,
        summary,
        startReview,
        updateReviewProgress,
        completeReview,
        hydrateReview,
        cancelReview,
        resetReview,
    };
}
