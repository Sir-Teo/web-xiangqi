import type { MoveLineImportPlan } from './moveLineImportPlan';
import type { XqfRecord } from './xqf';
import type { GameMetadata } from './gameMetadata';
import { inflateMoveTree, type PackedGame } from './moveTreeTransfer';

type LinePlan = Extract<MoveLineImportPlan, { kind: 'line' }>;
const UNREADABLE_RESPONSE = 'The game reader returned an unreadable response. Please try again.';
export type DirectImportRequest = { kind: 'file'; bytes: ArrayBuffer; name: string } | { kind: 'plan'; text: string; fen: string };
export type DirectImportResponse = { kind: 'text'; text: string } | { kind: 'xqf'; record: XqfRecord } | { kind: 'plan'; plan: MoveLineImportPlan; metadata?: GameMetadata };
export type PackedImportResponse = { kind: 'text'; text: string } | { kind: 'xqf'; record: PackedGame<XqfRecord> } | { kind: 'plan'; plan: Exclude<MoveLineImportPlan, LinePlan> | PackedGame<LinePlan>; metadata?: GameMetadata };

export function readDirectImport(request: DirectImportRequest, signal: AbortSignal): Promise<DirectImportResponse> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new Error('Import cancelled')); return; }
        const worker = new Worker(new URL('../workers/directImport.worker.ts', import.meta.url), { type: 'module' });
        let finished = false;
        const clean = () => { finished = true; worker.terminate(); clearTimeout(timer); signal.removeEventListener('abort', cancel); };
        const fail = (message: string) => { if (finished) return; clean(); reject(new Error(message)); };
        const succeed = (response: DirectImportResponse) => { clean(); resolve(response); };
        const cancel = () => fail('Import cancelled');
        const timer = setTimeout(() => fail('Reading this game took too long. Try a smaller file or import it through the library.'), 30_000);
        signal.addEventListener('abort', cancel, { once: true });
        worker.onerror = event => { event.preventDefault(); fail('The game reader could not start. Please try again.'); };
        worker.onmessageerror = () => fail(UNREADABLE_RESPONSE);
        worker.onmessage = (event: MessageEvent<PackedImportResponse | { error: string }>) => {
            if (finished) return;
            try {
                const data = event.data;
                if (!data || typeof data !== 'object') throw new Error();
                if ('error' in data) { fail(typeof data.error === 'string' && data.error ? data.error : UNREADABLE_RESPONSE); return; }
                if ((request.kind === 'plan') !== (data.kind === 'plan')) throw new Error();
                if (data.kind === 'text' && typeof data.text === 'string') {
                    succeed(data);
                } else if (data.kind === 'xqf' && data.record && Array.isArray(data.record.moves) && Array.isArray(data.record.flatMoveTree)) {
                    const { flatMoveTree, ...record } = data.record;
                    succeed({ kind: 'xqf', record: { ...record, moveTree: inflateMoveTree(flatMoveTree) } });
                } else if (data.kind === 'plan' && data.plan && typeof data.plan === 'object') {
                    if (data.plan.kind === 'line' && Array.isArray(data.plan.moves) && Array.isArray(data.plan.flatMoveTree)
                        && Array.isArray(data.plan.notationRejected) && Array.isArray(data.plan.dhtmlComments)) {
                        const { flatMoveTree, ...plan } = data.plan;
                        succeed({ ...data, plan: { ...plan, moveTree: inflateMoveTree(flatMoveTree) } });
                    } else if ((data.plan.kind === 'diagram' && typeof data.plan.startFen === 'string')
                        || (data.plan.kind === 'error' && typeof data.plan.message === 'string')) {
                        succeed({ ...data, plan: data.plan });
                    } else throw new Error();
                } else throw new Error();
            } catch { fail(UNREADABLE_RESPONSE); }
        };
        try { worker.postMessage(request, request.kind === 'file' ? [request.bytes] : []); }
        catch { fail('The game could not be sent to the reader. Please try again.'); }
    });
}
