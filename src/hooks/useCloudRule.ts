import { useEffect, useState } from 'react';
import {
    CLOUD_RULE_MIN_MOVES,
    currentCloudRuleState,
    type CloudRuleState,
    buildCloudRuleUrl,
    parseCloudRuleResponse,
    summarizeCloudRule,
} from '../utils/cloudRule';
import { BoundedLruCache } from '../utils/boundedCache';

export type { CloudRuleState } from '../utils/cloudRule';

const CLOUD_RULE_DEBOUNCE_MS = 350;
const CLOUD_RULE_TIMEOUT_MS = 8000;

/** `null` is a cached "chessdb has no ruling for this line". */
const cache = new BoundedLruCache<{ banned: string[]; drawing: string[] } | null>(200);

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
        if (cache.has(key)) {
            const cached = cache.get(key) ?? null;
            setState(cached
                ? { status: 'ok', ...cached, key }
                : { status: 'unknown', banned: [], drawing: [], key });
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
                if (reading.status === 'unreadable' || reading.status === 'invalid') throw new Error('unavailable ruling');
                // `unknown` is cached as `null`: the service answered, so asking
                // again on every return to this line would buy nothing and send
                // the moves off the machine again for it.
                const summary = reading.status === 'ok' ? summarizeCloudRule(reading.moves)
                    : reading.status === 'unknown' ? null
                        : { banned: [], drawing: [] };
                cache.set(key, summary);
                if (controller.signal.aborted) return;
                setState(summary
                    ? { status: 'ok', ...summary, key }
                    : { status: 'unknown', banned: [], drawing: [], key });
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

    return currentCloudRuleState(state, key, enabled && wanted && moves.length >= CLOUD_RULE_MIN_MOVES);
}
