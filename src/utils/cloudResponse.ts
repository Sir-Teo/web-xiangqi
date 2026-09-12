/** Application budget for a single position's book, PV or repetition reply. */
export const MAX_CLOUD_RESPONSE_BYTES = 256 * 1024;

/** Bound decoded network bytes even when Content-Length is absent or compressed. */
export async function readCloudResponse(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return text + decoder.decode();
            bytes += value.byteLength;
            if (bytes > MAX_CLOUD_RESPONSE_BYTES) {
                // Do not wait for a slow source's cancellation acknowledgement.
                void reader.cancel().catch(() => {});
                throw new Error('Cloud reply exceeds the response size limit');
            }
            text += decoder.decode(value, { stream: true });
        }
    } finally {
        reader.releaseLock();
    }
}
