import { expect, it } from 'vitest';
import { normalizeSavedGame, type SavedGame, type SavedMoveTreeNode } from './gameLibrary';
import { decodeSavedTreePathParam, findSavedTreePath, isSavedTreePath, normalizeSavedTreePath, savedNodeAtPath } from './savedTreePath';
import { buildSavedGamePgn, savedGamePgnInput } from './savedGamePgn';
import { savedGameLine, savedGamePositionResult } from './savedGameLine';
import { buildShareUrl } from './shareUrl';
import { START_POSITION_FEN } from './xiangqi';
import { studyContentParts } from './studyContent';

const tree: SavedMoveTreeNode[] = [
    { uci: 'h2e2', comment: 'First', children: [{ uci: 'h9g7', recordedResult: 'draw' }] },
    { uci: 'h2e2', comment: 'Second', children: [{ uci: 'b9c7' }, { uci: 'h9g7', comment: 'Second reply', recordedResult: 'red-wins' }] },
];

it('finds a complete path beyond a repeated sibling instead of rejecting its continuation', () => {
    expect(findSavedTreePath(tree, ['h2e2', 'b9c7'])).toEqual([1, 0]);
    expect(findSavedTreePath(tree, ['h2e2', 'h9g7'])).toEqual([0, 0]);
    expect(findSavedTreePath(tree, ['h2e2', 'a9a8'])).toBeNull();
});

it('keeps an explicitly chosen occurrence and extends its prefix along that branch', () => {
    expect(findSavedTreePath(tree, ['h2e2'], [1])).toEqual([1]);
    expect(findSavedTreePath(tree, ['h2e2', 'h9g7'], [1])).toEqual([1, 1]);
    expect(savedNodeAtPath(tree, [1, 1])?.comment).toBe('Second reply');
    expect(findSavedTreePath(tree, ['h2e2', 'b9c7'], [0])).toEqual([1, 0]);
});

it('validates stored addresses against every move and copies accepted arrays', () => {
    const path = [1, 1];
    expect(isSavedTreePath(tree, ['h2e2', 'h9g7'], path)).toBe(true);
    expect(normalizeSavedTreePath(path, tree, ['h2e2', 'h9g7'])).toEqual(path);
    expect(normalizeSavedTreePath(path, tree, ['h2e2', 'h9g7'])).not.toBe(path);
    for (const invalid of [[1], [1, 0], [1, -1], [1, 0.5], [1, '1'], [9, 0], null, {}]) {
        expect(normalizeSavedTreePath(invalid, tree, ['h2e2', 'h9g7'])).toBeUndefined();
    }
});

it('keeps root selection and empty trees distinct from missing move paths', () => {
    expect(findSavedTreePath(undefined, [])).toEqual([]);
    expect(isSavedTreePath(tree, [], [])).toBe(true);
    expect(normalizeSavedTreePath([], tree, [])).toBeUndefined();
    expect(findSavedTreePath(undefined, ['h2e2'])).toBeNull();
    expect(savedNodeAtPath(tree, [])).toBeUndefined();
    expect(savedNodeAtPath(tree, [1, 9])).toBeUndefined();
});

it('handles maximum-depth studies without recursion and bounds oversized lookups', () => {
    const nodes: SavedMoveTreeNode[] = [];
    let children = nodes;
    for (let i = 0; i < 1024; i++) { const node: SavedMoveTreeNode = { uci: 'a0a1', children: [] }; children.push(node); children = node.children!; }
    expect(findSavedTreePath(nodes, Array(1024).fill('a0a1'))).toEqual(Array(1024).fill(0));
    expect(findSavedTreePath(nodes, Array(1025).fill('a0a1'))).toBeNull();
    expect(findSavedTreePath(Array.from({ length: 8193 }, () => ({ uci: 'a0a1' })), ['h2e2'])).toBeNull();
});

const game: SavedGame = { id: 'repeated', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'],
    moveTree: tree, moveTreePath: [1, 1], result: 'red' };

