import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_RECENT_COMMANDS,
    RECENT_COMMANDS_STORAGE_KEY,
    type Command,
    commandMatches,
    commandPaletteShortcutLabel,
    isApplePlatform,
    rankCommands,
    readRecentCommandIds,
    rememberCommandId,
} from './commandPalette';
import { MAX_SEARCH_QUERY_LENGTH } from './searchTerms';

const noop = () => {};
const make = (id: string, label: string, extra: Partial<Command> = {}): Command =>
    ({ id, label, run: noop, ...extra });

const COMMANDS: Command[] = [
    make('new', 'New game', { keywords: ['restart', 'reset'] }),
    make('library', 'Library', { hint: 'Saved games' }),
    make('link', 'Copy link', { keywords: ['share', 'url'] }),
    make('review', 'Review game', { keywords: ['accuracy', 'blunders'] }),
    make('pgn', 'Copy PGN', { keywords: ['export', 'clipboard'] }),
];

describe('matching commands', () => {
    it('matches everything when nothing is typed', () => {
        expect(rankCommands(COMMANDS, '')).toHaveLength(COMMANDS.length);
    });

    it('requires every term, across label, hint and keywords', () => {
        expect(commandMatches(COMMANDS[1]!, ['saved'])).toBe(true);
        expect(commandMatches(COMMANDS[0]!, ['restart'])).toBe(true);
        expect(commandMatches(COMMANDS[2]!, ['copy', 'share'])).toBe(true);
        expect(commandMatches(COMMANDS[2]!, ['copy', 'pgn'])).toBe(false);
    });
});

describe('ranking commands', () => {
    it('keeps prefix ranking consistent for equivalent Unicode spellings', () => {
        const commands = [
            make('hint', 'Open study', { hint: 'Lü Qin' }),
            make('contains', 'Study of Lu\u0308 Qin'),
            make('prefix', 'Lü Qin study'),
        ];
        expect(rankCommands(commands, 'LU\u0308').map(command => command.id)).toEqual(['prefix', 'contains', 'hint']);
    });

    it('puts a label that starts with the query above one that merely contains it', () => {
        // "re" starts "Review game" and sits inside "New game"'s keywords.
        expect(rankCommands(COMMANDS, 're')[0]?.id).toBe('review');
    });

    it('keeps declaration order inside a band, so grouping survives', () => {
        expect(rankCommands(COMMANDS, '').map((c) => c.id))
            .toEqual(['new', 'library', 'link', 'review', 'pgn']);
    });

    it('leads with recently used commands on an empty query', () => {
        expect(rankCommands(COMMANDS, '', ['pgn', 'link']).map((c) => c.id))
            .toEqual(['pgn', 'link', 'new', 'library', 'review']);
    });

    it('ignores a recent id that is no longer a command', () => {
        const ranked = rankCommands(COMMANDS, '', ['gone', 'link']);
        expect(ranked[0]?.id).toBe('link');
        expect(ranked).toHaveLength(COMMANDS.length);
    });

    it('ignores recents once something is typed, since the query is the intent', () => {
        expect(rankCommands(COMMANDS, 'library', ['pgn'])[0]?.id).toBe('library');
    });

    it('bounds the query, so a pasted record is not thousands of terms', () => {
        const pasted = Array.from({ length: 5_000 }, (_, i) => `${i}. h2e2 h9g7`).join(' ');
        const started = performance.now();
        const ranked = rankCommands(COMMANDS, pasted);
        const elapsed = performance.now() - started;

        expect(ranked).toHaveLength(0);
        expect(pasted.length).toBeGreaterThan(MAX_SEARCH_QUERY_LENGTH);
        expect(elapsed, `took ${elapsed.toFixed(0)}ms`).toBeLessThan(50);
    });
});

describe('recent commands', () => {
    const storage = () => {
        const entries = new Map<string, string>();
        return {
            getItem: (key: string) => entries.get(key) ?? null,
            setItem: (key: string, value: string) => { entries.set(key, value); },
            removeItem: (key: string) => { entries.delete(key); },
            entries,
        };
    };

    it('remembers most-recent-first with no duplicates', () => {
        const store = storage();
        globalThis.localStorage = store as unknown as Storage;
        rememberCommandId('a');
        rememberCommandId('b');
        expect(rememberCommandId('a')).toEqual(['a', 'b']);
        expect(readRecentCommandIds()).toEqual(['a', 'b']);
    });

    it('caps the list', () => {
        const store = storage();
        globalThis.localStorage = store as unknown as Storage;
        for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) rememberCommandId(id);
        expect(readRecentCommandIds()).toHaveLength(MAX_RECENT_COMMANDS);
        expect(readRecentCommandIds()[0]).toBe('g');
    });

    it('uses the namespaced, versioned key every other store here uses', () => {
        expect(RECENT_COMMANDS_STORAGE_KEY).toMatch(/^xiangqi:[a-z-]+:v\d+$/);
    });

    it('survives junk in storage rather than throwing at startup', () => {
        const store = storage();
        globalThis.localStorage = store as unknown as Storage;
        store.entries.set(RECENT_COMMANDS_STORAGE_KEY, '{not json');
        expect(readRecentCommandIds()).toEqual([]);
        store.entries.set(RECENT_COMMANDS_STORAGE_KEY, '{"not":"an array"}');
        expect(readRecentCommandIds()).toEqual([]);
        store.entries.set(RECENT_COMMANDS_STORAGE_KEY, '[1,2,"ok"]');
        expect(readRecentCommandIds()).toEqual(['ok']);
    });
});

// Ported with the helper from web-chess; keep the two suites in step.
describe('platform-aware shortcut label', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const withNavigator = (value: unknown) => vi.stubGlobal('navigator', value);

    it('prefers userAgentData, which is the only non-deprecated source', () => {
        withNavigator({ userAgentData: { platform: 'macOS' }, platform: 'Win32', userAgent: 'Windows' });
        expect(isApplePlatform()).toBe(true);
        expect(commandPaletteShortcutLabel()).toBe('⌘K');
    });

    it('falls back to navigator.platform when userAgentData is absent', () => {
        withNavigator({ platform: 'MacIntel', userAgent: '' });
        expect(commandPaletteShortcutLabel()).toBe('⌘K');
    });

    it('falls back to the user agent when platform is empty', () => {
        withNavigator({ platform: '', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
        expect(commandPaletteShortcutLabel()).toBe('⌘K');
    });

    it('writes the portable spelling everywhere else', () => {
        withNavigator({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
        expect(isApplePlatform()).toBe(false);
        expect(commandPaletteShortcutLabel()).toBe('Ctrl+K');
    });

    it('does not throw without a navigator', () => {
        withNavigator(undefined);
        expect(() => commandPaletteShortcutLabel()).not.toThrow();
        expect(commandPaletteShortcutLabel()).toBe('Ctrl+K');
    });
});
