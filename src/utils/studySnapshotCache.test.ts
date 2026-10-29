import { expect, it } from 'vitest';
import type { MoveRecord, MoveTreeNode } from '../hooks/useXiangqi';
import { createSavedMoveTreeSerializer, serializeSavedMoveTree } from './savedMoveTree';
import type { StudyAnalysis } from './studyAnalysis';

function fixture(): Record<string, MoveTreeNode> {
    return {
        root: { id: 'root', parentId: null, childrenIds: ['first', 'other'] },
        first: { id: 'first', parentId: 'root', childrenIds: ['last'], record: { uci: 'a0a1', comment: 'Cannon plan' } as MoveRecord },
        last: { id: 'last', parentId: 'first', childrenIds: [], record: { uci: 'a9a8' } as MoveRecord },
        other: { id: 'other', parentId: 'root', childrenIds: [], record: { uci: 'h2e2' } as MoveRecord },
    };
}
const analysis: StudyAnalysis = { version: 1, position: 'position startpos', move: 'a0a1', score: 10, scoreKind: 'cp',
    bounded: false, depth: 12, savedAt: 123, engine: { name: 'Pikafish', variant: 'single-simd', threads: 1, hashMB: 16 }, multiPv: 1 };
function edit(tree: Record<string, MoveTreeNode>, id: string, patch: Partial<MoveRecord>) {
    return { ...tree, [id]: { ...tree[id], record: { ...tree[id].record!, ...patch } } };
}
it('reuses immutable snapshots across automatic scores and recommendations without changing the saved bytes', () => {
    const serialize = createSavedMoveTreeSerializer();
    const tree = fixture(), saved = serialize(tree, 'root'), bytes = JSON.stringify(saved);
    const automatic = edit(tree, 'first', { evalScore: 42, evalDepth: 18, bestMove: 'h2e2', bestLine: ['h2e2'], quality: 'good', reviewNote: 'Engine explanation' });
    expect(serialize(automatic, 'root')).toBe(saved);
    expect(serializeSavedMoveTree(automatic, 'root')).toEqual(saved);
    const note = edit(automatic, 'last', { comment: 'New note 新注' });
    expect(serialize(note, 'root')).not.toBe(saved);
    expect(serialize(note, 'root')).toEqual(serializeSavedMoveTree(note, 'root'));
    expect(JSON.stringify(saved)).toBe(bytes);
});
it('invalidates every stored edit, including persisted evaluation depth/kind and explicit clearing', () => {
    const serialize = createSavedMoveTreeSerializer();
    let tree = fixture();
    let previous = serialize(tree, 'root');
    for (const patch of [
        { comment: 'Changed plan' }, { comment: undefined }, { nags: [1] }, { nags: undefined },
        { recordedResult: 'draw' as const }, { recordedResult: undefined },
        { analysis }, { analysis: undefined }, { persistEvaluation: true, evalScore: 20_000 },
        { evalScoreKind: 'cp' as const }, { evalDepth: 20 }, { evalScore: 40 }, { quality: 'mistake' as const },
        { persistEvaluation: false }, { uci: 'a0a2' },
    ]) {
        tree = edit(tree, 'first', patch);
        const saved = serialize(tree, 'root');
        expect(saved).toEqual(serializeSavedMoveTree(tree, 'root'));
        expect(saved).not.toBe(previous);
        previous = saved;
    }
});
it('preserves branching, child order, deletion/undo, cycles and changes of root or game', () => {
    const serialize = createSavedMoveTreeSerializer(), original = fixture();
    const reordered = { ...original, root: { ...original.root, childrenIds: ['other', 'first'] } };
    const deleted = { ...original, first: { ...original.first, childrenIds: [] } }; delete (deleted as Record<string, MoveTreeNode>).last;
    const cyclic = { ...original, last: { ...original.last, childrenIds: ['first'] } };
    for (const tree of [original, reordered, deleted, original, cyclic, original, fixture()]) {
        expect(serialize(tree, 'root')).toEqual(serializeSavedMoveTree(tree, 'root'));
        expect(serialize(tree, 'first')).toEqual(serializeSavedMoveTree(tree, 'first'));
    }
    expect(serialize({}, 'missing')).toEqual([]);
    const first = serialize(original, 'root');
    serialize.clear();
    expect(serialize(original, 'root')).toEqual(first);
    expect(serialize(original, 'root')).not.toBe(first);
});
it('tracks the latest immutable input when automatic updates precede a real edit', () => {
    const serialize = createSavedMoveTreeSerializer();
    let tree = fixture();
    for (let index = 0; index < 200; index++) {
        tree = edit(tree, index % 2 ? 'last' : 'first', index % 17 === 0
            ? { comment: 'Annotation ' + index, nags: [index % 7] }
            : { evalScore: index, evalDepth: index % 25 });
        expect(serialize(tree, 'root')).toEqual(serializeSavedMoveTree(tree, 'root'));
    }
});