it('preserves validated saved addresses without changing legacy records or source data', () => {
    const before = JSON.stringify(game);
    const restored = normalizeSavedGame(game)!;
    expect(restored.moveTreePath).toEqual([1, 1]);
    expect(restored.moveTreePath).not.toBe(game.moveTreePath);
    expect(JSON.stringify(game)).toBe(before);
    expect(normalizeSavedGame({ ...game, moveTreePath: undefined })?.moveTreePath).toBeUndefined();
    expect(normalizeSavedGame({ ...game, moveTreePath: [1, 9] })?.moveTree).toEqual(tree);
    expect(normalizeSavedGame({ ...game, moveTreePath: [1, 9] })?.moveTreePath).toBeUndefined();
});

it('resolves the selected outcome separately from the pinned main line even when their moves are identical', () => {
    expect(savedGamePositionResult(game)).toBe('red');
    expect(savedGameLine(game)).toEqual({ moves: game.moves, result: 'red' });
    expect(savedGamePositionResult({ ...game, mainLinePinned: true })).toBe('red');
    expect(savedGameLine({ ...game, mainLinePinned: true })).toEqual({ moves: game.moves, result: 'draw' });
    const undeclaredPrimary = [{ ...tree[0], children: [{ uci: 'h9g7' }] }, tree[1]];
    expect(savedGameLine({ ...game, moveTree: undeclaredPrimary, mainLinePinned: true }).result).toBeUndefined();
    expect(savedGameLine({ ...game, moves: ['h2e2', 'b9c7'], moveTreePath: undefined })).toEqual({ moves: ['h2e2', 'b9c7'], result: 'red' });
});

it('preserves exact primary-line annotations and result scope in PGN without mutating the saved tree', () => {
    const before = JSON.stringify(game);
    expect(savedGamePgnInput(game).moveTreePath).toEqual([1, 1]);
    const pgn = buildSavedGamePgn(game)!;
    expect(pgn.indexOf('Second')).toBeLessThan(pgn.indexOf('First'));
    expect(pgn).toContain('[Result "1-0"]');
    const pinned = buildSavedGamePgn({ ...game, mainLinePinned: true })!;
    expect(pinned.indexOf('First')).toBeLessThan(pinned.indexOf('Second'));
    expect(pinned).toContain('[Result "1/2-1/2"]');
    expect(pinned).toContain('Second reply');
    const undeclaredPrimary = [{ ...tree[0], children: [{ uci: 'h9g7' }] }, tree[1]];
    expect(buildSavedGamePgn({ ...game, moveTree: undeclaredPrimary, mainLinePinned: true })).toContain('[Result "*"]');
    expect(buildSavedGamePgn({ ...game, moveTreePath: [1, 9] })).toBeNull();
    expect(JSON.stringify(game)).toBe(before);
});

it('keeps legacy result comparison on the exact saved occurrence', () => {
    const withoutDeclaration = [{ ...tree[0] }, { ...tree[1], children: [{ uci: 'b9c7' }, { uci: 'h9g7', comment: 'Second reply' }] }];
    const legacy = { ...game, moveTree: withoutDeclaration };
    expect(studyContentParts(legacy)).toEqual(studyContentParts({ ...game }));
});

it('carries valid addresses in shared links and rejects malformed or mismatched location parameters', () => {
    const { url } = buildShareUrl('https://example.test/web-xiangqi/', START_POSITION_FEN,
        game.moves, 'PvP', tree, undefined, true, undefined, game.moveTreePath);
    const raw = new URL(url).searchParams.get('path');
    expect(raw).toBe('1.1');
    expect(decodeSavedTreePathParam(raw, tree, game.moves)).toEqual([1, 1]);
    for (const invalid of ['', '1..1', '1.-1', '1.1.1', '1.0', '9.0', '1.'.repeat(6000)]) {
        expect(decodeSavedTreePathParam(invalid, tree, game.moves)).toBeUndefined();
    }
});
