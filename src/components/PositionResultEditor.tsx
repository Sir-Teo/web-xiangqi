import { useId } from 'react';
import { normalizeRecordedResult, type RecordedResult } from '../utils/recordedResult';
import './PositionResultEditor.css';

export function PositionResultEditor({ value, automaticResult, target, disabled, onChange }: {
  value?: RecordedResult;
  automaticResult?: RecordedResult;
  target: string;
  disabled: boolean;
  onChange: (result: RecordedResult | undefined) => void;
}) {
  const id = useId();
  return <div className="position-result-editor" data-testid="position-result-editor">
    <label htmlFor={id}>Result at this position <span>{target}</span></label>
    <select id={id} value={automaticResult ?? value ?? ''} disabled={disabled || Boolean(automaticResult)}
      aria-describedby={`${id}-help`} onChange={event => onChange(normalizeRecordedResult(event.target.value))}>
      <option value="">Not recorded</option>
      <option value="red-wins">Red wins</option>
      <option value="black-wins">Black wins</option>
      <option value="draw">Draw</option>
    </select>
    <p id={`${id}-help`}>{automaticResult ? 'Checkmate or stalemate determines this result.'
      : disabled ? 'Wait for the move or pause play to edit this result.'
        : 'Record a resignation or agreed draw. This result stays with the selected position in saves and PGN exports.'}</p>
  </div>;
}
