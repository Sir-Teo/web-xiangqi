import { describe, expect, it } from 'vitest';
import {
    describeAnalysisActivity,
    formatAnalysisActivity,
    isAnalysisActivityStalled,
    resolveAnalysisActivity,
    type AnalysisActivityInput,
} from './analysisActivity';

const running: AnalysisActivityInput = {
    engineEnabled: true,
    isReady: true,
    pageVisible: true,
    isSearchQueued: false,
    isSearching: true,
    deepSearchRunning: false,
};

describe('resolveAnalysisActivity', () => {
    it('reports a search that is running', () => {
        expect(resolveAnalysisActivity(running)).toBe('searching');
    });

    it('reports an engine with nothing to do', () => {
        expect(resolveAnalysisActivity({ ...running, isSearching: false })).toBe('idle');
    });

    it('prefers the queued search over the one still finishing', () => {
        // The interesting fact is that a newer position is waiting, not that
        // the engine is still emptying the old one.
        expect(resolveAnalysisActivity({ ...running, isSearchQueued: true })).toBe('queued');
    });

    it('says the engine is off before anything else', () => {
        expect(resolveAnalysisActivity({ ...running, engineEnabled: false, isReady: false })).toBe('engine-off');
    });

    /**
     * The one search that is not stopped by hiding the tab. Reporting "Paused"
     * over a search that is still deepening would be the only state here that
     * is actually wrong rather than merely uninformative.
     */
    it('does not call a running deep search paused', () => {
        expect(resolveAnalysisActivity({ ...running, pageVisible: false, deepSearchRunning: true })).toBe('searching');
        expect(isAnalysisActivityStalled(
            resolveAnalysisActivity({ ...running, pageVisible: false, deepSearchRunning: true })
        )).toBe(false);
    });

    it('still says paused when the hidden tab has only live analysis to lose', () => {
        expect(resolveAnalysisActivity({ ...running, pageVisible: false })).toBe('background');
    });

    /** A deep search that has finished while hidden leaves nothing running. */
    it('says paused again once the deep search is over', () => {
        expect(resolveAnalysisActivity({
            ...running, pageVisible: false, deepSearchRunning: false, isSearching: false,
        })).toBe('background');
    });

    it('says loading before it says paused', () => {
        expect(resolveAnalysisActivity({ ...running, isReady: false, pageVisible: false })).toBe('loading');
    });

    it('says paused for a backgrounded tab even while a search is still winding down', () => {
        // `stop` is sent on the way out but `isSearching` stays true until the
        // engine answers `bestmove`; without this the card flashes "Analyzing"
        // for a position nothing is going to report on.
        expect(resolveAnalysisActivity({ ...running, pageVisible: false })).toBe('background');
        expect(resolveAnalysisActivity({ ...running, pageVisible: false, isSearchQueued: true })).toBe('background');
    });
});

describe('what the user is told', () => {
    it('gives every state a word and a sentence', () => {
        const states = ['engine-off', 'loading', 'background', 'queued', 'searching', 'idle'] as const;
        for (const state of states) {
            expect(formatAnalysisActivity(state)).toBeTruthy();
            expect(describeAnalysisActivity(state)).toBeTruthy();
        }
    });

    it('explains the pause rather than leaving it to be guessed', () => {
        expect(formatAnalysisActivity('background')).toBe('Paused');
        expect(describeAnalysisActivity('background')).toContain('background');
        expect(describeAnalysisActivity('background')).toContain('resumes');
    });

    it('singles out the one state that will not resolve on its own', () => {
        expect(isAnalysisActivityStalled('background')).toBe(true);
        expect(isAnalysisActivityStalled('queued')).toBe(false);
        expect(isAnalysisActivityStalled('idle')).toBe(false);
        expect(isAnalysisActivityStalled('loading')).toBe(false);
    });
});
