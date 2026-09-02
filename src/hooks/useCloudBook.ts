import { useEffect, useState } from 'react';
import {
    CloudBookCache,
    buildCloudBookUrl,
    parseCloudBookResponse,
    type CloudBookMove,
} from '../utils/cloudBook';

export type CloudBookStatus = 'off' | 'loading' | 'ok' | 'unknown' | 'error';

export interface CloudBookState {
    status: CloudBookStatus;
    moves: CloudBookMove[];
    /** The position the reading is for, so a stale answer is never drawn. */
    fen: string;
}

/** Long enough that stepping through a game asks once per pause, not per ply. */
const CLOUD_BOOK_DEBOUNCE_MS = 350;
/** The service usually answers in about a second; past this it is not coming. */
const CLOUD_BOOK_TIMEOUT_MS = 8000;

const cache = new CloudBookCache(200);

/**
 * What the chessdb.cn cloud book says about `fen`, when the reader has asked.
 *
 * Nothing is fetched while `enabled` is false: the position is the only thing
 * that leaves the machine and it leaves only on request. Answers are cached
 * per FEN for the life of the page, so stepping back through a line the book
 * has already been asked about costs nothing and shows instantly; a failed
 * request is not cached, so a dropped connection is retried on the next visit.
 */
export function useCloudBook(fen: string, enabled: boolean): CloudBookState {
    const [state, setState] = useState<CloudBookState>({ status: 'off', moves: [], fen });

    useEffect(() => {
        if (!enabled) {
            setState({ status: 'off', moves: [], fen });
            return;
        }
        const cached = cache.get(fen);
        if (cached) {
            setState(cached.status === 'ok'
                ? { status: 'ok', moves: cached.moves, fen }
                : { status: 'unknown', moves: [], fen });
            return;
        }

        setState({ status: 'loading', moves: [], fen });
        const controller = new AbortController();
        let timeout: number | null = null;
        const timer = window.setTimeout(async () => {
            timeout = window.setTimeout(() => controller.abort(), CLOUD_BOOK_TIMEOUT_MS);
            try {
                const response = await fetch(buildCloudBookUrl(fen), { signal: controller.signal, cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const reading = parseCloudBookResponse(await response.text());
                if (reading.status === 'unreadable') throw new Error('unreadable reply');
                cache.set(fen, reading);
                if (controller.signal.aborted) return;
                setState(reading.status === 'ok'
                    ? { status: 'ok', moves: reading.moves, fen }
                    : { status: 'unknown', moves: [], fen });
            } catch {
                if (controller.signal.aborted) return;
                setState({ status: 'error', moves: [], fen });
            } finally {
                if (timeout !== null) window.clearTimeout(timeout);
            }
        }, CLOUD_BOOK_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
            if (timeout !== null) window.clearTimeout(timeout);
            controller.abort();
        };
    }, [enabled, fen]);

    return state;
}
