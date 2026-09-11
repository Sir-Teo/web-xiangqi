import { memo, type KeyboardEvent } from 'react';

type Props = {
    nodeId: string;
    index: number;
    label: string;
    title: string;
    isCurrent: boolean;
    isTabStop: boolean;
    hasNext: boolean;
    onNavigate: (nodeId: string) => void;
    onFocusIndex: (index: number) => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
};

export const BreadcrumbChip = memo(function BreadcrumbChip({ nodeId, index, label, title,
    isCurrent, isTabStop, hasNext, onNavigate, onFocusIndex, onKeyDown }: Props) {
    return <button
        type="button"
        className={`tree-breadcrumb-chip ${isCurrent ? 'tree-breadcrumb-chip-active' : ''}`}
        onClick={() => onNavigate(nodeId)}
        onFocus={() => onFocusIndex(index)}
        onKeyDown={event => onKeyDown(event, index)}
        tabIndex={isTabStop ? 0 : -1}
        data-breadcrumb-index={index}
        title={title}
        aria-label={title}
        aria-current={isCurrent ? 'true' : undefined}
    >
        {label}
        {hasNext ? <span className="tree-breadcrumb-sep">/</span> : null}
    </button>;
});

BreadcrumbChip.displayName = 'BreadcrumbChip';
