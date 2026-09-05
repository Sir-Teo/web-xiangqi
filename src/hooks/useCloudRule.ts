import { useEffect, useState } from 'react';
import {
    CLOUD_RULE_MIN_MOVES,
    buildCloudRuleUrl,
    parseCloudRuleResponse,
    summarizeCloudRule,
} from '../utils/cloudRule';

export interface CloudRuleState {
    status: 'off' | 'loading' | 'ok' | 'error';
    /** Moves the rules forbid here: the side to move loses by playing one. */
    banned: string[];
    /** Moves that would make the repetition a draw. */
    drawing: string[];
    /** The line the answer is for, so a stale one is never drawn. */
    key: string;
}

const CLOUD_RULE_DEBOUNCE_MS = 350;
const CLOUD_RULE_TIMEOUT_MS = 8000;

const cache = new Map<string, { banned: string[]; drawing: string[] }>();
const CACHE_LIMIT = 200;

/**
 * What chessdb.cn rules about the moves of the position on screen, asked only
 * while `wanted` -- the position has stood here before -- and only when the
 * reader has the cloud book on. Answers are cached per line for the life of
 * the page; a failed request is not, so it is retried on the next visit.
 */
export function useCloudRule(rootFen: string, moves: string[], wanted: boolean, enabled: boolean): CloudRuleState {
    const key = `${rootFen}|${moves.join(' ')}`;
    const [state, setState] = useState<CloudRuleState>({ status: 'off', banned: [], drawing: [], key });

    useEffect(() => {
        if (!enabled || !wanted || moves.length < CLOUD_RULE_MIN_MOVES) {
            setState({ status: 'off', banned: [], drawing: [], key });
            return;
        }
        const cached = cache.get(key);
        if (cached) {
            setState({ status: 'ok', ...cached, key });
            return;
        }

        setState({ status: 'loading', banned: [], drawing: [], key });
        const controller = new AbortController();
        let timeout: number | null = null;
        const timer = window.setTimeout(async () => {
            timeout = window.setTimeout(() => {
                // A deadline is a visible failure; cleanup cancellation is silent.
                controller.abort();
                setState({ status: 'error', banned: [], drawing: [], key });
            }, CLOUD_RULE_TIMEOUT_MS);
            try {
                const response = await fetch(buildCloudRuleUrl(rootFen, moves), { signal: controller.signal, cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const reading = parseCloudRuleResponse(await response.text());
                if (controller.signal.aborted) return;
                if (reading.status === 'unreadable') throw new Error('unreadable reply');
                const summary = reading.status === 'ok' ? summarizeCloudRule(reading.moves) : { banned: [], drawing: [] };
                cache.set(key, summary);
                while (cache.size > CACHE_LIMIT) {
                    const oldest = cache.keys().next().value;
                    if (oldest === undefined) break;
                    cache.delete(oldest);
                }
                if (controller.signal.aborted) return;
                setState({ status: 'ok', ...summary, key });
            } catch {
                if (controller.signal.aborted) return;
                setState({ status: 'error', banned: [], drawing: [], key });
            } finally {
                if (timeout !== null) window.clearTimeout(timeout);
            }
        }, CLOUD_RULE_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
            if (timeout !== null) window.clearTimeout(timeout);
            controller.abort();
        };
        // `moves` is re-derived every render; `key` is its identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, wanted, key, rootFen]);

    return state;
}
