const PIECE_LABELS: Record<string, string> = {
    K: '帥',
    A: '仕',
    B: '相',
    N: '傌',
    R: '俥',
    C: '炮',
    P: '兵',
    k: '將',
    a: '士',
    b: '象',
    n: '馬',
    r: '車',
    c: '砲',
    p: '卒',
};

const PIECE_NAMES: Record<string, string> = {
    K: 'Red general',
    A: 'Red advisor',
    B: 'Red elephant',
    N: 'Red horse',
    R: 'Red chariot',
    C: 'Red cannon',
    P: 'Red soldier',
    k: 'Black general',
    a: 'Black advisor',
    b: 'Black elephant',
    n: 'Black horse',
    r: 'Black chariot',
    c: 'Black cannon',
    p: 'Black soldier',
};

export interface MoveNotationRecord {
    uci: string;
    piece: string;
    captured?: string;
    /** Whether this move left the opponent in check; see `describeMoveWithCheck`. */
    inCheck?: boolean;
}

function splitUciMove(uci: string) {
    const normalized = String(uci || '').trim();
    if (!/^[a-i][0-9][a-i][0-9]$/i.test(normalized)) {
        return null;
    }
    return {
        from: normalized.slice(0, 2),
        to: normalized.slice(2, 4),
    };
}

export function formatUciMove(uci: string, separator = '→'): string {
    const parts = splitUciMove(uci);
    if (!parts) return String(uci || '').toUpperCase();
    return `${parts.from.toUpperCase()}${separator}${parts.to.toUpperCase()}`;
}

export function formatUciLine(moves: string[], maxMoves = 7): string {
    const visibleMoves = moves.slice(0, maxMoves).map((move) => formatUciMove(move)).join(' ');
    const remainingMoves = moves.length - maxMoves;
    return remainingMoves > 0 ? `${visibleMoves} +${remainingMoves}` : visibleMoves;
}

export function formatMoveRecordLabel(record: MoveNotationRecord): string {
    const piece = PIECE_LABELS[record.piece] ?? record.piece.toUpperCase();
    return `${piece} ${formatUciMove(record.uci, record.captured ? '×' : '→')}`;
}

export function formatMoveRecordTitle(record: MoveNotationRecord): string {
    const piece = PIECE_NAMES[record.piece] ?? record.piece.toUpperCase();
    const parts = splitUciMove(record.uci);
    if (!parts) return `${piece} ${record.uci.toUpperCase()}`;

    const from = parts.from.toUpperCase();
    const to = parts.to.toUpperCase();
    if (!record.captured) return `${piece} from ${from} moves to ${to}`;

    // The captured letter is already here; naming it is the difference between
    // "captures on E2" and knowing what was traded.
    const captured = PIECE_NAMES[record.captured];
    return captured
        ? `${piece} from ${from} captures ${captured} on ${to}`
        : `${piece} from ${from} captures on ${to}`;
}

/**
 * The same description, with the check the notations do not write.
 *
 * `inCheck` is on every record and the board draws its CHECK badge from it,
 * but the badge speaks only for the position on screen -- so reading down the
 * move list or along the breadcrumb, which is how a game is actually read,
 * gave no sign of which moves were checks. In xiangqi that is the shape of the
 * game: it is what perpetual check is made of, and what the repetition verdict
 * is read off.
 *
 * Said in words rather than added to the move on purpose. A record prints a
 * check with no marker at all, and WXF gives the sharper reason: the `+` in
 * `R2+3` already means *advance*, so a `+` appended for check would be one
 * character meaning two things inside one token -- ambiguous to a reader, and
 * to this repo's own parser, which reads a token by asking the formatter what
 * it writes. The visible move stays exactly what a record would print.
 *
 * Kept apart from `formatMoveRecordTitle` rather than folded into it because
 * the board's live region composes its own sentence and already has a `Check.`
 * clause of its own -- and a `Checkmate.` that replaces it. One function that
 * always appended the phrase made that announcement say it twice.
 */
export function describeMoveWithCheck(record: MoveNotationRecord): string {
    const title = formatMoveRecordTitle(record);
    return record.inCheck ? `${title}, giving check` : title;
}
