import type { MoveRecord } from '../hooks/useXiangqi';
import { formatMoveRecordLabel } from './moveNotation';
import { describeMoveNumber } from './moveNumbering';
import { formatRecordInStyle, type XiangqiNotationStyle } from './xiangqiNotation';

export function formatBreadcrumbLabel(
    record: MoveRecord | undefined,
    rootFen: string,
    notationStyle: XiangqiNotationStyle,
    isRoot = false,
): string {
    if (isRoot) return 'Start';
    if (!record) return 'Node';
    // Match the move list's notation and fullmove numbering; the accessible
    // title separately identifies the ply in this one-button-per-ply strip.
    const { label } = describeMoveNumber(rootFen, record.ply);
    return `${label} ${notationStyle === 'uci' ? formatMoveRecordLabel(record) : formatRecordInStyle(record, notationStyle)}`;
}
