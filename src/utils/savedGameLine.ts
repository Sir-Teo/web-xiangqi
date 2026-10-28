import type { SavedGame, SavedMoveTreeNode } from './gameLibrary';

/** The declaration at the saved cursor, before any unplayed continuation or pinned line. */
export function savedGamePositionResult(game: SavedGame): SavedGame['result'] {
    if (!game.moves.length) return toSavedResult(game.rootResult) ?? game.result;
    let children = game.moveTree;
    let endpoint: SavedMoveTreeNode | undefined;
    for (const uci of game.moves) {
        endpoint = children?.find(node => node.uci === uci);
        if (!endpoint) return game.result;
        children = endpoint.children;
    }
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
    let children: SavedMoveTreeNode[] | undefined = game.moveTree;
    let endpoint: SavedMoveTreeNode | undefined;
    while (children?.length) {
        const preferred: string | undefined = game.mainLinePinned ? undefined : game.moves[moves.length];
        const node: SavedMoveTreeNode | undefined = preferred
            ? children.find(child => child.uci === preferred) : children[0];
        // Do not reinterpret a damaged saved path as a different game.
        if (!node || seen.has(node)) return { moves: game.moves, result: game.result };
        seen.add(node);
        moves.push(node.uci);
        endpoint = node;
        children = node.children;
    }
    if (!game.mainLinePinned && moves.length < game.moves.length) return { moves: game.moves, result: game.result };
    const atSavedEndpoint = moves.length === game.moves.length && moves.every((move, i) => move === game.moves[i]);
    return { moves, result: toSavedResult(endpoint?.recordedResult) ?? (atSavedEndpoint ? game.result : undefined) };
}

function toSavedResult(result: SavedMoveTreeNode['recordedResult']): SavedGame['result'] {
    if (result === 'red-wins') return 'red';
    if (result === 'black-wins') return 'black';
    return result;
}
