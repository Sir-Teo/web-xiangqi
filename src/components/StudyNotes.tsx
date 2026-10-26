import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MoveTreeNode } from '../hooks/useXiangqi';
import type { StudyNote } from '../utils/studyNotes';
import { formatBreadcrumbLabel } from '../utils/moveBreadcrumb';
import { matchesSearchTerms, MAX_SEARCH_QUERY_LENGTH, toSearchTerms } from '../utils/searchTerms';
import type { XiangqiNotationStyle } from '../utils/xiangqiNotation';
import './StudyNotes.css';

const PAGE_SIZE = 20;
type Props = {
    notes: StudyNote[];
    treeNodes: Record<string, MoveTreeNode>;
    rootId: string;
    rootFen: string;
    notationStyle: XiangqiNotationStyle;
    currentNodeId: string;
    gameIdentity: object;
    disabled: boolean;
    onNavigate: (nodeId: string) => void;
};

export const StudyNotes = memo(function StudyNotes({ notes, treeNodes, rootId, rootFen, notationStyle,
    currentNodeId, gameIdentity, disabled, onNavigate }: Props) {
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(PAGE_SIZE);
    const listRef = useRef<HTMLUListElement>(null);
    useEffect(() => { setQuery(''); setLimit(PAGE_SIZE); }, [gameIdentity]);
    useLayoutEffect(() => {
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [query, gameIdentity]);
    const matches = useMemo(() => {
        const terms = toSearchTerms(query);
        return notes.filter(note => matchesSearchTerms(note.comment, terms));
    }, [notes, query]);
    const label = (id: string) => id === rootId ? 'Starting position'
        : formatBreadcrumbLabel(treeNodes[id]?.record, rootFen, notationStyle);

    if (!notes.length) return null;
    return <details id="study-notes" className="study-notes" data-testid="study-notes">
        <summary>Study notes <span>({notes.length})</span></summary>
        <div className="study-notes-body">
            <label htmlFor="study-notes-search">Find a note in any variation</label>
            <input id="study-notes-search" type="search" value={query} maxLength={MAX_SEARCH_QUERY_LENGTH}
                placeholder="Search note text" onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} />
            <p role="status">{matches.length ? `${matches.length} ${matches.length === 1 ? 'note' : 'notes'}${matches.length > limit ? ` · Showing ${limit}` : ''}. Choose one to go to its position.` : 'No notes match. Try fewer words.'}</p>
            {disabled && <p>Pause play to visit a note.</p>}
            <ul ref={listRef}>
                {matches.slice(0, limit).map(note => <li key={note.nodeId}>
                    <button type="button" className="study-note-result" disabled={disabled}
                        aria-current={note.nodeId === currentNodeId ? 'location' : undefined}
                        onClick={() => onNavigate(note.nodeId)}>
                        <strong>{label(note.nodeId)}</strong>
                        {note.nodeId !== rootId && <small>{note.variationId ? `Variation via ${label(note.variationId)}` : 'Main line'}</small>}
                        <span title={note.comment}>{note.comment}</span>
                    </button>
                </li>)}
            </ul>
            {matches.length > limit && <button type="button" className="chip-btn study-notes-more"
                onClick={() => setLimit(value => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, matches.length - limit)} more notes</button>}
        </div>
    </details>;
});
