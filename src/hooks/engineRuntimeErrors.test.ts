import { describe, expect, it } from 'vitest';
import { shouldSuppressEngineRuntimeError, shouldSuppressEngineRuntimeRejection } from './useEngine';

/**
 * Which runtime errors belong to the engine and may be swallowed.
 *
 * Pikafish's WASM core throws `memory access out of bounds` when it runs out
 * of heap, and the app handles that itself -- it shows a recovery notice and
 * reboots the engine smaller. Letting the raw error through would put a
 * browser-level crash message in front of a reader who is about to be fine.
 *
 * Both halves must hold: the *message* has to be that error and the *source*
 * has to be the engine. Suppressing on the message alone swallows an
 * unrelated out-of-bounds from the app's own bundle; suppressing on the source
 * alone swallows every engine error there is.
 *
 * Only `test-review-fixtures-browser.cjs` covered this, and only for one of
 * the five filename hints -- so the sweep found the `pikafish worker` arm
 * loosenable with the whole unit suite green. A pure exported function does
 * not need a browser to be checked.
 */
const OOM = 'RuntimeError: memory access out of bounds';

describe('suppressing an engine runtime error', () => {
    it.each([
        '/web-xiangqi/pikafish.js',
        '/web-xiangqi/pikafish-core.js',
        '/web-xiangqi/pikafishcore.wasm',
        'blob:http://localhost/pikafish worker',
        'blob:http://localhost/worker engine',
    ])('recognises %s as the engine', (filename) => {
        expect(shouldSuppressEngineRuntimeError(filename, OOM)).toBe(true);
    });

    it('leaves the same error alone when it came from the app', () => {
        expect(shouldSuppressEngineRuntimeError('/web-xiangqi/assets/index.js', OOM)).toBe(false);
        expect(shouldSuppressEngineRuntimeError('', OOM)).toBe(false);
    });

    it('leaves other engine errors alone, so only the handled one is hidden', () => {
        expect(shouldSuppressEngineRuntimeError('/web-xiangqi/pikafish.js', 'TypeError: x is not a function')).toBe(false);
        expect(shouldSuppressEngineRuntimeError('/web-xiangqi/pikafish.js', '')).toBe(false);
    });

    it('is case-insensitive about both, since a stack frame is not normalised', () => {
        expect(shouldSuppressEngineRuntimeError('/PIKAFISH-CORE.JS', 'Memory Access Out Of Bounds')).toBe(true);
    });

    it('answers for missing values rather than throwing', () => {
        expect(() => shouldSuppressEngineRuntimeError(undefined as never, undefined as never)).not.toThrow();
        expect(shouldSuppressEngineRuntimeError(undefined as never, undefined as never)).toBe(false);
    });
});

describe('suppressing an engine promise rejection', () => {
    it('reads the engine out of an Error stack', () => {
        const error = new Error(OOM);
        error.stack = `Error: ${OOM}\n    at wasm://wasm/pikafish-core.js:1:1`;
        expect(shouldSuppressEngineRuntimeRejection(error)).toBe(true);
    });

    it('leaves the app’s own rejection alone', () => {
        const error = new Error(OOM);
        error.stack = `Error: ${OOM}\n    at /web-xiangqi/assets/index.js:1:1`;
        expect(shouldSuppressEngineRuntimeRejection(error)).toBe(false);
    });

    it('takes a rejection that is not an Error at all', () => {
        expect(() => shouldSuppressEngineRuntimeRejection(undefined)).not.toThrow();
        expect(shouldSuppressEngineRuntimeRejection(undefined)).toBe(false);
        expect(shouldSuppressEngineRuntimeRejection(`${OOM} in pikafish-core`)).toBe(true);
    });
});
