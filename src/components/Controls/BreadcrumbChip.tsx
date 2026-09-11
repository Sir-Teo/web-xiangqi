import { memo, type KeyboardEvent } from 'react';
import type { MoveRecord } from '../../hooks/useXiangqi';
import { formatBreadcrumbLabel } from '../../utils/moveBreadcrumb';
import { formatMoveRecordTitle } from '../../utils/moveNotation';
import type { XiangqiNotationStyle } from '../../utils/xiangqiNotation';

type Props = {
    nodeId: string;
    index: number;
    record?: MoveRecord;
    rootFen: string;
    notationStyle: XiangqiNotationStyle;
    isRoot: boolean;
    isCurrent: boolean;
    isTabStop: boolean;
    hasNext: boolean;
    onFocusIndex: (index: number) => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
};

export const BreadcrumbChip = memo(function BreadcrumbChip({ nodeId, index, record, rootFen, notationStyle, isRoot,
    isCurrent, isTabStop, hasNext, onFocusIndex, onKeyDown }: Props) {
    const label = formatBreadcrumbLabel(record, rootFen, notationStyle, isRoot);
    const title = isRoot ? 'Start position' : record ? `Ply ${record.ply}: ${formatMoveRecordTitle(record)}` : 'Move node';
    return <button
        type="button"
        className={`tree-breadcrumb-chip ${isCurrent ? 'tree-breadcrumb-chip-active' : ''}`}
        onFocus={() => onFocusIndex(index)}
        onKeyDown={event => onKeyDown(event, index)}
        tabIndex={isTabStop ? 0 : -1}
        data-breadcrumb-index={index}
        data-breadcrumb-node-id={nodeId}
        title={title}
        aria-label={title}
        aria-current={isCurrent ? 'true' : undefined}
    >
        {label}
        {hasNext ? <span className="tree-breadcrumb-sep">/</span> : null}
    </button>;
});

BreadcrumbChip.displayName = 'BreadcrumbChip';
