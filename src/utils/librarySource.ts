import { normalizeSavedGame, type SavedGame } from './gameLibrary';
export type LibrarySource = { id: string; revision: string };
const cache = new WeakMap<SavedGame, LibrarySource>();
/** Compact content identity for recovery; library writes still check the full source. */
export function librarySource(game: SavedGame): LibrarySource {
    const cached = cache.get(game);
    if (cached) return cached;
    const text = JSON.stringify({ ...normalizeSavedGame(game), label: undefined });
    let first = 0x811c9dc5, second = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ code, 0x85ebca6b);
    }
    const source = { id: game.id, revision: `${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}:${text.length}` };
    cache.set(game, source);
    return source;
}
export function normalizeLibrarySource(raw: unknown): LibrarySource | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const source = raw as Partial<LibrarySource>;
    return typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 256
        && typeof source.revision === 'string' && /^[a-f0-9]{1,8}:[a-f0-9]{1,8}:\d{1,8}$/.test(source.revision)
        ? { id: source.id, revision: source.revision } : undefined;
}
export function resolveLibrarySource(source: LibrarySource | undefined, games: SavedGame[]): SavedGame | null {
    const game = source && games.find(game => game.id === source.id);
    return game && librarySource(game).revision === source?.revision ? game : null;
}
