const LOCK_NAME = 'xiangqi:library-write:v1';
let database: Promise<IDBDatabase> | undefined;
function lockDatabase(): Promise<IDBDatabase> {
    return database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open('xiangqi-library-coordination', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('writes');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { database = undefined; reject(request.error); };
        request.onblocked = () => { database = undefined; reject(new Error('Library coordination is blocked')); };
    });
}

/** All browser read/modify/write operations share one origin-wide lock. */
export async function withLibraryMutation<T>(action: () => T, failure: T): Promise<T> {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10_000);
    try {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return await navigator.locks.request(LOCK_NAME, { signal: controller.signal }, action);
        }
        // Read/write IDB transactions serialize across tabs even in browsers
        // without Web Locks. The library bytes retain their existing format.
        if (typeof indexedDB === 'undefined') return failure;
        const db = await Promise.race([
            lockDatabase(),
            new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Library lock timed out')), { once: true })),
        ]);
        return await new Promise<T>((resolve, reject) => {
            const transaction = db.transaction('writes', 'readwrite');
            let result: T;
            const abort = () => { try { transaction.abort(); } catch { /* Already finished. */ } };
            controller.signal.addEventListener('abort', abort, { once: true });
            transaction.objectStore('writes').get('lock').onsuccess = () => {
                try { result = action(); transaction.objectStore('writes').put(Date.now(), 'lock'); }
                catch { transaction.abort(); }
            };
            transaction.oncomplete = () => { controller.signal.removeEventListener('abort', abort); resolve(result); };
            transaction.onerror = transaction.onabort = () => { controller.signal.removeEventListener('abort', abort); reject(transaction.error); };
        });
    } catch { return failure; }
    finally { clearTimeout(deadline); }
}
export const LIBRARY_LOCK_ERROR = 'The library is busy or unavailable. Please retry; no changes were made.';
