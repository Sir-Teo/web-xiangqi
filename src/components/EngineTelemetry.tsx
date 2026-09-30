import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import type { EngineTelemetryStore } from '../utils/engineTelemetryStore';
import { formatEngineDepthLabel, formatEngineTelemetry, formatEngineTelemetryDetail } from '../utils/engineTelemetry';

export const EngineSearchTelemetry = memo(function EngineSearchTelemetry({ store, ready, queued, searching, stalled, detail, label, secondary }: {
    store: EngineTelemetryStore; ready: boolean; queued: boolean; searching: boolean; stalled: boolean;
    detail?: string; label?: string; secondary?: string;
}) {
    const stats = useSyncExternalStore(store.subscribe, store.getStats, store.getStats);
    const description = detail ?? formatEngineTelemetryDetail(stats, queued, searching, ready);
    return <div className={`engine-stat${stalled ? ' engine-stat-stalled' : ''}`} title={description} aria-label={description}>
        <span>Search</span>
        <strong data-testid="engine-search-status">{label ?? formatEngineDepthLabel(stats, queued, searching, ready)}</strong>
        <em>{secondary ?? formatEngineTelemetry(stats, queued, searching)}</em>
    </div>;
});

export const EngineOutput = memo(function EngineOutput({ store }: { store: EngineTelemetryStore }) {
    const lines = useSyncExternalStore(store.subscribe, store.getOutput, store.getOutput);
    const element = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const node = element.current;
        if (node && node.clientHeight > 0) node.scrollTop = node.scrollHeight;
    }, [lines]);
    useEffect(() => {
        const node = element.current;
        if (!node || typeof ResizeObserver === 'undefined') return;
        let collapsed = node.clientHeight === 0;
        const observer = new ResizeObserver(() => {
            const nextCollapsed = node.clientHeight === 0;
            if (collapsed && !nextCollapsed) node.scrollTop = node.scrollHeight;
            collapsed = nextCollapsed;
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    const count = Math.min(lines.length, 20);
    const label = count ? `Raw engine UCI output, showing latest ${count} ${count === 1 ? 'line' : 'lines'}` : 'Raw engine UCI output, waiting for engine output';
    return <div className="engine-output-terminal" ref={element} role="log" aria-label={label} title={label}
        aria-live="off" aria-relevant="additions text" data-testid="engine-output-terminal">
        {lines.slice(-20).map((line, index) => <div key={index}>{line}</div>)}
        {!lines.length && <div>Waiting for engine output...</div>}
    </div>;
});
