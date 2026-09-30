import type { PvLine } from '../hooks/useEngine';
/** Search effort changes belong to telemetry; a changed recommendation belongs to the board. */
export function samePvReading(previous: PvLine[], next: PvLine[]): boolean {
    return previous.length === next.length && previous.every((line, index) => {
        const other = next[index];
        return line.depth === other.depth && line.score === other.score && line.scoreStr === other.scoreStr
            && line.searchTag === other.searchTag && line.multipv === other.multipv
            && line.bounded === other.bounded && line.bound === other.bound
            && line.wdl?.win === other.wdl?.win && line.wdl?.draw === other.wdl?.draw && line.wdl?.loss === other.wdl?.loss
            && line.moves.length === other.moves.length && line.moves.every((move, ply) => move === other.moves[ply]);
    });
}
