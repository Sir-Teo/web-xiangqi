import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDirectImport, type DirectImportRequest } from './directImport';
import { START_POSITION_FEN } from './xiangqi';

class ReaderWorker {
    static instances: ReaderWorker[] = [];
    onmessage?: (event: { data: unknown }) => void;
    onerror?: (event: { preventDefault: () => void }) => void;
    onmessageerror?: () => void;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() { ReaderWorker.instances.push(this); }
}
const request: DirectImportRequest = { kind: 'plan', text: 'h2e2', fen: START_POSITION_FEN };
const unreadable = 'The game reader returned an unreadable response. Please try again.';
function start(input = request) {
    const controller = new AbortController();
    const promise = readDirectImport(input, controller.signal);
    return { controller, promise, worker: ReaderWorker.instances.at(-1)! };
}

beforeEach(() => { ReaderWorker.instances = []; vi.stubGlobal('Worker', ReaderWorker); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('direct import reader replies', () => {
    it.each([null, undefined, 42, {}, { error: {} }, { kind: 'other' }, { kind: 'text', text: 'h2e2' },
        { kind: 'plan', plan: null }, { kind: 'plan', plan: { kind: 'line', moves: ['h2e2'] } },
        { kind: 'plan', plan: { kind: 'diagram' } }, { kind: 'plan', plan: { kind: 'error' } },
    ])('finishes an unreadable reply with a retryable rejection: %j', async data => {
        const { promise, worker } = start();
        const rejected = expect(promise).rejects.toThrow(unreadable);
        worker.onmessage!({ data });
        await rejected;
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects cyclic flat trees before handing a plan to the app', async () => {
        const { promise, worker } = start();
        const rejected = expect(promise).rejects.toThrow(unreadable);
        worker.onmessage!({ data: { kind: 'plan', plan: { kind: 'line', moves: ['h2e2'], notationRejected: [], dhtmlComments: [], flatMoveTree: [{ uci: 'h2e2', parent: 0 }] } } });
        await rejected;
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('rebuilds a valid line and preserves its metadata and notes', async () => {
        const { promise, worker } = start();
        worker.onmessage!({ data: { kind: 'plan', metadata: { redPlayer: '王' }, plan: {
            kind: 'line', moves: ['h2e2'], hasVariations: false, importedFromNotation: false,
            notationRejected: [], dhtmlComments: [], hadMoreGames: false,
            flatMoveTree: [{ uci: 'h2e2', comment: 'Central cannon', parent: -1 }],
        } } });
        await expect(promise).resolves.toMatchObject({ kind: 'plan', metadata: { redPlayer: '王' }, plan: {
            kind: 'line', moves: ['h2e2'], moveTree: [{ uci: 'h2e2', comment: 'Central cannon' }],
        } });
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it.each([{ kind: 'diagram', startFen: START_POSITION_FEN }, { kind: 'error', message: 'Illegal move h9h8' }])('preserves valid %j plans', async plan => {
        const { promise, worker } = start(); worker.onmessage!({ data: { kind: 'plan', plan } });
        await expect(promise).resolves.toEqual({ kind: 'plan', plan });
    });

    it('accepts decoded file text and rejects a plan sent for a file request', async () => {
        const input: DirectImportRequest = { kind: 'file', bytes: new ArrayBuffer(0), name: 'study.pgn' };
        const good = start(input); good.worker.onmessage!({ data: { kind: 'text', text: '1.h2e2 *' } });
        await expect(good.promise).resolves.toEqual({ kind: 'text', text: '1.h2e2 *' });
        const bad = start(input); const rejected = expect(bad.promise).rejects.toThrow(unreadable);
        bad.worker.onmessage!({ data: { kind: 'plan', plan: { kind: 'diagram', startFen: START_POSITION_FEN } } });
        await rejected;
    });

    it('rebuilds an XQF file with its variations and record details', async () => {
        const { promise, worker } = start({ kind: 'file', bytes: new ArrayBuffer(0), name: 'study.xqf' });
        worker.onmessage!({ data: { kind: 'xqf', record: { version: 18, title: 'Cannon study', moves: ['h2e2'],
            mainLineComplete: true, result: 'draw', flatMoveTree: [{ uci: 'h2e2', parent: -1 }, { uci: 'b2e2', comment: 'Alternative', parent: -1 }],
        } } });
        await expect(promise).resolves.toMatchObject({ kind: 'xqf', record: { version: 18, title: 'Cannon study', moves: ['h2e2'],
            moveTree: [{ uci: 'h2e2' }, { uci: 'b2e2', comment: 'Alternative' }],
        } });
    });

    it('preserves worker error messages and ignores every later callback', async () => {
        const { promise, worker, controller } = start();
        const rejected = expect(promise).rejects.toThrow('Illegal move h9h8');
        worker.onmessage!({ data: { error: 'Illegal move h9h8' } }); await rejected;
        worker.onmessage!({ data: null }); worker.onmessageerror!(); controller.abort();
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('handles a native error without leaving a pending read', async () => {
        const { promise, worker } = start(); const preventDefault = vi.fn();
        const rejected = expect(promise).rejects.toThrow('The game reader could not start');
        worker.onerror!({ preventDefault }); await rejected;
        expect(preventDefault).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('settles on decode failure, cancellation or timeout and ignores late replies', async () => {
        for (const kind of ['decode', 'cancel', 'timeout']) {
            const { promise, worker, controller } = start(); const rejected = expect(promise).rejects.toThrow();
            if (kind === 'decode') worker.onmessageerror!();
            else if (kind === 'cancel') controller.abort();
            else vi.advanceTimersByTime(30_001);
            await rejected; worker.onmessage!({ data: null });
            expect(worker.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
        }
    });
});
