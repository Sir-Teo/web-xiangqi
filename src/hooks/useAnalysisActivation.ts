import { useLayoutEffect, useState } from 'react';
import { clearIsolationAnalysisResume, ISOLATION_RELOAD_EVENT, prepareIsolationAnalysisResume, readIsolationAnalysisResume } from '../utils/isolationReloadResume';

/** Keep an explicit analysis request through the worker's automatic reload. */
export function useAnalysisActivation() {
    const [requested, setRequested] = useState(readIsolationAnalysisResume);
    useLayoutEffect(() => { clearIsolationAnalysisResume(); }, []);
    useLayoutEffect(() => {
        const prepare = () => prepareIsolationAnalysisResume(requested);
        window.addEventListener(ISOLATION_RELOAD_EVENT, prepare);
        return () => window.removeEventListener(ISOLATION_RELOAD_EVENT, prepare);
    }, [requested]);
    return [requested, setRequested] as const;
}
