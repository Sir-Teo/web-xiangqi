import { describe, expect, it } from 'vitest';
import type { MoveTreeNode } from '../hooks/useXiangqi';
import { collectStudyNotes } from './studyNotes';
import { matchesSearchTerms, toSearchTerms } from './searchTerms';

function node(id: string, parentId: string | null, childrenIds: string[], comment?: string): MoveTreeNode {
    return { id, parentId, childrenIds, ...(parentId === null ? { comment } : {
        record: { uci: 'a0a1', piece: 'R', captured: '', board: [], sideToMove: 'b', inCheck: false, ply: 1, comment },
    }) };
}

describe('study note navigation', () => {
    it('finds root, main line and nested variation notes in tree order', () => {
        const tree = {
            root: node('root', null, ['main', 'side'], 'Opening plan'),
            main: node('main', 'root', [], 'Main idea'),
            side: node('side', 'root', ['reply', 'alternative']),
            reply: node('reply', 'side', [], 'Quiet 中炮 🐎'),
            alternative: node('alternative', 'side', ['end'], 'Counterplay'),
            end: node('end', 'alternative', [], 'Final position'),
            orphan: node('orphan', 'missing', [], 'Must not appear'),
        };
        const notes = collectStudyNotes(tree, 'root');
        expect(notes.map(note => [note.nodeId, note.variationId])).toEqual([
            ['root', undefined], ['main', undefined], ['reply', 'side'], ['alternative', 'alternative'], ['end', 'alternative'],
        ]);
        expect(notes.filter(note => matchesSearchTerms(note.comment, toSearchTerms('🐎 QUIET 中炮'))).map(note => note.nodeId)).toEqual(['reply']);
        expect(notes.filter(note => matchesSearchTerms(note.comment, toSearchTerms('main quiet')))).toEqual([]);
    });
    it('ignores empty notes, engine review prose, missing children and cycles', () => {
        const root = node('root', null, ['empty', 'root', 'missing', 'empty']);
        const empty = node('empty', 'root', [], '  ');
        empty.record!.reviewNote = 'Engine explanation';
        expect(collectStudyNotes({ root, empty }, 'root')).toEqual([]);
        expect(collectStudyNotes({ root }, 'missing')).toEqual([]);
        root.comment = 'Only note';
        expect(collectStudyNotes({ root }, 'root').map(note => note.comment)).toEqual(['Only note']);
    });
    it('reaches the end of a 1,024-move side line without recursion or visible-list limits', () => {
        const tree: Record<string, MoveTreeNode> = { root: node('root', null, ['main', 'n1']), main: node('main', 'root', []) };
        for (let index = 1; index < 1024; index++) {
            tree[`n${index}`] = node(`n${index}`, index === 1 ? 'root' : `n${index - 1}`, index < 1023 ? [`n${index + 1}`] : [], `Note ${index}`);
        }
        const notes = collectStudyNotes(tree, 'root');
        expect(notes).toHaveLength(1023);
        expect(notes.at(-1)).toEqual({ nodeId: 'n1023', comment: 'Note 1023', variationId: 'n1' });
    });
});
