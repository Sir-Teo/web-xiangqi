export const ISOLATION_RELOAD_EVENT = 'web-xiangqi:before-isolation-reload';
const RESUME_ANALYSIS_KEY = 'web-xiangqi:resume-analysis-once';
type ResumeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Read without consuming: React can call a state initializer twice. */
export function readIsolationAnalysisResume(storage?: ResumeStorage, href?: string): boolean {
    try {
        const url = href ?? location.href;
        return Boolean(url) && (storage ?? sessionStorage).getItem(RESUME_ANALYSIS_KEY) === url;
    } catch { return false; }
}

/** Consume after mounting, so an ordinary reload does not start a download. */
export function clearIsolationAnalysisResume(storage?: ResumeStorage): void {
    try { (storage ?? sessionStorage).removeItem(RESUME_ANALYSIS_KEY); } catch { /* optional browser storage */ }
}

export function prepareIsolationAnalysisResume(requested: boolean, storage?: ResumeStorage, href?: string): void {
    try {
        const target = storage ?? sessionStorage;
        if (requested) target.setItem(RESUME_ANALYSIS_KEY, href ?? location.href);
        else target.removeItem(RESUME_ANALYSIS_KEY);
    } catch { /* The automatic reload remains usable without a resume marker. */ }
}
