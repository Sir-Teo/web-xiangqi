import { describe, expect, it } from 'vitest';
import { resultLabel } from './savedGameLabels';

describe('the badge on a game card', () => {
    it('names the three results a game can have', () => {
        expect(resultLabel('red')).toBe('Red wins');
        expect(resultLabel('black')).toBe('Black wins');
        expect(resultLabel('draw')).toBe('Draw');
    });

    it('says a game in progress is in progress', () => {
        expect(resultLabel('ongoing')).toBe('Ongoing');
    });

    it('does not call a game with no stored result a draw', () => {
        // `result` is optional on a saved game and `normalizeSavedGame` drops
        // one it does not recognise, so this case is reachable. It used to fall
        // through to "Draw", giving a game a result it never had -- the chain
        // read as complete because historical games, which share this function,
        // always carry one.
        expect(resultLabel(undefined)).toBe('No result');
    });
});
