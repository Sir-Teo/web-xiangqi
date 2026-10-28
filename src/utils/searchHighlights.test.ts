import { describe, expect, it, vi } from 'vitest';
import { highlightSearchText } from './searchHighlights';

describe('literal search highlights', () => {
    it.each([
        ['Central cannon and cannon reply', ['CANNON'], ['cannon', 'cannon']],
        ['Café and Cafe\u0301', ['café'], ['Café', 'Cafe\u0301']],
        ['A\u030A and Å', ['å'], ['A\u030A', 'Å']],
        ['ΟΣ ος', ['ος'], ['ΟΣ', 'ος']],
        ['İstanbul and Paris', ['i\u0307stan', 'PARIS'], ['İstan', 'Paris']],
        ['J\u030C and ǰ', ['ǰ'], ['J\u030C', 'ǰ']],
        ['Plan 🐎 中炮', ['🐎', '中炮'], ['🐎', '中炮']],
        ['Family 👩‍👩‍👧‍👦 together', ['👩'], ['👩‍👩‍👧‍👦']],
    ])('preserves Unicode and source text in %s', (text, terms, marked) => {
        const parts = highlightSearchText(text as string, terms as string[]);
        expect(parts.map(part => part.text).join('')).toBe(text);
        expect(parts.filter(part => part.matched).map(part => part.text)).toEqual(marked);
    });
    it('merges repeated, overlapping and adjacent terms', () => {
        expect(highlightSearchText('cannon', ['can', 'annon', 'can', ''])).toEqual([{ text: 'cannon', matched: true }]);
        expect(highlightSearchText('aaaa', ['aa'])).toEqual([{ text: 'aaaa', matched: true }]);
    });
    it('treats punctuation and markup as literal text', () => {
        const text = '<script> [a+b]? .*';
        expect(highlightSearchText(text, ['[a+b]?', '<script>']).filter(part => part.matched).map(part => part.text))
            .toEqual(['<script>', '[a+b]?']);
    });
    it('can bound repeated highlights while preserving later search terms and all original text', () => {
        const text = 'Canal '.repeat(100) + 'Café and Cafe\u0301';
        const parts = highlightSearchText(text, ['a', 'café'], 8);
        expect(parts.map(part => part.text).join('')).toBe(text);
        const marked = parts.filter(part => part.matched).map(part => part.text);
        expect(marked).toHaveLength(10);
        expect(marked.slice(-2)).toEqual(['Café', 'Cafe\u0301']);
    });
    it('keeps text plain when no highlights are requested', () => {
        expect(highlightSearchText('Canal', ['a'], 0)).toEqual([{ text: 'Canal', matched: false }]);
    });
    it.each([['Plan', []], ['Plan', ['unmatched']], ['', ['plan']]])('leaves unmatched text readable', (text, terms) => {
        expect(highlightSearchText(text as string, terms as string[])).toEqual([{ text, matched: false }]);
    });
    it('leaves the original text readable when grapheme segmentation is unavailable', () => {
        vi.stubGlobal('Intl', {});
        try { expect(highlightSearchText('Café', ['café'])).toEqual([{ text: 'Café', matched: false }]); }
        finally { vi.unstubAllGlobals(); }
    });
});
