import { CLOUD_BOOK_ENDPOINT } from './cloudBook';

/**
 * chessdb.cn's adjudication of a repetition: which moves in the position on
 * screen are forbidden under the rules of perpetual check and chase, and
 * which would be ruled a draw.
 *
 * `repetition.ts` classifies perpetual check from the move records and says
 * so; it deliberately does not adjudicate chases, because deciding 長捉 needs
 * to know which piece is being chased, whether it is protected and whether the
 * chaser is really threatening it, with a rulebook of exceptions. chessdb has
 * that machinery, and its `queryrule` action answers the question for the
 * moves of the final position of a line: `move:e0d0,rule:ban` means playing
 * e0d0 repeats a cycle the rules forbid, so the side playing it is ruled to
 * have lost; `draw` means the repetition it makes is a draw.
 *
 * Sent only when the reader has turned the cloud book on, and only once the
 * position has stood here before: the moves of the line leave the machine
 * with it, which the switch's own description says.
 *
 * Reference: https://www.chessdb.cn/cloudbook_api_en.html
 */

export type CloudRuleVerdict = 'none' | 'draw' | 'ban';

export interface CloudRuleMove {
    uci: string;
    rule: CloudRuleVerdict;
}

export type CloudRuleReading =
    | { status: 'ok'; moves: CloudRuleMove[] }
    /** The service refused the board or the moves. */
    | { status: 'invalid' }
    /** The game is over here: checkmate or stalemate. */
    | { status: 'terminal' }
    | { status: 'unreadable' };

/** The service wants the history it adjudicates from to be at least this long. */
export const CLOUD_RULE_MIN_MOVES = 4;

export function buildCloudRuleUrl(rootFen: string, moves: string[]): string {
    const url = new URL(CLOUD_BOOK_ENDPOINT);
    url.searchParams.set('action', 'queryrule');
    url.searchParams.set('board', rootFen.trim());
    url.searchParams.set('movelist', moves.join('|'));
    return url.toString();
}

const UCI_MOVE = /^[a-i][0-9][a-i][0-9]$/;

/** `move:f0f1,rule:none|move:e0d0,rule:ban|...` */
export function parseCloudRuleResponse(text: string): CloudRuleReading {
    const body = String(text ?? '').trim();
    if (!body) return { status: 'unreadable' };
    const lowered = body.toLowerCase();
    if (lowered.startsWith('invalid')) return { status: 'invalid' };
    if (lowered === 'checkmate' || lowered === 'stalemate') return { status: 'terminal' };
    if (!lowered.startsWith('move:')) return { status: 'unreadable' };

    const moves: CloudRuleMove[] = [];
    for (const entry of body.split('|')) {
        const match = entry.trim().match(/^move:([a-i][0-9][a-i][0-9]),rule:(none|draw|ban)$/i);
        if (!match) continue;
        const uci = match[1].toLowerCase();
        if (!UCI_MOVE.test(uci)) continue;
        moves.push({ uci, rule: match[2].toLowerCase() as CloudRuleVerdict });
    }
    if (moves.length === 0) return { status: 'unreadable' };
    return { status: 'ok', moves };
}

/** The moves the reader needs to know about, in the order the service gave them. */
export function summarizeCloudRule(moves: CloudRuleMove[]): { banned: string[]; drawing: string[] } {
    return {
        banned: moves.filter((move) => move.rule === 'ban').map((move) => move.uci),
        drawing: moves.filter((move) => move.rule === 'draw').map((move) => move.uci),
    };
}
