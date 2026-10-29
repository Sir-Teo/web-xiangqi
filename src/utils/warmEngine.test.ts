import { afterEach, expect, it, vi } from 'vitest';
import { createWarmEngineSlot, warmEngineDuration } from './warmEngine';

afterEach(() => vi.useRealTimers());
function engine() {
    const listeners = new Set<(line: string) => void>();
    return { postMessage: vi.fn(), terminate: vi.fn(), addMessageListener: (fn: (line: string) => void) => listeners.add(fn),
        removeMessageListener: (fn: (line: string) => void) => listeners.delete(fn), emit: (line: string) => listeners.forEach(fn => fn(line)), listeners };
}
it('stops a search and waits for its acknowledgement, then removes its listener on acquisition', () => {
    vi.useFakeTimers();
    const slot = createWarmEngineSlot(), instance = engine();
    slot.park(instance, 'same options', true, 15_000);
    expect(instance.postMessage).toHaveBeenCalledWith('stop');
    instance.emit('info depth 12'); instance.emit('bestmove a0a1');
    expect(slot.take('same options')).toBe(instance);
    expect(instance.listeners.size).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(instance.terminate).not.toHaveBeenCalled();
});
it('destroys mismatched, unacknowledged, expired and failed workers', () => {
    vi.useFakeTimers();
    const slot = createWarmEngineSlot();
    for (const action of ['mismatch', 'pending', 'expire', 'error']) {
        const instance = engine();
        slot.park(instance, 'key', action === 'pending', 100);
        if (action === 'mismatch') expect(slot.take('different hash/restart')).toBeNull();
        if (action === 'pending') expect(slot.take('key')).toBeNull();
        if (action === 'expire') vi.advanceTimersByTime(100);
        if (action === 'error') instance.emit('[worker-error] failed');
        expect(instance.terminate).toHaveBeenCalledTimes(1);
        expect(instance.listeners.size).toBe(0);
        expect(slot.take('key')).toBeNull();
    }
});
it('retains at most one worker and releases it on disposal', () => {
    const slot = createWarmEngineSlot(), first = engine(), second = engine();
    slot.park(first, 'key', false, 100); slot.park(second, 'key', false, 100);
    expect(first.terminate).toHaveBeenCalledTimes(1);
    slot.dispose(); slot.dispose();
    expect(second.terminate).toHaveBeenCalledTimes(1);
});
it('does not retain on mobile, unknown/low memory or large hash configurations', () => {
    expect(warmEngineDuration(8, false, 128)).toBe(15_000);
    for (const [memory, mobile, hash] of [[0, false, 64], [4, false, 16], [8, true, 32], [16, false, 256]] as const)
        expect(warmEngineDuration(memory, mobile, hash)).toBe(0);
});
