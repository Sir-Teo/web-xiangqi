/**
 * Free-text matching for the library filters.
 *
 * Every whitespace-separated term has to appear somewhere in the text, rather
 * than the whole query having to appear as one run of characters. Matching the
 * phrase means a query spanning two fields — a player and a year, say — finds
 * nothing, because those fields never end up adjacent.
 */

/**
 * A search box reads text the app did not write, and the obvious slip is a
 * paste into the wrong field -- a game record into the filter instead of the
 * importer. Every term has to match, so the work is terms x haystack x games:
 * 380KB pasted into the filter is 60,000 terms scanned against every saved
 * game, which took 900ms for one game here and freezes the tab for a full
 * library. Nothing narrows a search past a handful of terms anyway.
 *
 * Truncating rather than rejecting keeps a real query working and makes a
 * pasted record return nothing, immediately, which is what it should do.
 */
export const MAX_SEARCH_QUERY_LENGTH = 200;

export function toSearchTerms(query: string | null | undefined): string[] {
    return String(query ?? '')
        .slice(0, MAX_SEARCH_QUERY_LENGTH)
        .trim()
        .toLowerCase()
        .normalize('NFC')
        .split(/\s+/)
        .filter(Boolean);
}

/** Build an index with the same case and Unicode form as query terms. */
export function toSearchText(parts: Array<string | null | undefined>): string {
    return parts.filter((part): part is string => Boolean(part)).join(' ').toLowerCase().normalize('NFC');
}

export function matchesSearchTerms(haystack: string, terms: string[]): boolean {
    if (terms.length === 0) return true;
    const text = haystack.toLowerCase().normalize('NFC');
    return terms.every((term) => text.includes(term));
}
