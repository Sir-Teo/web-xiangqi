import { describe, expect, it } from 'vitest';
import { matchesSearchTerms, toSearchText, toSearchTerms } from './searchTerms';

describe('splitting a query into terms', () => {
    it('splits on any run of whitespace and lowercases', () => {
        expect(toSearchTerms('Lee   Sedol\t2005')).toEqual(['lee', 'sedol', '2005']);
    });

    it('has no terms for an empty or blank query', () => {
        expect(toSearchTerms('')).toEqual([]);
        expect(toSearchTerms('   \n ')).toEqual([]);
        expect(toSearchTerms(null as unknown as string)).toEqual([]);
    });
});

describe('building the text to search', () => {
    it('joins the parts that are there and drops the rest', () => {
        expect(toSearchText(['Red', null, 'Central Cannon', undefined, ''])).toBe('red central cannon');
    });

    it('is empty when nothing is there', () => {
        expect(toSearchText([])).toBe('');
        expect(toSearchText([null, undefined, ''])).toBe('');
    });
});

describe('matching terms', () => {
    const text = toSearchText(['Carlsen, M.', 'Aronian, L.', '41st Olympiad', '2014.08.06', 'Slav Defense']);

    it('matches everything when no terms were given', () => {
        expect(matchesSearchTerms(text, [])).toBe(true);
    });

    it('matches a term against any part of the text', () => {
        expect(matchesSearchTerms(text, ['carlsen'])).toBe(true);
        expect(matchesSearchTerms(text, ['slav'])).toBe(true);
        expect(matchesSearchTerms(text, ['2014'])).toBe(true);
    });

    it('matches terms that live in different fields, in any order', () => {
        // The reason this exists: a phrase match finds nothing here, because
        // the player and the year are never adjacent.
        expect(matchesSearchTerms(text, ['carlsen', '2014'])).toBe(true);
        expect(matchesSearchTerms(text, ['2014', 'carlsen'])).toBe(true);
    });

    it('requires every term', () => {
        expect(matchesSearchTerms(text, ['carlsen', 'notaplayer'])).toBe(false);
    });

    it('does not care about the case of either side', () => {
        expect(matchesSearchTerms('Central Cannon', toSearchTerms('CENTRAL cannon'))).toBe(true);
    });

    it('finds nothing in empty text unless nothing was asked for', () => {
        expect(matchesSearchTerms('', ['x'])).toBe(false);
        expect(matchesSearchTerms('', [])).toBe(true);
    });
});

describe('bounded query length', () => {
    it('truncates a pasted record instead of scanning every term of it', () => {
        const pastedRecord = Array.from({ length: 20_000 }, (_, i) => `${i}. h2e2 h9g7`).join(' ');
        const haystack = toSearchText(['Hu Ronghua', 'Yang Guanlin', '1977', 'National Championship']);

        const started = performance.now();
        const terms = toSearchTerms(pastedRecord);
        const matched = matchesSearchTerms(haystack, terms);
        const elapsed = performance.now() - started;

        expect(matched).toBe(false);
        expect(terms.length).toBeLessThan(100);
        expect(elapsed, `took ${elapsed.toFixed(0)}ms`).toBeLessThan(50);
    });

    it('leaves a real query untouched', () => {
        expect(toSearchTerms('  Hu   1977 ')).toEqual(['hu', '1977']);
    });
});
