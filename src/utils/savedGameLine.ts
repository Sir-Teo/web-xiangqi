import type { SavedGame, SavedMoveTreeNode } from './gameLibrary';
import { findSavedTreePath, savedNodeAtPath } from './savedTreePath';

/** The declaration at the saved cursor, before any unplayed continuation or pinned line. */
export function savedGamePositionResult(game: SavedGame): SavedGame['result'] {
    if (!game.moves.length) return toSavedResult(game.rootResult) ?? game.result;
    const endpoint = savedNodeAtPath(game.moveTree, findSavedTreePath(game.moveTree, game.moves, game.moveTreePath));
    return toSavedResult(endpoint?.recordedResult) ?? game.result;
}

/** The PGN primary line: a pinned first-child path, or the saved path continued. */
export function savedGameLine(game: SavedGame): { moves: string[]; result: SavedGame['result'] } {
    if (!game.moveTree?.length) {
        const rootResult = game.moves.length ? undefined : game.rootResult;
        return { moves: game.moves, result: toSavedResult(rootResult) ?? game.result };
    }
    const moves: string[] = [];
    const seen = new Set<SavedMoveTreeNode>();
    const savedPath = findSavedTreePath(game.moveTree, game.moves, game.moveTreePath);
    if (!game.mainLinePinned && savedPath === null) return { moves: game.moves, result: game.result };
    let children: SavedMoveTreeNode[] | undefined = game.moveTree;
    let endpoint: SavedMoveTreeNode | undefined;
    while (children?.length) {
        const index = game.mainLinePinned ? 0 : savedPath?.[moves.length] ?? 0;
        const node: SavedMoveTreeNode | undefined = children[index];
        // Do not reinterpret a damaged saved path as a different game.
        if (!node || seen.has(node)) return { moves: game.moves, result: game.result };
        seen.add(node);
        moves.push(node.uci);
        endpoint = node;
        children = node.children;
    }
    if (!game.mainLinePinned && moves.length < game.moves.length) return { moves: game.moves, result: game.result };
    const atSavedEndpoint = endpoint === savedNodeAtPath(game.moveTree, savedPath);
    return { moves, result: toSavedResult(endpoint?.recordedResult) ?? (atSavedEndpoint ? game.result : undefined) };
}

function toSavedResult(result: SavedMoveTreeNode['recordedResult']): SavedGame['result'] {
    if (result === 'red-wins') return 'red';
    if (result === 'black-wins') return 'black';
    return result;
}
