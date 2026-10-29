export function rowOffsets(keys: readonly string[], measured: ReadonlyMap<string, number>, estimate = 36): number[] {
    const offsets = [0];
    for (const key of keys) offsets.push(offsets[offsets.length - 1] + (measured.get(key) ?? estimate));
    return offsets;
}

export function rowAtOffset(offsets: readonly number[], offset: number): number {
    let low = 0, high = Math.max(0, offsets.length - 2);
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (offsets[middle] <= offset) low = middle; else high = middle - 1;
    }
    return low;
}

export function visibleRowIndices(offsets: readonly number[], top: number, height: number, keep: readonly number[] = [], overscan = 6): number[] {
    const count = offsets.length - 1;
    if (count <= 0) return [];
    const start = Math.max(0, rowAtOffset(offsets, top) - overscan);
    const end = Math.min(count - 1, rowAtOffset(offsets, top + height) + overscan);
    const indices = new Set(keep.filter(index => index >= 0 && index < count));
    for (let index = start; index <= end; index++) indices.add(index);
    return [...indices].sort((a, b) => a - b);
}

export function breadcrumbWindow(count: number, focus: number, size = 48): number[] {
    if (count <= size) return Array.from({ length: count }, (_, index) => index);
    const start = Math.max(1, Math.min(count - size, focus - Math.floor(size / 2)));
    return [...new Set([0, ...Array.from({ length: size }, (_, index) => start + index), count - 1])].sort((a, b) => a - b);
}
