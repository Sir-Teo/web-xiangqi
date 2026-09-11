/**
 * A size-capped cache that evicts what has gone longest unread.
 *
 * The cloud hooks each kept one of these. `useCloudBook` had it as a class
 * that refreshed an entry's place on every read; `useCloudPv` and
 * `useCloudRule` open-coded a plain `Map` with the same 200-entry cap and no
 * refresh, which is first-in-first-out rather than least-recently-used.
 *
 * The difference is not academic here. A `Map` keeps insertion order and
 * `set` on a key it already holds does *not* move it, so under FIFO the
 * entries evicted first are the oldest *fetched* — and in a game longer than
 * the cap those are the opening positions, which are exactly the ones a reader
 * returns to when they step back to the start. Each return then costs another
 * request to chessdb.cn: slower, and one more position leaving the machine in
 * an app that sends them only on request.
 */
export class BoundedLruCache<V> {
    private readonly entries = new Map<string, V>();
    private readonly limit: number;

    constructor(limit = 200) {
        this.limit = Math.max(1, Math.floor(limit));
    }

    has(key: string): boolean {
        return this.entries.has(key);
    }

    /** Reading an entry makes it the last one that will be evicted. */
    get(key: string): V | undefined {
        if (!this.entries.has(key)) return undefined;
        const hit = this.entries.get(key) as V;
        this.entries.delete(key);
        this.entries.set(key, hit);
        return hit;
    }

    set(key: string, value: V): void {
        this.entries.delete(key);
        this.entries.set(key, value);
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
    }

    get size(): number {
        return this.entries.size;
    }
}
