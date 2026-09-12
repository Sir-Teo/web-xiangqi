import { describeGlyph, glyphSymbol } from '../utils/moveGlyphs';
import './ImportedGlyphs.css';

export function ImportedGlyphs({ nags }: { nags: number[] | undefined }) {
    if (!nags?.length) return null;
    return <details className="imported-glyphs" data-testid="imported-glyphs">
        <summary>Imported annotations ({nags.length})</summary>
        <p>Symbols supplied with this move. Engine review keeps them.</p>
        <ul>{nags.map(code => <li key={code}><strong>{glyphSymbol(code)}</strong> {describeGlyph(code)} <small>${code}</small></li>)}</ul>
    </details>;
}
