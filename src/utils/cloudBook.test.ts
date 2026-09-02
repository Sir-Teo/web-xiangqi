import { describe, expect, it } from 'vitest';
import {
    CloudBookCache,
    buildCloudBookUrl,
    formatCloudBookScore,
    parseCloudBookResponse,
} from './cloudBook';

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

describe('buildCloudBookUrl', () => {
    it('asks for every known move of the position', () => {
        const url = new URL(buildCloudBookUrl(START));
        expect(url.origin).toBe('https://www.chessdb.cn');
        expect(url.searchParams.get('action')).toBe('queryall');
        expect(url.searchParams.get('board')).toBe(START);
    });
});

describe('parseCloudBookResponse', () => {
    // Recorded from the live service for the start position, first entries.
    const live = 'move:c3c4,score:1,rank:2,note:! (44-02),winrate:50.08|move:g3g4,score:1,rank:2,note:! (44-02),winrate:50.08|move:b2e2,score:0,rank:1,note:* (45-02),winrate:50.00|move:h2e2,score:-3,rank:0,note:? (45-02),winrate:49.92';

    it('reads the recorded reply, note and all', () => {
        const reading = parseCloudBookResponse(live);
        expect(reading.status).toBe('ok');
        if (reading.status !== 'ok') return;
        expect(reading.moves.map((m) => m.uci)).toEqual(['c3c4', 'g3g4', 'b2e2', 'h2e2']);
        expect(reading.moves[0]).toEqual({ uci: 'c3c4', score: 1, rank: 2, note: '! (44-02)', winrate: 50.08 });
        expect(reading.moves[3].score).toBe(-3);
    });

    it('keeps the best score first even if the service reorders', () => {
        const reading = parseCloudBookResponse('move:h2e2,score:-3,rank:0,note:?,winrate:49|move:c3c4,score:5,rank:2,note:!,winrate:51');
        expect(reading.status === 'ok' && reading.moves[0].uci).toBe('c3c4');
    });

    it('tolerates a missing winrate and an unknown key', () => {
        const reading = parseCloudBookResponse('move:c3c4,score:1,rank:2,note:,extra:x');
        expect(reading.status === 'ok' && reading.moves[0].winrate).toBeNull();
    });

    it('names the replies that are not move lists', () => {
        expect(parseCloudBookResponse('unknown')).toEqual({ status: 'unknown' });
        expect(parseCloudBookResponse('nobestmove')).toEqual({ status: 'unknown' });
        expect(parseCloudBookResponse('invalid board')).toEqual({ status: 'invalid' });
        expect(parseCloudBookResponse('checkmate')).toEqual({ status: 'terminal' });
        expect(parseCloudBookResponse('')).toEqual({ status: 'unreadable' });
        expect(parseCloudBookResponse('<html>rate limited</html>')).toEqual({ status: 'unreadable' });
    });

    it('drops an entry whose move is not a square pair', () => {
        const reading = parseCloudBookResponse('move:zz99,score:1,rank:2,note:|move:c3c4,score:1,rank:2,note:');
        expect(reading.status === 'ok' && reading.moves.map((m) => m.uci)).toEqual(['c3c4']);
    });
});

describe('formatCloudBookScore', () => {
    it('writes the side-to-move score Red-positive in pawns', () => {
        expect(formatCloudBookScore(40, 'w')).toBe('+0.4');
        expect(formatCloudBookScore(40, 'b')).toBe('-0.4');
        expect(formatCloudBookScore(0, 'b')).toBe('0.0');
        expect(formatCloudBookScore(-1, 'b')).toBe('0.0');
        expect(formatCloudBookScore(3, 'w')).toBe('0.0');
        expect(formatCloudBookScore(-6, 'w')).toBe('-0.1');
    });
});

describe('CloudBookCache', () => {
    it('evicts the least recently read entry first', () => {
        const cache = new CloudBookCache(2);
        cache.set('a', { status: 'unknown' });
        cache.set('b', { status: 'unknown' });
        cache.get('a');
        cache.set('c', { status: 'unknown' });
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toEqual({ status: 'unknown' });
        expect(cache.size).toBe(2);
    });
});
