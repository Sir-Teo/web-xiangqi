import { plyOffsetFromRootFen } from './gamePhase';
import type { Side } from './xiangqi';

/**
 * What number a move is called, and which side played it.
 *
 * The rule — two plies to a move, counted from the root FEN's own fullmove
 * counter — had grown four separate statements before this file: the FEN
 * builder's `fullmoveForPly` in `useXiangqi.ts`, `makeMoveListEntry` in
 * `MoveListTree.tsx`, `plyOffsetFromRootFen` in `gamePhase.ts`, and the
 * breadcrumb, which had quietly stopped stating it at all.
 *
 * ## The breadcrumb was numbering plies and punctuating them as moves
 *
 * `nodeLabel` rendered `${record.ply}. ${move}`, so the same move carried two
 * different numbers on one screen. On a 40-ply game the breadcrumb's last chip
 * read `39. C8-6` while the move list, directly beneath it, called that move
 * `20. C8-6`. Neither number is wrong for what it counts; what is wrong is
 * writing a ply index in the punctuation a move number uses, next to the real
 * move numbers, in a tool whose users say "move 20" to each other.
 *
 * The chip's `aria-label` said `Ply 39` and still does, which is the honest
 * reading of a strip with one chip per ply — it is only the visible number,
 * sitting beside the move list, that had to agree with it.
 *
 * Ply is 1-based here and counts from the start of the **line**, which is what
 * a `MoveRecord` stores; the root's offset is what turns it into a number for
 * the game. A study loaded from a FEN at move 20 therefore numbers its first
 * move 20, not 1.
 */
export interface MoveNumbering {
    /** The move number this ply belongs to, as a player would say it. */
    moveNumber: number;
    /** Who played it. */
    side: Side;
    /** `20.` for Red, `20...` for Black — the move list's own row labels. */
    label: string;
}

export function describeMoveNumber(rootFen: string, ply: number): MoveNumbering {
    const linePly = Math.max(1, Math.trunc(Number(ply) || 1));
    const absolutePly = plyOffsetFromRootFen(rootFen) + linePly;
    const side: Side = absolutePly % 2 === 1 ? 'w' : 'b';
    const moveNumber = Math.floor((absolutePly - 1) / 2) + 1;
    return {
        moveNumber,
        side,
        // Black's ellipsis is the convention every record uses for a move
        // written without the Red move it answers, and it is what makes a
        // breadcrumb chip readable on its own.
        label: side === 'w' ? `${moveNumber}.` : `${moveNumber}...`,
    };
}
