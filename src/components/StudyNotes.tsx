import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MoveTreeNode } from '../hooks/useXiangqi';
import type { StudyNote } from '../utils/studyNotes';
import { formatBreadcrumbLabel } from '../utils/moveBreadcrumb';
import { MAX_SEARCH_QUERY_LENGTH, toSearchTerms, toSearchText } from '../utils/searchTerms';
import type { XiangqiNotationStyle } from '../utils/xiangqiNotation';
import { isComposingKey } from '../utils/keyboard';
import { IconX } from './icons';
import './StudyNotes.css';

const PAGE_SIZE = 20;
export interface StudyNotesViewState { query: string; limit: number; expanded: boolean }
const EMPTY_VIEW: StudyNotesViewState = { query: '', limit: PAGE_SIZE, expanded: false };
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
    initialViewState?: StudyNotesViewState;
    onViewStateChange?: (identity: object, state: StudyNotesViewState) => void;
};

export const StudyNotes = memo(function StudyNotes({ notes, treeNodes, rootId, rootFen, notationStyle,
    currentNodeId, gameIdentity, disabled, onNavigate, initialViewState, onViewStateChange }: Props) {
    const [view, setView] = useState(initialViewState ?? EMPTY_VIEW);
    const { query, limit, expanded } = view;
    const identityRef = useRef(gameIdentity);
    const detailsRef = useRef<HTMLDetailsElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const nextPageFocusRef = useRef<number | null>(null);
    useLayoutEffect(() => {
        if (identityRef.current === gameIdentity) return;
        identityRef.current = gameIdentity;
        setView(EMPTY_VIEW);
    }, [gameIdentity]);
    const updateView = (patch: Partial<StudyNotesViewState>) => {
        const next = { ...view, expanded: detailsRef.current?.open ?? expanded, ...patch };
        setView(next);
        onViewStateChange?.(gameIdentity, next);
    };
    useLayoutEffect(() => {
        nextPageFocusRef.current = null;
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [query, gameIdentity]);
    useLayoutEffect(() => {
        const index = nextPageFocusRef.current;
        if (index === null) return;
        nextPageFocusRef.current = null;
        const item = listRef.current?.children[index];
        const button = item?.querySelector<HTMLButtonElement>('button');
        // Notes remain readable during play even when navigation is disabled.
        const target = button?.disabled ? item : button;
        if (target instanceof HTMLElement) {
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: 'nearest' });
        }
    }, [limit]);
    const terms = useMemo(() => toSearchTerms(query), [query]);
    const hasTerms = terms.length > 0;
    // Normalize once per note edit, rather than every keystroke. An empty
    // query needs no index, including while the finder is still collapsed.
    const searchText = useMemo(() => hasTerms ? notes.map(note => toSearchText([note.comment])) : [], [hasTerms, notes]);
    const matches = useMemo(() => hasTerms
        ? notes.filter((_, index) => terms.every(term => searchText[index].includes(term)))
        : notes, [hasTerms, notes, searchText, terms]);
    const label = (id: string) => id === rootId ? 'Starting position'
        : formatBreadcrumbLabel(treeNodes[id]?.record, rootFen, notationStyle);

    if (!notes.length) return null;
    return <details id="study-notes" className="study-notes" data-testid="study-notes" ref={detailsRef}
        open={expanded} onToggle={event => updateView({ expanded: event.currentTarget.open })}>
        <summary>Study notes <span>({notes.length})</span></summary>
        <div className="study-notes-body">
            <label htmlFor="study-notes-search">Find a note in any variation</label>
            <div className="study-notes-search">
                <input id="study-notes-search" ref={searchRef} type="search" value={query} maxLength={MAX_SEARCH_QUERY_LENGTH}
                    aria-keyshortcuts="Escape" title="Press Esc to clear this search"
                    onKeyDown={event => {
                        if (event.key !== 'Escape' || !query || isComposingKey(event.nativeEvent)) return;
                        event.preventDefault(); event.stopPropagation(); updateView({ query: '', limit: PAGE_SIZE });
                    }}
                    placeholder="Search note text" onChange={event => updateView({ query: event.target.value, limit: PAGE_SIZE })} />
                {query && <button type="button" className="chip-btn study-notes-search-clear"
                    aria-label="Clear note search" title="Clear search"
                    onClick={() => { updateView({ query: '', limit: PAGE_SIZE }); searchRef.current?.focus(); }}>
                    <IconX width="1rem" height="1rem" />
                </button>}
            </div>
            <p role="status">{matches.length ? `${matches.length} ${matches.length === 1 ? 'note' : 'notes'}${matches.length > limit ? ` · Showing ${limit}` : ''}. Choose one to go to its position.` : 'No notes match. Try fewer words.'}</p>
            {disabled && <p>Pause play to visit a note.</p>}
            <ul ref={listRef}>
                {matches.slice(0, limit).map(note => <li key={note.nodeId} tabIndex={-1}>
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
                onClick={() => { nextPageFocusRef.current = limit; updateView({ limit: limit + PAGE_SIZE }); }}>Show {Math.min(PAGE_SIZE, matches.length - limit)} more notes</button>}
        </div>
    </details>;
});
