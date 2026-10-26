import { describe, expect, it } from 'vitest';
import { MAX_MOVE_IMPORT_TEXT_LENGTH, extractUciMoveLine, extractUciMoveTree } from './moveImport';

// Keep wall-clock checks out of the parallel semantic suite. A busy test
// worker can exceed the test timeout even when the parser remains linear.
describe('coordinate import performance', () => {
    // Stripping tags and comments with a regex backtracked from every unclosed
    // bracket, which is quadratic: 80k of them took nearly two seconds, and the
    // importer accepts 200k.
    const brackets = (n: number) => '{'.repeat(n);

    it('scans the largest accepted paste quickly', () => {
        const text = brackets(MAX_MOVE_IMPORT_TEXT_LENGTH);
        const started = performance.now();
        extractUciMoveLine(text);
        extractUciMoveTree(text);
        expect(performance.now() - started).toBeLessThan(1000);
    });

    it('grows about linearly rather than quadratically', () => {
        const once = (text: string) => {
            const started = performance.now();
            extractUciMoveLine(text);
            extractUciMoveTree(text);
            return performance.now() - started;
        };
        /**
         * The fastest of several runs, not one run. A single timing carries
         * whatever else the machine was doing, and this comparison is between
         * two of them, so the noise lands twice. The cleanest run is the least
         * contaminated estimate of the work itself.
         *
         * There used to be a `Math.max(small, 0.5)` floor here, and the small
         * case measures about 0.17ms -- so the floor always won and the ratio
         * quietly became `large < 12ms`, an assertion about this machine's
         * speed wearing a complexity assertion's name. It failed on a busy
         * machine at a ratio of 45 while the algorithm was perfectly linear,
         * and it would have passed a genuinely quadratic rewrite that still
         * came in under 12ms. Absolute speed is the sibling test above; this
         * one is about shape.
         */
        const best = (n: number, rounds = 7) => {
            const text = brackets(n);
            once(text);
            let fastest = Infinity;
            for (let round = 0; round < rounds; round += 1) fastest = Math.min(fastest, once(text));
            return fastest;
        };
        const small = best(20_000);
        const large = best(160_000);
        // Eight times the input. Linear would be ~8x; quadratic would be ~64x.
        // Measured 5.6-9.8 idle and 6.6-7.0 with six cores busy.
        expect(large / small).toBeLessThan(24);
    });

});
