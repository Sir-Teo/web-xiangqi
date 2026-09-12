import { readCloudResponse } from '../utils/cloudResponse';
import { useCallback, useEffect, useState } from 'react';
import { buildCloudPvUrl, parseCloudPvResponse, type CloudPvReading } from '../utils/cloudPv';
import { BoundedLruCache } from '../utils/boundedCache';

export type CloudPvStatus = 'off' | 'loading' | 'ok' | 'unknown' | 'error';

export interface CloudPvState {
    status: CloudPvStatus;
    line: CloudPvReading | null;
    /** The position the reading is for, so a stale one is never drawn. */
    fen: string;
}

const CLOUD_PV_DEBOUNCE_MS = 350;
const CLOUD_PV_TIMEOUT_MS = 8000;
const cache = new BoundedLruCache<CloudPvReading | null>(200);

/**
 * The cloud book's line for `fen`, under the same switch as the book itself:
 * `useCloudBook` sends the position, and this sends the same position to
 * the same service, so a reader who has turned the book on has already
 * agreed to it. Cached per FEN for the life of the page; a failed request is
 * not cached, so it is retried on the next visit.
 */
export function useCloudPv(fen: string, enabled: boolean): CloudPvState & { retry: () => void } {
    const [state, setState] = useState<CloudPvState>({ status: 'off', line: null, fen });
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt(value => value + 1), []);

    useEffect(() => {
        if (!enabled) {
            setState({ status: 'off', line: null, fen });
            return;
        }
        if (cache.has(fen)) {
            const cached = cache.get(fen) ?? null;
            setState(cached ? { status: 'ok', line: cached, fen } : { status: 'unknown', line: null, fen });
            return;
        }

        setState({ status: 'loading', line: null, fen });
        const controller = new AbortController();
        let timeout: number | null = null;
        const timer = window.setTimeout(async () => {
            timeout = window.setTimeout(() => {
                controller.abort();
                setState({ status: 'error', line: null, fen });
            }, CLOUD_PV_TIMEOUT_MS);
            try {
                const response = await fetch(buildCloudPvUrl(fen), { signal: controller.signal, cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = parseCloudPvResponse(await readCloudResponse(response));
                if (controller.signal.aborted) return;
                if (result.status === 'unreadable' || result.status === 'invalid') throw new Error('unavailable line');
                const line = result.status === 'ok' ? result.line : null;
                cache.set(fen, line);
                if (controller.signal.aborted) return;
                setState(line ? { status: 'ok', line, fen } : { status: 'unknown', line: null, fen });
            } catch {
                if (controller.signal.aborted) return;
                setState({ status: 'error', line: null, fen });
            } finally {
                if (timeout !== null) window.clearTimeout(timeout);
            }
        }, CLOUD_PV_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
            if (timeout !== null) window.clearTimeout(timeout);
            controller.abort();
        };
    }, [enabled, fen, attempt]);

    return { ...state, retry };
}
