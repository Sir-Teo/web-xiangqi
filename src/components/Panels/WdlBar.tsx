import type { WdlStats } from '../../hooks/useEngine';
import './WdlBar.css';

interface WdlBarProps {
    wdl: WdlStats | null;
    isSearching?: boolean;
}

function formatPercent(value: number, total: number) {
    return `${((value / total) * 100).toFixed(1)}%`;
}

export function WdlBar({ wdl, isSearching = false }: WdlBarProps) {
    if (!wdl) {
        return (
            <div className="wdl-bar-wrap">
                <div
                    className="wdl-bar wdl-bar-empty"
                    role="img"
                    aria-label="Win/draw/loss estimate unavailable"
                    title="Win/draw/loss estimate unavailable"
                />
                <div className="wdl-labels">
                    <span className="wdl-label wdl-win">Red —</span>
                    <span className="wdl-label wdl-draw">Draw —</span>
                    <span className="wdl-label wdl-loss">Black —</span>
                </div>
            </div>
        );
    }

    const total = wdl.win + wdl.draw + wdl.loss || 1;
    const winPct = (wdl.win / total) * 100;
    const drawPct = (wdl.draw / total) * 100;
    const lossPct = (wdl.loss / total) * 100;
    const redPercent = formatPercent(wdl.win, total);
    const drawPercent = formatPercent(wdl.draw, total);
    const blackPercent = formatPercent(wdl.loss, total);
    const summary = `Win/draw/loss estimate: Red ${redPercent}, Draw ${drawPercent}, Black ${blackPercent}`;

    return (
        <div className={`wdl-bar-wrap ${isSearching ? 'wdl-bar-live' : ''}`}>
            <div className="wdl-bar" role="img" aria-label={summary} title={summary}>
                <div className="wdl-segment wdl-segment-win" style={{ width: `${winPct}%` }} />
                <div className="wdl-segment wdl-segment-draw" style={{ width: `${drawPct}%` }} />
                <div className="wdl-segment wdl-segment-loss" style={{ width: `${lossPct}%` }} />
            </div>
            <div className="wdl-labels">
                <span className="wdl-label wdl-win">Red {redPercent}</span>
                <span className="wdl-label wdl-draw">Draw {drawPercent}</span>
                <span className="wdl-label wdl-loss">Black {blackPercent}</span>
            </div>
        </div>
    );
}
