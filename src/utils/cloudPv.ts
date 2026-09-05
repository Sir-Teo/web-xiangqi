/**
 * The cloud book's own line for a position: chessdb.cn's `querypv`.
 *
 * `queryall` (see `cloudBook.ts`) says what is played here and how each move
 * scores. This is the other thing the database knows and the one a strong
 * player asks for: the line it would play on, to a depth no browser reaches
 * -- 62 plies from the opening position, against the 20-odd a live search
 * here settles at. It is the second request the cloud book makes per
 * position, and it goes out under the same switch, since it sends the same
 * thing.
 *
 * Reference: https://www.chessdb.cn/cloudbook_api_en.html
 */
import { CLOUD_BOOK_ENDPOINT } from './cloudBook';

export interface CloudPvReading {
    /** Centipawns from the side to move, the service's convention. */
    score: number;
    depth: number;
    /** UCI moves from the position asked about. */
    moves: string[];
}

export type CloudPvResult =
    | { status: 'ok'; line: CloudPvReading }
    /** Nothing stored for this position. */
    | { status: 'unknown' }
    | { status: 'invalid' }
    | { status: 'terminal' }
    | { status: 'unreadable' };

export function buildCloudPvUrl(fen: string): string {
    const url = new URL(CLOUD_BOOK_ENDPOINT);
    url.searchParams.set('action', 'querypv');
    url.searchParams.set('board', fen.trim());
    return url.toString();
}

const UCI_MOVE = /^[a-i][0-9][a-i][0-9]$/;

/** `score:1,depth:62,pv:c3c4|b7c7|...` -- moves separated by bars, not spaces. */
export function parseCloudPvResponse(text: string): CloudPvResult {
    const body = String(text ?? '').trim();
    if (!body) return { status: 'unreadable' };
    const lowered = body.toLowerCase();
    if (lowered === 'unknown' || lowered === 'nobestmove') return { status: 'unknown' };
    if (lowered.startsWith('invalid')) return { status: 'invalid' };
    if (lowered === 'checkmate' || lowered === 'stalemate') return { status: 'terminal' };

    const score = Number(body.match(/(?:^|,)score:(-?\d+)/)?.[1]);
    const depth = Number(body.match(/(?:^|,)depth:(\d+)/)?.[1]);
    const pv = body.match(/(?:^|,)pv:([^,]*)/)?.[1] ?? '';
    if (!Number.isFinite(score) || !Number.isFinite(depth)) return { status: 'unreadable' };

    const moves: string[] = [];
    for (const token of pv.split('|')) {
        const move = token.trim().toLowerCase();
        if (!UCI_MOVE.test(move)) break;
        moves.push(move);
    }
    if (moves.length === 0) return { status: 'unreadable' };
    return { status: 'ok', line: { score, depth, moves } };
}
