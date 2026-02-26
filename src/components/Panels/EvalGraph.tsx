import React, { useMemo } from 'react';
import type { MoveRecord } from '../../hooks/useXiangqi';

interface EvalGraphProps {
    history: MoveRecord[];
    currentEval: number;
}

export const EvalGraph: React.FC<EvalGraphProps> = ({ history, currentEval }) => {
    // We construct a series of data points: [0, eval1, eval2, ...]
    const dataPoints = useMemo(() => {
        const points = [0]; // Start game at 0 advantage
        history.forEach(m => {
            // Keep the previous eval if the current move doesn't have one
            const prev = points[points.length - 1];
            points.push(m.evalScore !== undefined ? m.evalScore : prev);
        });

        // Push the current live eval as the latest point
        points.push(currentEval);

        return points;
    }, [history, currentEval]);

    // Dimensions
    const width = 300;
    const height = 150;
    const maxEvalClamp = 1000; // clamp visual at +10.00 / -10.00

    // Generate Path Data
    const generatePath = () => {
        if (dataPoints.length === 0) return '';

        const stepX = width / Math.max(10, dataPoints.length - 1); // at least stretch to 10 moves

        let path = `M 0,${height / 2}`;

        dataPoints.forEach((val, i) => {
            const x = i * stepX;
            // Map value to Y coordinate. 0 is in the middle.
            // +1000 -> 0 (top), -1000 -> height (bottom)
            let clamped = Math.max(-maxEvalClamp, Math.min(maxEvalClamp, val));
            const y = (height / 2) - ((clamped / maxEvalClamp) * (height / 2));

            // Simple line-to to start, curved in future iterations if preferred
            path += ` L ${x},${y}`;
        });

        return path;
    };

    const pathData = generatePath();
    const fillPath = `${pathData} L ${Math.max(10, dataPoints.length - 1) * (width / Math.max(10, dataPoints.length - 1))},${height / 2} L 0,${height / 2} Z`;

    // A split gradient ID
    const gradientId = 'evalGradient';

    return (
        <div style={{ width: '100%', padding: '10px 0', position: 'relative' }}>
            <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible', filter: 'drop-shadow(0px 5px 10px rgba(0,0,0,0.5))' }}>
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(204, 34, 34, 0.7)" /> {/* Red Advantage */}
                        <stop offset="50%" stopColor="rgba(204, 34, 34, 0.1)" />
                        <stop offset="50%" stopColor="rgba(34, 34, 34, 0.1)" />
                        <stop offset="100%" stopColor="rgba(34, 34, 34, 0.7)" /> {/* Black Advantage */}
                    </linearGradient>
                </defs>

                {/* Center line (0.00) */}
                <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255, 255, 255, 0.2)" strokeWidth="1" strokeDasharray="4 4" />

                {/* Highlight fill area */}
                <path d={fillPath} fill={`url(#${gradientId})`} />

                {/* Main line */}
                <path d={pathData} fill="none" stroke="rgba(255, 255, 255, 0.8)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

                {/* Current Eval Dot */}
                {dataPoints.length > 0 && (
                    <circle
                        cx={(dataPoints.length - 1) * (width / Math.max(10, dataPoints.length - 1))}
                        cy={(height / 2) - ((Math.max(-maxEvalClamp, Math.min(maxEvalClamp, dataPoints[dataPoints.length - 1])) / maxEvalClamp) * (height / 2))}
                        r="5"
                        fill="#fff"
                        strokeWidth="2"
                        stroke={dataPoints[dataPoints.length - 1] > 0 ? '#cc2222' : '#222'}
                    />
                )}
            </svg>

            <div style={{ position: 'absolute', top: 0, left: 10, fontSize: '0.8rem', color: '#cc2222', fontWeight: 'bold' }}>Red</div>
            <div style={{ position: 'absolute', bottom: 0, left: 10, fontSize: '0.8rem', color: '#888', fontWeight: 'bold' }}>Black</div>

            <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '1.2rem', fontWeight: 800, fontFamily: 'monospace' }}>
                {currentEval > 0 ? '+' : ''}{(currentEval / 100).toFixed(2)}
            </div>
        </div>
    );
};
