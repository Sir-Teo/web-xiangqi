import { memo } from 'react';
import { highlightSearchText } from '../utils/searchHighlights';
import './SearchText.css';

export const SearchText = memo(function SearchText({ text, terms }: { text: string; terms: string[] }) {
    return <>{highlightSearchText(text, terms).map((part, index) => part.matched
        ? <mark key={index} className="search-text-match">{part.text}</mark>
        : part.text)}</>;
});
