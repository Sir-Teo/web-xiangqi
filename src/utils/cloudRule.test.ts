import { describe, expect, it } from 'vitest';
import { currentCloudRuleState, buildCloudRuleUrl, parseCloudRuleResponse, summarizeCloudRule } from './cloudRule';

// The service's own answer, recorded, to a chariot checking a bare general
// back and forth from a0: after the fourth check the next one is forbidden.
const LIVE_REPLY = 'move:f0f1,rule:none|move:e0d0,rule:ban|move:e0c0,rule:none|move:e0b0,rule:none|move:e0e1,rule:draw ';

describe('buildCloudRuleUrl', () => {
    it('sends the root and the moves pipe-separated, as the service wants', () => {
        const url = new URL(buildCloudRuleUrl('3k5/9/9/9/9/9/9/9/9/R4K3 w - - 0 1', ['a0d0', 'd9e9', 'd0e0', 'e9d9']));
        expect(url.searchParams.get('action')).toBe('queryrule');
        expect(url.searchParams.get('board')).toBe('3k5/9/9/9/9/9/9/9/9/R4K3 w - - 0 1');
        expect(url.searchParams.get('movelist')).toBe('a0d0|d9e9|d0e0|e9d9');
    });
});

describe('parseCloudRuleResponse', () => {
    it('reads each move and its verdict', () => {
        const reading = parseCloudRuleResponse(LIVE_REPLY);
        expect(reading.status).toBe('ok');
        if (reading.status !== 'ok') return;
        expect(reading.moves).toEqual([
            { uci: 'f0f1', rule: 'none' },
            { uci: 'e0d0', rule: 'ban' },
            { uci: 'e0c0', rule: 'none' },
            { uci: 'e0b0', rule: 'none' },
            { uci: 'e0e1', rule: 'draw' },
        ]);
        expect(summarizeCloudRule(reading.moves)).toEqual({ banned: ['e0d0'], drawing: ['e0e1'] });
    });

    it('names the refusals and the ends of the game', () => {
        expect(parseCloudRuleResponse('invalid movelist ')).toEqual({ status: 'invalid' });
        expect(parseCloudRuleResponse('invalid board')).toEqual({ status: 'invalid' });
        expect(parseCloudRuleResponse('checkmate')).toEqual({ status: 'terminal' });
        expect(parseCloudRuleResponse('')).toEqual({ status: 'unreadable' });
        expect(parseCloudRuleResponse('<html>busy</html>')).toEqual({ status: 'unreadable' });
    });
});


describe('verdict freshness', () => {
    const verdict = { status: 'ok' as const, key: 'line-a', banned: ['a0a1'], drawing: ['b0c2'] };
    it('does not expose a previous line even before the next effect runs', () => {
        expect(currentCloudRuleState(verdict, 'line-b', true))
            .toEqual({ status: 'loading', key: 'line-b', banned: [], drawing: [] });
    });
    it('hides a ruling as soon as the user opts out or repetition no longer applies', () => {
        expect(currentCloudRuleState(verdict, 'line-a', false))
            .toEqual({ status: 'off', key: 'line-a', banned: [], drawing: [] });
    });
    it('keeps the current verdict and request failures', () => {
        expect(currentCloudRuleState(verdict, 'line-a', true)).toBe(verdict);
        const failure = { status: 'error' as const, key: 'line-b', banned: [], drawing: [] };
        expect(currentCloudRuleState(failure, 'line-b', true)).toBe(failure);
    });
});
