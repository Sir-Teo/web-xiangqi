import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { SelectorStore } from '../utils/selectorStore';

export function useStoreSelector<T, V>(store: SelectorStore<T>, select: (snapshot: T) => V, equal: (left: V, right: V) => boolean = Object.is): V {
    const config = useRef({ select, equal });
    config.current = { select, equal };
    const cached = useRef<{ source: T; select: typeof select; value: V }>();
    const getSnapshot = useCallback(() => {
        const source = store.getSnapshot();
        const current = config.current;
        const previous = cached.current;
        if (previous?.source === source && previous.select === current.select) return previous.value;
        const next = current.select(source);
        const value = previous && current.equal(previous.value, next) ? previous.value : next;
        cached.current = { source, select: current.select, value };
        return value;
    }, [store]);
    return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
