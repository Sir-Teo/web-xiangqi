import { expect, it } from 'vitest';
import { clearIsolationAnalysisResume, prepareIsolationAnalysisResume, readIsolationAnalysisResume } from './isolationReloadResume';

const url = 'https://example.test/web-xiangqi/?moves=h2e2';
function storage() {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); } };
}

it('keeps analysis off when no start request preceded the automatic reload', () => {
    const store = storage();
    expect(readIsolationAnalysisResume(store, url)).toBe(false);
    prepareIsolationAnalysisResume(false, store, url);
    expect(readIsolationAnalysisResume(store, url)).toBe(false);
});

it('resumes an explicit request once, including repeated React initializers, then leaves manual reloads off', () => {
    const store = storage();
    prepareIsolationAnalysisResume(true, store, url);
    expect(readIsolationAnalysisResume(store, url)).toBe(true);
    expect(readIsolationAnalysisResume(store, url)).toBe(true);
    clearIsolationAnalysisResume(store);
    expect(readIsolationAnalysisResume(store, url)).toBe(false);
});

it('does not start an engine after navigating to a different game or app URL', () => {
    const store = storage();
    prepareIsolationAnalysisResume(true, store, url);
    expect(readIsolationAnalysisResume(store, `${url}+h9g7`)).toBe(false);
    clearIsolationAnalysisResume(store);
    expect(readIsolationAnalysisResume(store, url)).toBe(false);
});

it('clears a pending request when analysis was not requested at reload time', () => {
    const store = storage();
    prepareIsolationAnalysisResume(true, store, url);
    prepareIsolationAnalysisResume(false, store, url);
    expect(readIsolationAnalysisResume(store, url)).toBe(false);
});

it('keeps startup and reload usable when session storage is blocked', () => {
    const blocked = { getItem: () => { throw Error('unavailable'); },
        setItem: () => { throw Error('unavailable'); }, removeItem: () => { throw Error('unavailable'); } };
    expect(readIsolationAnalysisResume(blocked, url)).toBe(false);
    expect(() => prepareIsolationAnalysisResume(true, blocked, url)).not.toThrow();
    expect(() => prepareIsolationAnalysisResume(false, blocked, url)).not.toThrow();
    expect(() => clearIsolationAnalysisResume(blocked)).not.toThrow();
});
