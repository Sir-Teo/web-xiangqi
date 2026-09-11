/** A declared game outcome, distinct from an engine score or the current board. */
export type RecordedResult = 'red-wins' | 'black-wins' | 'draw';
export const RESULT_TAG: Record<RecordedResult, string> = { 'red-wins': '1-0', 'black-wins': '0-1', draw: '1/2-1/2' };
export function normalizeRecordedResult(value: unknown): RecordedResult | undefined {
    return value === 'red-wins' || value === 'black-wins' || value === 'draw' ? value : undefined;
}
export function parseResultTag(value: unknown): RecordedResult | undefined {
    return value === '1-0' ? 'red-wins' : value === '0-1' ? 'black-wins' : value === '1/2-1/2' ? 'draw' : undefined;
}
export function recordedResultPgn(value: unknown): string {
    const result = normalizeRecordedResult(value);
    return result ? `[%xqresult ${RESULT_TAG[result]}]` : '';
}
export function readRecordedResultPgn(comment: string): RecordedResult | undefined {
    return parseResultTag(/\[%xqresult\s+(1\/2-1\/2|1-0|0-1)\s*\]/.exec(comment)?.[1]);
}
