import { describe, expect, it } from 'vitest';
import { BoundedLruCache } from './boundedCache';

describe('BoundedLruCache', () => {
    it('gives back what it was given', () => {
        const cache = new BoundedLruCache<number>(3);
        cache.set('a', 1);
        expect(cache.get('a')).toBe(1);
        expect(cache.has('a')).toBe(true);
        expect(cache.get('missing')).toBeUndefined();
        expect(cache.has('missing')).toBe(false);
    });

    it('holds a value that is legitimately null or undefined', () => {
        // `useCloudPv` caches `null` to mean "asked, and the book has no line".
        // A cache that cannot tell that from a miss would ask again every time.
        const cache = new BoundedLruCache<string | null>(3);
        cache.set('a', null);
        expect(cache.has('a')).toBe(true);
        expect(cache.get('a')).toBeNull();
    });

    it('never grows past its limit', () => {
        const cache = new BoundedLruCache<number>(3);
        for (let i = 0; i < 50; i++) cache.set(`k${i}`, i);
        expect(cache.size).toBe(3);
        expect(cache.has('k49')).toBe(true);
        expect(cache.has('k0')).toBe(false);
    });

    it('does not count a rewrite as a new entry', () => {
        const cache = new BoundedLruCache<number>(3);
        cache.set('a', 1);
        cache.set('a', 2);
        cache.set('a', 3);
        expect(cache.size).toBe(1);
        expect(cache.get('a')).toBe(3);
    });

    it('evicts what has gone longest unread, not what was written longest ago', () => {
        // The whole reason this class exists. Under the plain-Map eviction the
        // cloud hooks used to open-code, reading 'a' would not save it: `Map`
        // keeps insertion order and a read does not touch it.
        const cache = new BoundedLruCache<number>(3);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        expect(cache.get('a')).toBe(1);   // 'a' is now the freshest
        cache.set('d', 4);                // pushes one out
        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
    });

    it('would have dropped it under first-in-first-out, which is the bug', () => {
        // The guard on the guard: the same sequence against a plain Map, so
        // the assertion above cannot pass for want of anything to distinguish.
        const map = new Map<string, number>();
        const put = (k: string, v: number) => {
            map.set(k, v);
            while (map.size > 3) map.delete(map.keys().next().value as string);
        };
        put('a', 1); put('b', 2); put('c', 3);
        map.get('a');
        put('d', 4);
        expect(map.has('a')).toBe(false);
        expect(map.has('b')).toBe(true);
    });

    it('survives a limit nobody meant', () => {
        for (const limit of [0, -5, 0.4, Number.NaN]) {
            const cache = new BoundedLruCache<number>(limit);
            cache.set('a', 1);
            cache.set('b', 2);
            expect(cache.size, `limit ${limit}`).toBeGreaterThanOrEqual(1);
            expect(cache.size, `limit ${limit}`).toBeLessThanOrEqual(2);
        }
    });

    it('protects the positions a reader keeps returning to', () => {
        // The shape that matters: a reader steps through a long game, then goes
        // back to work on the opening. Reading those positions has to be enough
        // to keep them, or every new position written while they work there
        // costs them another fetch of a position they are looking at.
        const LIMIT = 200;
        const lru = new BoundedLruCache<number>(LIMIT);
        for (let ply = 0; ply < LIMIT; ply++) lru.set(`ply${ply}`, ply);
        for (let ply = 0; ply < 20; ply++) lru.get(`ply${ply}`);      // back to the opening
        for (let ply = LIMIT; ply < LIMIT + 20; ply++) lru.set(`ply${ply}`, ply);
        const lost = Array.from({ length: 20 }, (_v, ply) => ply).filter((ply) => !lru.has(`ply${ply}`));
        expect(lost).toEqual([]);
    });

    it('and the plain Map would have thrown every one of them away', () => {
        // The same sequence under the eviction the two cloud hooks open-coded.
        const LIMIT = 200;
        const map = new Map<string, number>();
        const put = (k: string, v: number) => {
            map.set(k, v);
            while (map.size > LIMIT) map.delete(map.keys().next().value as string);
        };
        for (let ply = 0; ply < LIMIT; ply++) put(`ply${ply}`, ply);
        for (let ply = 0; ply < 20; ply++) map.get(`ply${ply}`);
        for (let ply = LIMIT; ply < LIMIT + 20; ply++) put(`ply${ply}`, ply);
        const lost = Array.from({ length: 20 }, (_v, ply) => ply).filter((ply) => !map.has(`ply${ply}`));
        expect(lost).toHaveLength(20);
    });
});
