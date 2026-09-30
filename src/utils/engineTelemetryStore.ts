import type { EngineSearchStats } from '../hooks/useEngine';
/** Counter/log subscribers update independently from the board controller. */
export function createEngineTelemetryStore() {
    let stats: EngineSearchStats | null = null;
    let output: string[] = [];
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(listener => listener());
    return {
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        getStats: () => stats,
        getOutput: () => output,
        setStats: (next: EngineSearchStats | null | ((previous: EngineSearchStats | null) => EngineSearchStats | null)) => {
            stats = typeof next === 'function' ? next(stats) : next;
            notify();
        },
        setOutput: (next: string[]) => { output = next; notify(); },
    };
}
export type EngineTelemetryStore = ReturnType<typeof createEngineTelemetryStore>;
