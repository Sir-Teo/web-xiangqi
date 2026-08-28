import { describe, expect, it } from 'vitest';
import { decodeSavedMoveTreeParam, encodeSavedMoveTreeParam } from './shareTree';
import type { SavedMoveTreeNode } from './gameLibrary';

const TREE: SavedMoveTreeNode[] = [
    { uci: 'h2e2', children: [{ uci: 'h9g7', children: [{ uci: 'b0c2' }] }, { uci: 'b9c7' }] },
];

describe('sharing a tree in a URL', () => {
    it('round-trips a tree with its branches', () => {
        const param = encodeSavedMoveTreeParam(TREE)!;
        expect(param).toBeTruthy();
        expect(decodeSavedMoveTreeParam(param)).toEqual(TREE);
    });

    it('produces something safe to put in a URL', () => {
        const param = encodeSavedMoveTreeParam(TREE)!;
        expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(encodeURIComponent(param)).toBe(param);
    });

    it('refuses a tree too big to share', () => {
        const huge: SavedMoveTreeNode[] = Array.from({ length: 5000 }, () => ({ uci: 'h2e2' }));
        expect(encodeSavedMoveTreeParam(huge)).toBeNull();
    });

    it('reads nothing from an absent or unusable parameter', () => {
        expect(decodeSavedMoveTreeParam(null)).toBeNull();
        expect(decodeSavedMoveTreeParam('')).toBeNull();
        expect(decodeSavedMoveTreeParam('not base64!!')).toBeNull();
        expect(decodeSavedMoveTreeParam('x'.repeat(20_000))).toBeNull();
    });

    it('refuses a payload that decodes but is not a tree', () => {
        const encode = (value: unknown) =>
            btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        expect(decodeSavedMoveTreeParam(encode({ not: 'a tree' }))).toBeNull();
        expect(decodeSavedMoveTreeParam(encode([]))).toBeNull();
        expect(decodeSavedMoveTreeParam(encode([{ uci: 'bogus' }]))).toBeNull();
        expect(decodeSavedMoveTreeParam(encode('a string'))).toBeNull();
    });

    it('drops the empty children key on the way through', () => {
        const param = encodeSavedMoveTreeParam([{ uci: 'h2e2', children: [] }])!;
        expect(decodeSavedMoveTreeParam(param)).toEqual([{ uci: 'h2e2' }]);
    });
});
