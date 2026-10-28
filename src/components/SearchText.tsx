import { memo } from 'react';
import { highlightSearchText } from '../utils/searchHighlights';
import './SearchText.css';

export const SearchText = memo(function SearchText({ text, terms, maxMatchesPerTerm }: {
    text: string; terms: string[]; maxMatchesPerTerm?: number;
}) {
    return <>{highlightSearchText(text, terms, maxMatchesPerTerm).map((part, index) => part.matched
        ? <mark key={index} className="search-text-match">{part.text}</mark>
        : part.text)}</>;
});
