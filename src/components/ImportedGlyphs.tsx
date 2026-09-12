import { useLayoutEffect, useRef, useState } from 'react';
import { chooseMoveGlyph, describeGlyph, glyphSymbol } from '../utils/moveGlyphs';
import './ImportedGlyphs.css';

export function ImportedGlyphs({ nags, onChange, disabled, gameIdentity }: {
    nags: number[] | undefined; onChange: (nags: number[] | undefined) => void; disabled: boolean; gameIdentity: unknown;
}) {
    const [code, setCode] = useState('');
    const [choice, setChoice] = useState('');
    const [error, setError] = useState('');
    const [announcement, setAnnouncement] = useState('');
    const addSelect = useRef<HTMLSelectElement>(null);
    useLayoutEffect(() => { setCode(''); setChoice(''); setError(''); setAnnouncement(''); }, [gameIdentity]);
    const apply = (value: number) => {
        onChange(chooseMoveGlyph(nags, value));
        setAnnouncement(`Study annotation applied: ${describeGlyph(value)}.`);
    };
    return <details className="imported-glyphs" data-testid="imported-glyphs">
        <summary>Move annotations{nags?.length ? ` (${nags.length})` : ''}</summary>
        <p>Import or add study symbols here. Engine review keeps them. Without a study move judgement, PGN export can use the review’s grade.</p>
        <form onSubmit={event => { event.preventDefault(); if (choice) apply(Number(choice)); }}>
        <label>Add or replace a judgement
            <select className="app-select app-select-roomy" ref={addSelect} aria-label="Add study annotation" aria-describedby={choice ? 'glyph-choice-description' : undefined} value={choice} disabled={disabled}
                onChange={event => setChoice(event.target.value)}>
                <option value="" disabled>Choose a symbol…</option>
                {[['Move judgement', 1, 9], ['Position', 10, 19]].map(([label, first, last]) => <optgroup key={label} label={String(label)}>
                    {Array.from({ length: Number(last) - Number(first) + 1 }, (_, index) => Number(first) + index).map(value =>
                        <option key={value} value={value}>{glyphSymbol(value)} — {describeGlyph(value)}</option>)}
                </optgroup>)}
            </select>
            {choice && <span id="glyph-choice-description">{describeGlyph(Number(choice))}</span>}
        </label>
        <button type="submit" disabled={disabled || !choice}>Apply symbol</button>
        </form>
        <ul>{nags?.map(value => <li key={value}>
            <span><strong>{glyphSymbol(value)}</strong> {describeGlyph(value)} <small>${value}</small></span>
            <button type="button" disabled={disabled} aria-label={`Remove ${describeGlyph(value)} ($${value})`}
                onClick={() => { onChange(nags.filter(code => code !== value)); setAnnouncement(`Study annotation removed: ${describeGlyph(value)}.`); addSelect.current?.focus(); }}>Remove</button>
        </li>)}</ul>
        <details className="glyph-code-editor">
            <summary>Numeric PGN code</summary>
            <form onSubmit={event => {
                event.preventDefault();
                if (!/^\d{1,3}$/.test(code) || Number(code) > 255) { setError('Enter a whole number from 0 to 255.'); return; }
                apply(Number(code)); setCode(''); setError('');
            }}>
                <label>Code (0–255)<input aria-label="Numeric PGN annotation" inputMode="numeric" maxLength={3} value={code}
                    aria-invalid={Boolean(error)} aria-describedby={error ? 'glyph-code-error' : undefined}
                    disabled={disabled} onChange={event => { setCode(event.target.value); setError(''); }} /></label>
                <button type="submit" disabled={disabled || !code}>Add code</button>
                {error && <p id="glyph-code-error" role="alert">{error}</p>}
            </form>
        </details>
        <p className="sr-only" role="status">{announcement}</p>
    </details>;
}
