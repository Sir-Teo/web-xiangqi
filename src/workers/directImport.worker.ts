import type { DirectImportRequest, PackedImportResponse } from '../utils/directImport';
import { planMoveLineImport } from '../utils/moveLineImportPlan';
import { validateMoveSequence, validateMoveTree } from '../utils/moveValidation';
import { isXqfFile, parseXqf } from '../utils/xqf';
import { MAX_MOVE_IMPORT_UCI_MOVES } from '../utils/moveImport';
import { extractPgnMetadata } from '../utils/gameMetadata';
import { packCollectionGames } from '../utils/moveTreeTransfer';

self.onmessage = (event: MessageEvent<DirectImportRequest>) => {
    try {
        const request = event.data;
        let response: PackedImportResponse;
        if (request.kind === 'file') {
            const bytes = new Uint8Array(request.bytes);
            if (isXqfFile(bytes) || /\.xqf$/i.test(request.name)) {
                const record = parseXqf(bytes, MAX_MOVE_IMPORT_UCI_MOVES);
                if (!record) throw new Error('Could not read this XQF file: it is not one, or its position cannot be placed.');
                const validation = validateMoveTree(record.moveTree, record.startFen);
                if (!validation.ok) throw new Error(`Move ${validation.move}: ${validation.reason}`);
                response = { kind: 'xqf', record: packCollectionGames([record])[0] };
            } else response = { kind: 'text', text: new TextDecoder().decode(bytes) };
        } else {
            const plan = planMoveLineImport(request.text, request.fen, { validateMoveSequence, validateMoveTree });
            response = { kind: 'plan', plan: plan.kind === 'line' ? packCollectionGames([plan])[0] : plan, metadata: extractPgnMetadata(request.text) };
        }
        self.postMessage(response);
    } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not read this game.' }); }
};
