import type { WdlStats } from '../../hooks/useEngine';
import './WdlBar.css';

interface WdlBarProps {
    wdl: WdlStats | null;
    isSearching?: boolean;
}

export function WdlBar({ wdl, isSearching = false }: WdlBarProps) {
    if (!wdl) {
        return (
            <div className="wdl-bar-wrap">
                <div className="wdl-bar wdl-bar-empty" />
                <div className="wdl-labels">
                    <span className="wdl-label wdl-win">W —</span>
                    <span className="wdl-label wdl-draw">D —</span>
                    <span className="wdl-label wdl-loss">L —</span>
                </div>
            </div>
        );
    }

    const total = wdl.win + wdl.draw + wdl.loss || 1;
    const winPct = (wdl.win / total) * 100;
    const drawPct = (wdl.draw / total) * 100;
    const lossPct = (wdl.loss / total) * 100;

    return (
        <div className={`wdl-bar-wrap ${isSearching ? 'wdl-bar-live' : ''}`}>
            <div className="wdl-bar" role="img" aria-label={`Win ${wdl.win} Draw ${wdl.draw} Loss ${wdl.loss}`}>
                <div className="wdl-segment wdl-segment-win" style={{ width: `${winPct}%` }} />
                <div className="wdl-segment wdl-segment-draw" style={{ width: `${drawPct}%` }} />
                <div className="wdl-segment wdl-segment-loss" style={{ width: `${lossPct}%` }} />
            </div>
            <div className="wdl-labels">
                <span className="wdl-label wdl-win">W {wdl.win}</span>
                <span className="wdl-label wdl-draw">D {wdl.draw}</span>
                <span className="wdl-label wdl-loss">L {wdl.loss}</span>
            </div>
        </div>
    );
}
