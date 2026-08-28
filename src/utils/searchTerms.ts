/**
 * Free-text matching for the library filters.
 *
 * Every whitespace-separated term has to appear somewhere in the text, rather
 * than the whole query having to appear as one run of characters. Matching the
 * phrase means a query spanning two fields — a player and a year, say — finds
 * nothing, because those fields never end up adjacent.
 */

export function toSearchTerms(query: string): string[] {
    return String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Builds the haystack once; skips empty parts and lowercases the result. */
export function toSearchText(parts: Array<string | null | undefined>): string {
    return parts.filter((part): part is string => Boolean(part)).join(' ').toLowerCase();
}

export function matchesSearchTerms(haystack: string, terms: string[]): boolean {
    if (terms.length === 0) return true;
    const text = haystack.toLowerCase();
    return terms.every((term) => text.includes(term));
}
