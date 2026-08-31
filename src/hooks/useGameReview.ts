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

    const hydrateReview = useCallback((nextSummary: ReviewSummary | null) => {
        setSummary(nextSummary);
        setStatus(nextSummary ? 'done' : 'idle');
        setProgress(nextSummary ? 1 : 0);
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
        hydrateReview,
        cancelReview,
        resetReview,
    };
}
