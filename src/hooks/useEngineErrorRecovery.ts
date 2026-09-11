import { useCallback, useEffect, useRef } from 'react';

/** Let navigation finish before replacing a worker whose download was cancelled. */
export function useEngineErrorRecovery(
    recover: (message: string) => void,
    enabled: boolean,
    sessionKey: string,
) {
    const recoverRef = useRef(recover);
    const lastRecoveryAtRef = useRef(0);
    const reportRef = useRef<((message: string) => void) | null>(null);
    useEffect(() => { recoverRef.current = recover; }, [recover]);

    useEffect(() => {
        if (!enabled) return;
        let timer: number | null = null;
        let pending: string | null = null;
        let suspended = false;
        const cancelTimer = () => {
            if (timer !== null) window.clearTimeout(timer);
            timer = null;
        };
        const schedule = () => {
            if (suspended || timer !== null || pending === null) return;
            // WebKit can cancel worker fetches before pagehide. Immediate
            // recovery then attempts a new worker in a departing document.
            timer = window.setTimeout(() => {
                timer = null;
                const message = pending;
                pending = null;
                if (message !== null) {
                    lastRecoveryAtRef.current = Date.now();
                    recoverRef.current(message);
                }
            }, Math.max(250, 1000 - (Date.now() - lastRecoveryAtRef.current)));
        };
        reportRef.current = message => {
            pending ??= message;
            schedule();
        };
        const hide = () => { suspended = true; cancelTimer(); };
        const show = () => { suspended = false; schedule(); };
        window.addEventListener('pagehide', hide);
        window.addEventListener('pageshow', show);
        return () => {
            cancelTimer();
            pending = null;
            reportRef.current = null;
            window.removeEventListener('pagehide', hide);
            window.removeEventListener('pageshow', show);
        };
    }, [enabled, sessionKey]);

    return useCallback((message: string) => reportRef.current?.(message), []);
}
