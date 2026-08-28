/**
 * Short labels describing the shape of a game — "Comeback", "Wire-to-wire" —
 * derived from the evaluations a review already produced.
 *
 * Ported from web-chess's narrativeTags.ts, which took it from web-katrain.
 * The reading is done in winning chances rather than centipawns, reusing
 * getWinningChancePercent so it agrees with the review's own scoring.
 */

import { getWinningChancePercent } from './review';

export type NarrativeTagTone = 'good' | 'bad' | 'neutral';

export interface NarrativeTag {
    id: string;
    label: string;
    tone: NarrativeTagTone;
    title: string;
}

/** Red-positive centipawns, in move order. */
export type NarrativeGameResult = 'red-wins' | 'black-wins' | 'draw' | null;

/** The eventual winner dipped to or below this win percentage. */
const COMEBACK_LOW = 30;
/** The eventual loser reached or passed this win percentage. */
const MISSED_WIN_HIGH = 85;
/** The winner never crossed below this after the opening. */
const WIRE_LEVEL = 50;
/** A decisive game that never strayed further than this from even. */
const TIGHT_BAND = 15;
/** Below this many evaluated moves a game has no arc worth describing. */
const MIN_POINTS = 6;

export function narrativeTags(
    evalScores: Array<number | undefined>,
    result: NarrativeGameResult
): NarrativeTag[] {
    // Carry the last known evaluation forward so an unevaluated move does not
    // read as a swing back to even.
    const series: number[] = [];
    let previous = 0;
    for (const score of evalScores) {
        if (typeof score === 'number' && Number.isFinite(score)) previous = score;
        series.push(getWinningChancePercent(previous, 'red'));
    }
    if (series.length < MIN_POINTS) return [];

    const finalRed = series[series.length - 1];
    const winner: NarrativeGameResult = result
        ?? (Math.abs(finalRed - 50) < 2 ? 'draw' : finalRed >= 50 ? 'red-wins' : 'black-wins');
    if (winner === null) return [];

    // The opening is noisy, so judge swings from a fifth of the way in.
    const start = Math.min(series.length - 1, Math.max(2, Math.floor(series.length * 0.2)));
    const midGame = series.slice(start);
    const minRed = Math.min(...midGame);
    const maxRed = Math.max(...midGame);

    if (winner === 'draw') {
        const tags: NarrativeTag[] = [
            { id: 'draw', label: 'Draw', tone: 'neutral', title: 'The game was drawn.' },
        ];
        const best = Math.max(maxRed, 100 - minRed);
        if (best >= MISSED_WIN_HIGH) {
            tags.push({
                id: 'missedWin',
                label: 'Missed win',
                tone: 'bad',
                title: `${maxRed >= 100 - minRed ? 'Red' : 'Black'} reached a winning position and drew.`,
            });
        }
        return tags;
    }

    const redWon = winner === 'red-wins';
    const winnerName = redWon ? 'Red' : 'Black';
    const loserName = redWon ? 'Black' : 'Red';
    const winnerLowest = redWon ? minRed : 100 - maxRed;
    const loserHighest = redWon ? 100 - minRed : maxRed;

    const tags: NarrativeTag[] = [];

    if (winnerLowest <= COMEBACK_LOW) {
        tags.push({
            id: 'comeback',
            label: 'Comeback',
            tone: 'good',
            title: `${winnerName} recovered from a losing position to win.`,
        });
    } else if (winnerLowest >= WIRE_LEVEL) {
        tags.push({
            id: 'wire',
            label: 'Wire-to-wire',
            tone: 'neutral',
            title: `${winnerName} led from the opening on.`,
        });
    }

    if (loserHighest >= MISSED_WIN_HIGH) {
        tags.push({
            id: 'missedWin',
            label: 'Missed win',
            tone: 'bad',
            title: `${loserName} reached a winning position and lost.`,
        });
    }

    if (tags.length === 0) {
        const widest = Math.max(Math.abs(maxRed - 50), Math.abs(50 - minRed));
        if (widest <= TIGHT_BAND) {
            tags.push({
                id: 'tight',
                label: 'Nail-biter',
                tone: 'neutral',
                title: `The game stayed close throughout before ${winnerName} won.`,
            });
        }
    }

    return tags;
}

export function narrativeTagToneClass(tone: NarrativeTagTone): string {
    switch (tone) {
        case 'good':
            return 'review-narrative review-narrative--good';
        case 'bad':
            return 'review-narrative review-narrative--bad';
        default:
            return 'review-narrative';
    }
}
