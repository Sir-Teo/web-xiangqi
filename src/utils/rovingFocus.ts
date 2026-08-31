/**
 * One tab stop for a list that grows with the game.
 *
 * `Board.tsx` already does this for the ninety squares, and says why: every
 * occupied square was `tabIndex={0}`, which made 32 of the page's 130 tab stops
 * board squares, so reaching the move list from the toolbar meant Tab
 * thirty-two times through pieces.
 *
 * The move breadcrumb has the same shape and a worse version of the problem,
 * because it is unbounded. Measured on a 30-ply game: 91 tab stops on the page,
 * 83 of them before the bottom command bar. A real 100-ply game puts a hundred
 * chips between the toolbar and "Save".
 *
 * The arithmetic lives here rather than in the component so it can be tested
 * without a DOM, and so the next list that needs it does not reinvent the
 * off-by-one at each end.
 */

/**
 * Which item carries the tab stop.
 *
 * Preference order matches the board's: wherever focus was last left, then
 * whatever is current, then the last item -- for a breadcrumb the last item is
 * the tip of the line, which is where someone arriving would expect to be. An
 * empty list has no tab stop, which is correct: there is nothing to reach.
 */
export function rovingTabStopIndex(
    count: number,
    rovingIndex: number | null,
    currentIndex: number | null
): number | null {
    if (count <= 0) return null;
    const inRange = (index: number | null): index is number =>
        index !== null && Number.isInteger(index) && index >= 0 && index < count;
    if (inRange(rovingIndex)) return rovingIndex;
    if (inRange(currentIndex)) return currentIndex;
    return count - 1;
}

/**
 * Where a key moves the stop, or null when the key is not one of ours.
 *
 * Returning null rather than the current index matters: the caller uses it to
 * decide whether to call `preventDefault`, and swallowing every key would take
 * Tab and the page's own shortcuts with it.
 *
 * Movement stops at the ends rather than wrapping. Wrapping in a strip that
 * represents a *sequence* reads as a jump from the last move back to the first.
 */
export function rovingIndexForKey(key: string, count: number, from: number): number | null {
    if (count <= 0) return null;
    const clamp = (index: number) => Math.max(0, Math.min(count - 1, index));
    switch (key) {
        case 'ArrowLeft':
            return clamp(from - 1);
        case 'ArrowRight':
            return clamp(from + 1);
        case 'Home':
            return 0;
        case 'End':
            return count - 1;
        default:
            return null;
    }
}
