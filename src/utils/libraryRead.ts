import type { LibraryState, SavedGame } from './gameLibrary';
import { unpackCollectionGames, type PackedGame } from './moveTreeTransfer';

export function readLibraryInWorker(raw: string, signal: AbortSignal): Promise<Pick<LibraryState, 'games' | 'mutationBlocked'>> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
        const worker = new Worker(new URL('../workers/libraryRead.worker.ts', import.meta.url), { type: 'module' });
        let finished = false;
        const clean = () => { finished = true; worker.terminate(); clearTimeout(timer); signal.removeEventListener('abort', cancel); };
        const fail = (error: Error) => { if (!finished) { clean(); reject(error); } };
        const cancel = () => fail(new DOMException('Cancelled', 'AbortError'));
        const timer = setTimeout(() => fail(new Error('Library reader timed out')), 15_000);
        signal.addEventListener('abort', cancel, { once: true });
        worker.onerror = event => { event.preventDefault(); fail(new Error('Library reader unavailable')); };
        worker.onmessageerror = () => fail(new Error('Unreadable library response'));
        worker.onmessage = (event: MessageEvent<{ games: PackedGame<SavedGame>[]; mutationBlocked: boolean }>) => {
            if (finished) return;
            try {
                if (!Array.isArray(event.data.games) || typeof event.data.mutationBlocked !== 'boolean') throw new Error('Unreadable library response');
                const state = { games: unpackCollectionGames<SavedGame>(event.data.games), mutationBlocked: event.data.mutationBlocked };
                clean(); resolve(state);
            } catch { fail(new Error('Unreadable library response')); }
        };
        try { worker.postMessage(raw); } catch { fail(new Error('Library reader unavailable')); }
    });
}
