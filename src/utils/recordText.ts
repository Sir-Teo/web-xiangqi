import { describeMoveNumber } from './moveNumbering';
import { formatRecordInStyle, type XiangqiNotationStyle } from './xiangqiNotation';
import type { BoardState } from './xiangqi';

type RecordLike = { uci: string; piece: string; captured?: string; board: BoardState; ply: number };

/**
 * The game as a numbered record in the reader's notation -- the text a player
 * pastes into a chat, a forum post or a notebook.
 *
 * A PGN carries the same moves as coordinates plus tags nobody outside an
 * engine wants to read, and a Chinese-speaking player writes a game as
 * `1. 炮二平五 馬８進７` and nothing else. One move pair per line, which is how
 * every printed record lays it out; a line that starts with Black -- a game
 * set up from a FEN with Black to move -- gets the ellipsis a printed record
 * uses for the same case.
 */
export function formatRecordText(
    records: RecordLike[],
    rootFen: string,
    style: XiangqiNotationStyle
): string {
    const lines: string[] = [];
    let pending: string | null = null;
    for (const record of records) {
        const { moveNumber, side } = describeMoveNumber(rootFen, record.ply);
        const text = formatRecordInStyle(record, style);
        if (side === 'w') {
            if (pending !== null) lines.push(pending);
            pending = `${moveNumber}. ${text}`;
        } else if (pending !== null) {
            lines.push(`${pending} ${text}`);
            pending = null;
        } else {
            lines.push(`${moveNumber}. ... ${text}`);
        }
    }
    if (pending !== null) lines.push(pending);
    return lines.join('\n');
}
