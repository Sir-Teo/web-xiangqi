import type { MoveLineImportPlan } from './moveLineImportPlan';
import type { XqfRecord } from './xqf';
import type { GameMetadata } from './gameMetadata';
import { inflateMoveTree, type PackedGame } from './moveTreeTransfer';

type LinePlan = Extract<MoveLineImportPlan, { kind: 'line' }>;
export type DirectImportRequest = { kind: 'file'; bytes: ArrayBuffer; name: string } | { kind: 'plan'; text: string; fen: string };
export type DirectImportResponse = { kind: 'text'; text: string } | { kind: 'xqf'; record: XqfRecord } | { kind: 'plan'; plan: MoveLineImportPlan; metadata?: GameMetadata };
export type PackedImportResponse = { kind: 'text'; text: string } | { kind: 'xqf'; record: PackedGame<XqfRecord> } | { kind: 'plan'; plan: Exclude<MoveLineImportPlan, LinePlan> | PackedGame<LinePlan>; metadata?: GameMetadata };

export function readDirectImport(request: DirectImportRequest, signal: AbortSignal): Promise<DirectImportResponse> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new Error('Import cancelled')); return; }
        const worker = new Worker(new URL('../workers/directImport.worker.ts', import.meta.url), { type: 'module' });
        const clean = () => { worker.terminate(); clearTimeout(timer); signal.removeEventListener('abort', cancel); };
        const fail = (message: string) => { clean(); reject(new Error(message)); };
        const cancel = () => fail('Import cancelled');
        const timer = setTimeout(() => fail('Reading this game took too long. Try a smaller file or import it through the library.'), 30_000);
        signal.addEventListener('abort', cancel, { once: true });
        worker.onerror = () => fail('The game reader could not start. Please try again.');
        worker.onmessageerror = () => fail('The game reader returned an unreadable response. Please try again.');
        worker.onmessage = (event: MessageEvent<PackedImportResponse | { error: string }>) => {
            clean();
            const data = event.data;
            if ('error' in data) { reject(new Error(data.error)); return; }
            if (data.kind === 'xqf') {
                const { flatMoveTree, ...record } = data.record;
                resolve({ kind: 'xqf', record: { ...record, moveTree: inflateMoveTree(flatMoveTree ?? []) } });
            } else if (data.kind === 'plan' && data.plan.kind === 'line') {
                const { flatMoveTree, ...plan } = data.plan;
                resolve({ ...data, plan: { ...plan, moveTree: inflateMoveTree(flatMoveTree ?? []) } });
            } else resolve(data as DirectImportResponse);
        };
        try { worker.postMessage(request, request.kind === 'file' ? [request.bytes] : []); }
        catch { fail('The game could not be sent to the reader. Please try again.'); }
    });
}
