/**
 * What the analysis engine is doing right now, in one answer.
 *
 * Three places tell the user this -- the graph's State card, the engine
 * dashboard's Search card and the status line along the bottom -- and they
 * each decided it from a different subset of the same five booleans. The graph
 * card knew about `engineEnabled` and `isSearching`; the bottom line knew about
 * `isReady` and `isSearchQueued`; neither knew that live analysis stops while
 * the tab is in the background, so a backgrounded tab reported "Engine ready"
 * and "Idle" and looked exactly like an engine with nothing to do.
 *
 * That case is not hypothetical. `App.tsx` stops the search on
 * `visibilitychange` and the analysis effect refuses to queue one while
 * `isPageVisible` is false, which is right -- a hidden tab should not be
 * burning threads -- but it left the board frozen with no reason given. A
 * second monitor, a minimised window, or a browser that reports an occluded
 * tab as hidden all reach it.
 */
export type AnalysisActivity =
    | 'analysis-off'
    | 'loading'
    | 'background'
    | 'queued'
    | 'searching'
    | 'idle';

export interface AnalysisActivityInput {
    /** Analysis is switched off entirely -- Play mode runs without the engine. */
    engineEnabled: boolean;
    /** The worker has answered `readyok`. */
    isReady: boolean;
    /** `document.hidden` is false. */
    pageVisible: boolean;
    /** A search is waiting on the debounce or on the running one to finish. */
    isSearchQueued: boolean;
    /** A `go` is outstanding. */
    isSearching: boolean;
    /**
     * A deep or infinite search is running -- the one search that is not
     * stopped when the tab goes to the background, because the reader asked
     * for it by name. Required rather than optional: every caller has to decide
     * what it means for them, and the answer is `false` for all of the ones
     * that are not the analysis panel.
     */
    deepSearchRunning: boolean;
    /**
     * A Game Review pass is running -- the other search the tab going away
     * does not stop. `App.tsx` returns early from `visibilitychange` for a
     * review exactly as it does for a deep search, and for the same reason:
     * the reader started it by hand and expects it finished, not abandoned
     * one move short. Reporting "Paused" over it is the same lie, and it is
     * the one this file was written to stop telling.
     */
    reviewRunning: boolean;
}

/**
 * Ordered most decisive first. `background` outranks `searching` because
 * stopping a search is asynchronous: `stop` is sent on the way out and
 * `isSearching` stays true until the engine answers `bestmove`, so a hidden tab
 * would otherwise report "Analyzing" for the moment in between.
 *
 * A deep search is the exception to that exception. It is not stopped when the
 * tab goes away, so `isSearching` staying true is not a straggler -- it is the
 * truth, and "Paused" would be the lie.
 *
 * A running review is the same exception, and was missed when this was
 * written: `visibilitychange` has always returned early for both, but only the
 * deep search had an input here, so hiding the tab mid-review put "Paused" and
 * a still-advancing progress bar on screen together.
 */
export function resolveAnalysisActivity(input: AnalysisActivityInput): AnalysisActivity {
    if (!input.engineEnabled) return 'analysis-off';
    if (!input.isReady) return 'loading';
    if (!input.pageVisible) return input.deepSearchRunning || input.reviewRunning ? 'searching' : 'background';
    if (input.isSearchQueued) return 'queued';
    if (input.isSearching) return 'searching';
    return 'idle';
}

const ACTIVITY_LABELS: Record<AnalysisActivity, string> = {
    /**
     * "Analysis off", not "Engine off". In Play mode the engine is running --
     * it is the thing playing the moves, and the top bar says "Engine ready"
     * two hundred pixels above this card. What is off is the live evaluation of
     * the position on screen, which is what this state has always meant: the
     * input is named `engineEnabled` but its own comment says "Play mode runs
     * without the engine", and the hint below already says "Switch to Analysis".
     * The label was the only part still claiming the engine was off.
     */
    'analysis-off': 'Analysis off',
    loading: 'Loading engine',
    background: 'Paused',
    queued: 'Queued',
    searching: 'Analyzing',
    idle: 'Idle',
};

/** The short word that goes in a stat card. */
export function formatAnalysisActivity(activity: AnalysisActivity): string {
    return ACTIVITY_LABELS[activity];
}

const ACTIVITY_HINTS: Record<AnalysisActivity, string> = {
    'analysis-off': 'Switch to Analysis to evaluate this position.',
    loading: 'The engine is still starting up.',
    background: 'Analysis pauses while this tab is in the background, and resumes when you come back.',
    queued: 'A search is waiting for the engine.',
    searching: 'The engine is searching this position.',
    idle: 'The engine has finished this position.',
};

/**
 * The sentence behind the word. `background` is the one that has to be said out
 * loud: every other state either explains itself or resolves on its own.
 */
export function describeAnalysisActivity(activity: AnalysisActivity): string {
    return ACTIVITY_HINTS[activity];
}

/** Whether the state is one the user should be told about rather than left to infer. */
export function isAnalysisActivityStalled(activity: AnalysisActivity): boolean {
    return activity === 'background';
}
