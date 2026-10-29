export interface ReusableEngine {
    postMessage(command: string): void;
    addMessageListener(listener: (line: string) => void): void;
    removeMessageListener(listener: (line: string) => void): void;
    terminate(): unknown;
}

/** Retention is deliberately short and limited to machines reporting ample RAM. */
export function warmEngineDuration(memoryGB: number, mobileLike: boolean, hashMB: number): number {
    return memoryGB >= 8 && !mobileLike && hashMB <= 128 ? 15_000 : 0;
}

/** One idle worker, no background search. A stopped search must acknowledge before reuse. */
export function createWarmEngineSlot() {
    let slot: { engine: ReusableEngine; key: string; ready: boolean; expiresAt: number; timer: ReturnType<typeof setTimeout>; listener: (line: string) => void } | null = null;
    const dispose = () => {
        if (!slot) return;
        const previous = slot; slot = null;
        clearTimeout(previous.timer);
        previous.engine.removeMessageListener(previous.listener);
        try { void Promise.resolve(previous.engine.terminate()).catch(() => {}); } catch { /* Already terminated. */ }
    };
    return {
        dispose,
        park(engine: ReusableEngine, key: string, searching: boolean, duration: number) {
            dispose();
            if (duration <= 0) { try { void Promise.resolve(engine.terminate()).catch(() => {}); } catch { /* Already terminated. */ } return; }
            const listener = (line: string) => {
                if (slot?.engine !== engine) return;
                if (line.startsWith('[worker-error]')) dispose();
                else if (line.startsWith('bestmove') && !slot.ready) {
                    slot.ready = true;
                    clearTimeout(slot.timer);
                    slot.timer = setTimeout(dispose, Math.max(0, slot.expiresAt - Date.now()));
                }
            };
            slot = { engine, key, ready: !searching, expiresAt: Date.now() + duration, timer: setTimeout(dispose, searching ? Math.min(duration, 1000) : duration), listener };
            engine.addMessageListener(listener);
            if (searching) {
                try { engine.postMessage('stop'); } catch { dispose(); }
            }
        },
        take(key: string): ReusableEngine | null {
            if (!slot || slot.key !== key || !slot.ready || Date.now() >= slot.expiresAt) { dispose(); return null; }
            const previous = slot; slot = null;
            clearTimeout(previous.timer);
            previous.engine.removeMessageListener(previous.listener);
            return previous.engine;
        },
    };
}
