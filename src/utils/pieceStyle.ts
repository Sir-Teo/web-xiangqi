/**
 * How a piece is drawn: the traditional character, or the WXF letter.
 *
 * The characters are the game, and a player who knows them wants nothing
 * else. A beginner does not know them, and 仕/士, 相/象, 傌/馬, 俥/車 are
 * pairs that differ by a stroke -- so a board of thirty-two characters is a
 * board they cannot read, and the move list beside it, written in WXF by
 * default, uses letters they have already met. The letter set is the WXF
 * one for that reason: the K on the board is the K in `K5+1`.
 */
export type PieceStyle = 'traditional' | 'letters';

export const PIECE_STYLES: PieceStyle[] = ['traditional', 'letters'];

export function isPieceStyle(value: unknown): value is PieceStyle {
    return value === 'traditional' || value === 'letters';
}

export const PIECE_STYLE_LABELS: Record<PieceStyle, string> = {
    traditional: '帥 將',
    letters: 'K A E',
};

export const PIECE_STYLE_DESCRIPTIONS: Record<PieceStyle, string> = {
    traditional: 'The characters on a real set, red and black as printed.',
    letters: 'WXF letters, the ones the move list uses: K, A, E, H, R, C, P.',
};

const TRADITIONAL: Record<string, string> = {
    K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵',
    k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒',
};

/** WXF: E for elephant and H for horse, matching `xiangqiNotation`. */
const LETTERS: Record<string, string> = {
    K: 'K', A: 'A', B: 'E', N: 'H', R: 'R', C: 'C', P: 'P',
};

/** What to draw on a piece; the piece code itself for anything unknown. */
export function pieceLabel(piece: string, style: PieceStyle): string {
    if (style === 'letters') return LETTERS[piece.toUpperCase()] ?? piece;
    return TRADITIONAL[piece] ?? piece;
}
