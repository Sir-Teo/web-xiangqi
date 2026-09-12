import { describe, expect, it, vi } from 'vitest';
import { MAX_CLOUD_RESPONSE_BYTES, readCloudResponse } from './cloudResponse';
import { parseCloudBookResponse } from './cloudBook';
import { parseCloudPvResponse } from './cloudPv';
import { parseCloudRuleResponse } from './cloudRule';

describe('bounded cloud responses', () => {
    it('preserves UTF-8 split across chunks and accepts the exact byte budget', async () => {
        const bytes = new TextEncoder().encode('炮🐎');
        const response = new Response(new ReadableStream({ start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
        } }));
        expect(await readCloudResponse(response)).toBe('炮🐎');
        const exact = 'x'.repeat(MAX_CLOUD_RESPONSE_BYTES);
        expect(await readCloudResponse(new Response(exact))).toBe(exact);
    });

    it.each([undefined, '1'])('cancels an oversized stream with Content-Length %s', async (length) => {
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const response = new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new Uint8Array(MAX_CLOUD_RESPONSE_BYTES));
            controller.enqueue(Uint8Array.of(1));
            // No close: rejection must not wait for EOF or cancellation.
        }, cancel }), { headers: length ? { 'Content-Length': length } : {} });
        await expect(readCloudResponse(response)).rejects.toThrow('size limit');
        expect(cancel).toHaveBeenCalledOnce();
        expect(response.body?.locked).toBe(false);
    });

    it('counts UTF-8 bytes rather than characters', async () => {
        await expect(readCloudResponse(new Response('炮'.repeat(MAX_CLOUD_RESPONSE_BYTES / 2))))
            .rejects.toThrow('size limit');
    });

    it('releases a failed stream and handles a missing body', async () => {
        const response = new Response(new ReadableStream({ pull(controller) { controller.error(new Error('offline')); } }));
        await expect(readCloudResponse(response)).rejects.toThrow('offline');
        expect(response.body?.locked).toBe(false);
        expect(await readCloudResponse(new Response(null))).toBe('');
    });

    it('rejects oversized parser input before recognizing a status or move prefix', () => {
        for (const parse of [parseCloudBookResponse, parseCloudPvResponse, parseCloudRuleResponse]) {
            for (const prefix of ['unknown', 'invalid', 'move:h2e2,score:1,rank:0,note:x|', 'score:1,depth:2,pv:h2e2|']) {
                expect(parse(prefix + ' '.repeat(MAX_CLOUD_RESPONSE_BYTES))).toEqual({ status: 'unreadable' });
            }
        }
    });
});
