import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { rowOffsets, visibleRowIndices } from '../utils/virtualRows';

const useBrowserLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Measured variable-height rows; active and focused controls keep their DOM nodes. */
export function useVirtualRows(keys: readonly string[], container: RefObject<HTMLDivElement>, activeIndex: number, keep: readonly number[]) {
    const enabled = keys.length > 100;
    const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map());
    const [viewport, setViewport] = useState({ top: Math.max(0, activeIndex * 36 - 250), height: 500 });
    const offsets = useMemo(() => rowOffsets(keys, measured), [keys, measured]);
    const state = useRef({ keys, offsets, enabled, viewport });
    state.current = { keys, offsets, enabled, viewport };
    const automaticTarget = useRef<number | null>(activeIndex >= 0 ? activeIndex : null);
    const frame = useRef<number | null>(null);
    const readViewport = useCallback(() => {
        const node = container.current;
        if (!node) return;
        // Read layout before scheduling React work. A state updater can run
        // during rendering, when DOM reads would force unfinished layout.
        const top = node.scrollTop, height = node.clientHeight || 500;
        setViewport(previous => previous.top === top && previous.height === height
            ? previous : { top, height });
    }, [container]);
    const onScroll = useCallback(() => {
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => { frame.current = null; readViewport(); });
    }, [readViewport]);
    const stopAutomaticScroll = useCallback(() => { automaticTarget.current = null; }, []);
    const scrollToIndex = useCallback((index: number) => {
        const node = container.current;
        const current = state.current;
        if (!node || index < 0 || index >= current.keys.length) return;
        automaticTarget.current = index;
        if (current.enabled) {
            // Resize/scroll observers keep this current. A layout read here
            // would flush the new move's DOM while React is still committing.
            const { height, top } = current.viewport;
            // Nearby moves already in view need no recentering or scroll
            // write. Distant jumps still mount and reveal their target.
            if (current.offsets[index] >= top && current.offsets[index + 1] <= top + height) return;
            const nextTop = Math.max(0, current.offsets[index] - height * .4);
            node.scrollTop = nextTop;
            setViewport(previous => previous.top === nextTop ? previous : { ...previous, top: nextTop });
        }
    }, [container]);
    const keySignature = useMemo(() => keys.join('\n'), [keys]);
    useEffect(() => {
        const currentKeys = new Set(state.current.keys);
        setMeasured(previous => {
            if ([...previous.keys()].every(key => currentKeys.has(key))) return previous;
            return new Map([...previous].filter(([key]) => currentKeys.has(key)));
        });
    }, [keySignature]);
    useBrowserLayout(() => { if (activeIndex >= 0) scrollToIndex(activeIndex); }, [activeIndex, keySignature, scrollToIndex]);
    useBrowserLayout(() => {
        if (automaticTarget.current !== null && enabled) scrollToIndex(automaticTarget.current);
    }, [measured, enabled, scrollToIndex]);
    useEffect(() => {
        const node = container.current;
        if (!node) return;
        let width = node.clientWidth;
        const observer = new ResizeObserver(() => {
            if (node.clientWidth !== width) { width = node.clientWidth; setMeasured(previous => previous.size ? new Map() : previous); }
            readViewport();
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [container, readViewport, enabled]);
    const indices = useMemo(() => enabled ? visibleRowIndices(offsets, viewport.top, viewport.height, keep) : keys.map((_, index) => index),
        [enabled, offsets, viewport.top, viewport.height, keep, keys]);
    const mounted = indices.join(',');
    useBrowserLayout(() => {
        const node = container.current;
        if (!node || !enabled) return;
        const observer = new ResizeObserver(entries => {
            setMeasured(previous => {
                const next = new Map(previous);
                let changed = false;
                for (const entry of entries) {
                    const key = (entry.target as HTMLElement).dataset.virtualKey;
                    const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
                    if (key && height > 0 && Math.abs((previous.get(key) ?? 36) - height) > .5) {
                        next.set(key, height); changed = true;
                    }
                }
                return changed ? next : previous;
            });
        });
        node.querySelectorAll<HTMLElement>('[data-virtual-key]').forEach(row => observer.observe(row));
        return () => observer.disconnect();
    }, [container, enabled, mounted]);
    useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
    return { indices, offsets, enabled, scrollToIndex, onScroll, stopAutomaticScroll };
}
