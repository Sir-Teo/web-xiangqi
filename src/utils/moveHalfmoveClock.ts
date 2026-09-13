type ClockNode = {
    parentId: string | null;
    record?: { captured?: unknown } | null;
};

/** The board's capture clock counts plies since a capture, including soldier moves. */
export function halfmoveClockAtNode(
    tree: Record<string, ClockNode | undefined>,
    nodeId: string,
    rootId: string,
    rootClock: number
): number {
    let clock = 0;
    let cursor: string | null = nodeId;
    while (cursor && cursor !== rootId) {
        const node: ClockNode | undefined = tree[cursor];
        if (!node) break;
        if (node.record?.captured) return clock;
        if (node.record) clock++;
        cursor = node.parentId;
    }
    return rootClock + clock;
}
