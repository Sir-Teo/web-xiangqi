import React from 'react';
import { describeEvalBar, readEvalBar } from '../../utils/evalBar';
import type { BoardOrientation } from './Board';

interface EvalBarProps {
    /** Red-positive centipawns, or null when nothing has been evaluated. */
    evalScore: number | null;
    /** The same reading as text, mate included, as the rest of the app writes it. */
    evalText: string | null;
    /** Red-perspective qualifier when the reported score is only a bound. */
    boundText?: string;
    orientation: BoardOrientation;
}

/**
 * The evaluation beside the board, which every comparable board has and this
 * one did not.
 *
 * The number was on screen already -- as a chip in the board header and again
 * in the graph panel -- but reading a position off `+0.38` is a skill, and the
 * thing a bar gives you that a number cannot is the answer at a glance and
 * without arithmetic. That is most of its value to a beginner and it is why a
 * strong player still keeps one in view.
 *
 * Red's share fills from red's own end, so the bar flips with the board: on a
 * flipped board red is at the top and so is red's fill. A bar that stayed put
 * while the board turned would be read backwards by exactly the people who
 * flipped it.
 */
export const EvalBar = React.memo(function EvalBar({ evalScore, evalText, boundText, orientation }: EvalBarProps) {
    const { redShare, measured } = readEvalBar(evalScore);
    const redPercent = redShare * 100;
    const redAtBottom = orientation === 'red';

    return (
        <div
            className={`eval-bar${measured ? '' : ' eval-bar-idle'}`}
            role="img"
            aria-label={describeEvalBar(evalScore, evalText, boundText)}
            data-testid="eval-bar"
        >
            <div className="eval-bar-track">
                <div
                    className="eval-bar-red"
                    style={{
                        height: `${redPercent}%`,
                        ...(redAtBottom ? { bottom: 0 } : { top: 0 }),
                    }}
                />
                <div className="eval-bar-midline" />
            </div>
            <span className="eval-bar-readout" aria-hidden="true" title={measured ? boundText : undefined}>
                {measured && evalText ? evalText : '—'}
                {measured && evalText && boundText && <span className="board-eval-bound" data-testid="board-eval-bound">Bound</span>}
            </span>
        </div>
    );
});
