import { MAX_CLOUD_RESPONSE_BYTES } from './cloudResponse';
import { BoundedLruCache } from './boundedCache';
/**
 * The chessdb.cn xiangqi cloud book (象棋云库): what it says about a position,
 * read into a shape the app can draw.
 *
 * Every serious xiangqi player checks the cloud book -- it is the closest thing
 * the game has to a master database, built from engine analysis at depths no
 * browser will reach and from the games it has been fed. Pikafish itself is
 * one of its engines. The service answers plain GET requests from a browser
 * page, which was checked from this app before any of this was written: the
 * start position came back in 1.2s with sixteen ranked moves.
 *
 * Only the position leaves the machine, and only when the reader has turned
 * the lookup on. `App.tsx` keeps that switch; this file knows nothing about it.
 *
 * Reference: https://www.chessdb.cn/cloudbook_api_en.html
 */

export const CLOUD_BOOK_ENDPOINT = 'https://www.chessdb.cn/chessdb.php';
export const CLOUD_BOOK_SITE_NAME = 'chessdb.cn';

export interface CloudBookMove {
    uci: string;
    /** Centipawns from the side to move, the convention the service uses. */
    score: number;
    /** 2 is a best move, 1 a good one, 0 a known but worse one. */
    rank: number;
    /** The service's own annotation, e.g. "! (44-02)"; kept verbatim. */
    note: string;
    /** Percent, side to move, when the service reports one. */
    winrate: number | null;
}

export type CloudBookReading =
    | { status: 'ok'; moves: CloudBookMove[] }
    /** The position is not in the book. Common past the opening. */
    | { status: 'unknown' }
    /** The service refused the FEN. */
    | { status: 'invalid' }
    /** The game is over here: checkmate or stalemate. */
    | { status: 'terminal' }
    /** Something the parser did not recognise; treated as no reading. */
    | { status: 'unreadable' };

export function buildCloudBookUrl(fen: string): string {
    const url = new URL(CLOUD_BOOK_ENDPOINT);
    url.searchParams.set('action', 'queryall');
    url.searchParams.set('board', fen.trim());
    return url.toString();
}

const UCI_MOVE = /^[a-i][0-9][a-i][0-9]$/;

/**
 * `move:c3c4,score:1,rank:2,note:! (44-02),winrate:50.08|move:...`
 *
 * The note carries spaces and parentheses, so fields are split on the commas
 * that start a known key rather than on every comma. Anything the service says
 * that is not a move list -- "unknown", "invalid board", "checkmate",
 * "stalemate", "nobestmove" -- is a status of its own.
 */
export function parseCloudBookResponse(text: string): CloudBookReading {
    const raw = String(text ?? '');
    // Also bound direct parser calls before splitting or allocating move records.
    if (raw.length > MAX_CLOUD_RESPONSE_BYTES) return { status: 'unreadable' };
    const body = raw.trim();
    if (!body) return { status: 'unreadable' };
    const lowered = body.toLowerCase();
    if (lowered === 'unknown' || lowered === 'nobestmove') return { status: 'unknown' };
    if (lowered.startsWith('invalid')) return { status: 'invalid' };
    if (lowered === 'checkmate' || lowered === 'stalemate') return { status: 'terminal' };
    if (!lowered.startsWith('move:')) return { status: 'unreadable' };

    const moves: CloudBookMove[] = [];
    for (const entry of body.split('|')) {
        const fields = new Map<string, string>();
        for (const part of entry.split(/,(?=(?:move|score|rank|note|winrate):)/)) {
            const colon = part.indexOf(':');
            if (colon < 0) continue;
            fields.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
        }
        const uci = (fields.get('move') ?? '').toLowerCase();
        if (!UCI_MOVE.test(uci)) continue;
        const score = Number(fields.get('score'));
        const rank = Number(fields.get('rank'));
        const winrateRaw = fields.get('winrate');
        const winrate = winrateRaw === undefined || winrateRaw === '' ? Number.NaN : Number(winrateRaw);
        moves.push({
            uci,
            score: Number.isFinite(score) ? score : 0,
            rank: Number.isFinite(rank) ? rank : 0,
            note: fields.get('note') ?? '',
            winrate: Number.isFinite(winrate) ? winrate : null,
        });
    }
    if (moves.length === 0) return { status: 'unreadable' };
    // The service already orders by score; keep that, but make it explicit so a
    // reordered response cannot put a worse move first.
    moves.sort((a, b) => b.score - a.score);
    return { status: 'ok', moves };
}

/**
 * The book's score, written the way the rest of the app writes evaluations:
 * Red-positive, in pawns, one decimal.
 */
export function formatCloudBookScore(score: number, sideToMove: 'w' | 'b'): string {
    const redPov = sideToMove === 'b' ? -score : score;
    const pawns = redPov / 100;
    // A single centipawn either way is level, and '+0.0' reads as a sign error.
    const text = pawns.toFixed(1);
    if (text === '0.0' || text === '-0.0') return '0.0';
    return `${pawns > 0 ? '+' : ''}${text}`;
}

/** A bounded most-recently-used cache, keyed on the FEN as sent. */
/**
 * Kept as a name rather than a class: `BoundedLruCache` is the same cache the
 * other two cloud hooks now share, and this is what the book calls it.
 */
export class CloudBookCache extends BoundedLruCache<CloudBookReading> {}
