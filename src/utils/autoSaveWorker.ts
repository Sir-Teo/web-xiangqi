import { exceedsRecoveryMoveLimit, prepareAutoSavedGame, type AutoSaveInput, type PreparedAutoSave } from './autoSave';
import { packCollectionGames } from './moveTreeTransfer';

/** Compact games stay cheap; large annotated trees prepare away from input/rendering. */
export function shouldPrepareAutoSaveInWorker(game: AutoSaveInput): boolean {
    const pending = [...game.moveTree ?? []];
    let count = 0, text = 0;
    while (pending.length) {
        const node = pending.pop()!;
        count++; text += (node.comment?.length ?? 0) + (node.analysis ? 2048 : 0);
        if (count > 128 || text > 32 * 1024) return true;
        if (node.children) pending.push(...node.children);
    }
    return false;
}

let unavailable = false;
export async function prepareAutoSaveInWorker(game: AutoSaveInput, signal: AbortSignal, savedAt = Date.now()): Promise<PreparedAutoSave> {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (exceedsRecoveryMoveLimit(game)) return { result: 'too-large' };
    if (unavailable || typeof Worker === 'undefined') return prepareAutoSavedGame(game, savedAt);
    try {
        return await new Promise<PreparedAutoSave>((resolve, reject) => {
            const worker = new Worker(new URL('../workers/autoSave.worker.ts', import.meta.url), { type: 'module' });
            let finished = false;
            const clean = () => { finished = true; worker.terminate(); clearTimeout(timer); signal.removeEventListener('abort', cancel); };
            const fail = (error: Error) => { if (!finished) { clean(); reject(error); } };
            const cancel = () => fail(new DOMException('Cancelled', 'AbortError'));
            const timer = setTimeout(() => fail(new Error('Autosave preparation timed out')), 10_000);
            signal.addEventListener('abort', cancel, { once: true });
            worker.onerror = event => { event.preventDefault(); fail(new Error('Autosave worker unavailable')); };
            worker.onmessageerror = () => fail(new Error('Unreadable autosave response'));
            worker.onmessage = (event: MessageEvent<PreparedAutoSave>) => {
                if (finished) return;
                const result = event.data;
                if (!result || !['ready', 'failed', 'empty', 'too-large'].includes(result.result)
                    || (result.result === 'ready' && (typeof result.content !== 'string' || typeof result.serialized !== 'string'))) {
                    fail(new Error('Unreadable autosave response')); return;
                }
                clean(); resolve(result);
            };
            try { worker.postMessage({ game: packCollectionGames([game])[0], savedAt }); }
            catch { fail(new Error('Autosave worker unavailable')); }
        });
    } catch (error) {
        if (signal.aborted) throw error;
        unavailable = true;
        return prepareAutoSavedGame(game, savedAt);
    }
}
