type ClockNode = {
    parentId: string | null;
    record?: { captured?: unknown; inCheck?: boolean; sideToMove?: 'w' | 'b' } | null;
};

/**
 * Pikafish's rule-60 FEN counter. A capture resets it; a quiet soldier move does
 * not. Only the first ten checks by each side and their replies count.
 * Keep the common case to one backward scan ending at the latest capture.
 */
export function halfmoveClockAtNode(
    tree: Record<string, ClockNode | undefined>,
    nodeId: string,
    rootId: string,
    rootClock: number
): number {
    let clock = 0;
    let base = rootClock;
    const checks = [0, 0];
    let cursor: string | null = nodeId;
    while (cursor && cursor !== rootId) {
        const node: ClockNode | undefined = tree[cursor];
        if (!node) break;
        const record: ClockNode['record'] = node.record;
        if (record?.captured) { base = 0; break; }
        if (record) {
            clock++;
            if (record.inCheck) checks[record.sideToMove === 'b' ? 0 : 1]++;
        }
        cursor = node.parentId;
    }
    // The engine's check10 counters also increase for excluded replies, but
    // only crossing ten affects rule60. Actual checks give the same threshold.
    // Walk back over the excess checks, deducting each excluded ply once even
    // when a checking reply is excluded for both reasons. No ancestry array.
    cursor = nodeId;
    while (cursor && cursor !== rootId && (checks[0] > 10 || checks[1] > 10)) {
        const node: ClockNode | undefined = tree[cursor];
        if (!node || node.record?.captured) break;
        const record: ClockNode['record'] = node.record;
        if (record) {
            const mover = record.sideToMove === 'b' ? 0 : 1;
            const previous = node.parentId ? tree[node.parentId]?.record : undefined;
            if ((record.inCheck && checks[mover] > 10)
                || (previous?.inCheck && checks[1 - mover] > 10)) clock--;
            if (record.inCheck) checks[mover]--;
        }
        cursor = node.parentId;
    }
    return base + clock;
}
