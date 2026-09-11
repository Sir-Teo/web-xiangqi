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

    it('retains Chinese, accented, and emoji notes in every branch', () => {
        const annotated = [{ uci: 'h2e2', comment: '中炮：先出車 🐎', children: [
            { uci: 'h9g7', comment: 'Défense — 将军' },
            { uci: 'b9c7', comment: '另一种选择' },
        ] }];
        expect(decodeSavedMoveTreeParam(encodeSavedMoveTreeParam(annotated))).toEqual(annotated);
    });

    it('still reads legacy Latin-1 links without reinterpreting their bytes as UTF-8', () => {
        const annotated = [{ uci: 'h2e2', comment: 'Café Ã©' }];
        const legacy = btoa(JSON.stringify(annotated)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        expect(decodeSavedMoveTreeParam(legacy)).toEqual(annotated);
    });

    it('rejects malformed UTF-8 instead of silently changing a note', () => {
        const invalid = btoa('[{"uci":"h2e2","comment":"' + String.fromCharCode(0xc3) + '"}]');
        expect(decodeSavedMoveTreeParam('u.' + invalid)).toBeNull();
    });

    it('bounds Unicode links by encoded bytes', () => {
        const notes = Array.from({ length: 6 }, () => ({ uci: 'h2e2', comment: '中'.repeat(500) }));
        expect(JSON.stringify(notes).length).toBeLessThan(8000);
        expect(encodeSavedMoveTreeParam(notes)).toBeNull();
        const oversized = 'u.' + Buffer.from(JSON.stringify(notes), 'utf8').toString('base64url');
        expect(decodeSavedMoveTreeParam(oversized)).toBeNull();
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
