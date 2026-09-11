import { normalizeSavedMoveTree, type SavedMoveTreeNode } from './gameLibrary';

const MAX_SHARE_TREE_JSON_LENGTH = 8000;
const MAX_SHARE_TREE_PARAM_LENGTH = Math.ceil(MAX_SHARE_TREE_JSON_LENGTH * 4 / 3) + 4;
// Legacy links encode Latin-1 directly. An explicit prefix prevents valid
// UTF-8-looking legacy bytes from changing meaning when those links are read.
const UTF8_PREFIX = 'u.';

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
        if (!/[^\x20-\x7e]/.test(json)) return toBase64Url(json);
        const bytes = new TextEncoder().encode(json);
        // Bound the bytes that become the URL, not only UTF-16 string length.
        if (bytes.length > MAX_SHARE_TREE_JSON_LENGTH) return null;
        const encoded = toBase64Url(String.fromCharCode(...bytes));
        return encoded === null ? null : UTF8_PREFIX + encoded;
    } catch {
        return null;
    }
}

export function decodeSavedMoveTreeParam(value: string | null): SavedMoveTreeNode[] | null {
    if (!value) return null;
    const utf8 = value.startsWith(UTF8_PREFIX);
    const payload = utf8 ? value.slice(UTF8_PREFIX.length) : value;
    if (payload.length > MAX_SHARE_TREE_PARAM_LENGTH) return null;
    try {
        const binary = fromBase64Url(payload);
        if (!binary || binary.length > MAX_SHARE_TREE_JSON_LENGTH) return null;
        const json = utf8
            ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
            : binary;
        if (!json || json.length > MAX_SHARE_TREE_JSON_LENGTH) return null;
        const parsed = JSON.parse(json);
        const normalized = normalizeSavedMoveTree(parsed);
        return normalized?.length ? normalized : null;
    } catch {
        return null;
    }
}
