import { expect, it } from 'vitest';
import { makeAnalysisTag, makeReviewTag } from './engineTags';
import { createNavigationAnalysisCache, navigationAnalysisKey, type CachedNavigationAnalysis } from './navigationAnalysisCache';

it('distinguishes complete history, budget, policy and phase and excludes manual searches', () => {
    const position = 'position startpos moves a0a1 a9a8 a1a0 a8a9';
    const key = (p = position, go = 'go depth 18 movetime 1500', tag = makeAnalysisTag('primary', 'policy-a')) => navigationAnalysisKey(p, go, tag);
    expect(key()).not.toBeNull();
    expect(key('position startpos')).not.toBe(key());
    expect(key(position, 'go depth 12 movetime 500')).not.toBe(key());
    expect(key(position, undefined, makeAnalysisTag('primary', 'policy-b'))).not.toBe(key());
    expect(key(position, undefined, makeAnalysisTag('deepen', 'policy-a'))).not.toBe(key());
    expect(key(position, undefined, makeAnalysisTag('deep', 'policy-a'))).toBeNull();
    expect(key(position, 'go infinite')).toBeNull();
    expect(key(position, undefined, makeReviewTag('base', 'n1'))).toBeNull();
    expect(navigationAnalysisKey(position, 'go depth 18')).toBeNull();
});

it('bounds memory, retains recently revisited positions, replaces readings and clears the session', () => {
    const cache = createNavigationAnalysisCache(2);
    const result: CachedNavigationAnalysis = { bestMove: 'a0a1', reading: { score: 0, exact: true }, lines: [], wdl: null };
    cache.set('one', result);
    cache.set('two', result);
    expect(cache.get('one')).toBe(result);
    cache.set('three', result);
    expect(cache.get('two')).toBeUndefined();
    const replacement = { ...result, reading: { score: 123, exact: true } };
    cache.set('one', replacement);
    expect(cache.get('one')).toBe(replacement);
    cache.clear();
    expect(cache.get('one')).toBeUndefined();
    expect(cache.get('three')).toBeUndefined();
    expect(cache.get(null)).toBeUndefined();
});
