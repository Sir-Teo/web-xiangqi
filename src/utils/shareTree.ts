import { normalizeSavedMoveTree, type SavedMoveTreeNode } from './gameLibrary';

const MAX_SHARE_TREE_JSON_LENGTH = 12000;

function toBase64Url(value: string): string | null {
    if (typeof globalThis.btoa !== 'function') return null;
    return globalThis.btoa(value)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function fromBase64Url(value: string): string | null {
    if (typeof globalThis.atob !== 'function') return null;
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return globalThis.atob(normalized + padding);
}

export function encodeSavedMoveTreeParam(moveTree: SavedMoveTreeNode[]): string | null {
    try {
        const json = JSON.stringify(moveTree);
        if (!json || json.length > MAX_SHARE_TREE_JSON_LENGTH) return null;
        return toBase64Url(json);
    } catch {
        return null;
    }
}

export function decodeSavedMoveTreeParam(value: string | null): SavedMoveTreeNode[] | null {
    if (!value) return null;
    try {
        const json = fromBase64Url(value);
        if (!json) return null;
        const parsed = JSON.parse(json);
        const normalized = normalizeSavedMoveTree(parsed);
        return normalized?.length ? normalized : null;
    } catch {
        return null;
    }
}
