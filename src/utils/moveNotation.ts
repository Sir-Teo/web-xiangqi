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
