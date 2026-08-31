import { formatPgnDate } from './gameExport';

/**
 * What a downloaded PGN is called.
 *
 * There were two of these -- `makePgnDownloadFilename` in `App.tsx` for the
 * current game and `makeSavedGamePgnFilename` in `LibraryPanel.tsx` for a saved
 * one -- producing the same shape by two routes. That is how the UTC date bug
 * came to be half-fixed: the App copy was corrected and the library copy, which
 * nothing pointed at it, kept stamping a game saved at 9:30pm in New York with
 * the next day, while the card beside it showed the right one.
 *
 * The date is `formatPgnDate`, so a file and the `[Date]` tag inside it always
 * agree, and both agree with the card.
 */
export function pgnDownloadFilename(
    name?: string,
    when: Date = new Date(),
    fallback = 'game'
): string {
    const date = formatPgnDate(when).replace(/\./g, '-');
    const slug = String(name || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        // A name of nothing but punctuation slugs to empty, and
        // `web-xiangqi-2026-01-02-.pgn` is not a filename anyone wants.
        || fallback;
    return `web-xiangqi-${date}-${slug}.pgn`;
}
