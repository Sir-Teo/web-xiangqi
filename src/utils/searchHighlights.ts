import { toSearchText } from './searchTerms';

export interface SearchTextPart { text: string; matched: boolean }
let graphemeSegmenter: Intl.Segmenter | undefined;

/** Highlight literal search terms without changing or splitting the displayed text. */
export function highlightSearchText(text: string, terms: string[]): SearchTextPart[] {
    const plain = [{ text, matched: false }];
    if (!text || !terms.length) return plain;
    const searchable = toSearchText([text]);
    const hits = new Uint8Array(searchable.length);
    for (const term of new Set(terms.map(term => toSearchText([term])).filter(Boolean))) {
        for (let at = searchable.indexOf(term); at !== -1; at = searchable.indexOf(term, at + 1)) {
            hits.fill(1, at, at + term.length);
        }
    }
    if (!hits.includes(1) || typeof Intl.Segmenter !== 'function') return plain;

    graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const graphemes = [...graphemeSegmenter.segment(text)].map(({ segment }) => ({
        text: segment, length: toSearchText([segment]).length,
    }));
    // Matching uses the whole lowercased string (including contextual Greek
    // sigma). Map its offsets back through graphemes: NFC and dotted capital I
    // can change lengths, while a match inside an emoji must keep it intact.
    if (graphemes.reduce((length, grapheme) => length + grapheme.length, 0) !== searchable.length) return plain;
    const parts: SearchTextPart[] = [];
    let offset = 0;
    for (const grapheme of graphemes) {
        const matched = hits.subarray(offset, offset + grapheme.length).includes(1);
        offset += grapheme.length;
        const previous = parts.at(-1);
        if (previous?.matched === matched) previous.text += grapheme.text;
        else parts.push({ text: grapheme.text, matched });
    }
    return parts;
}
