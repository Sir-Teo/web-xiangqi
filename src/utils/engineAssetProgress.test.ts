import { describe, expect, it } from 'vitest';
import {
    ASSET_PROGRESS_STEP_BYTES,
    engineDownloadPercent,
    formatEngineDownload,
    formatEngineDownloadShort,
    shouldPublishAssetProgress,
} from './engineAssetProgress';

const MB = 1024 * 1024;
const at = (loadedMb: number, totalMb = 53, done = false) => ({
    loaded: loadedMb * MB,
    total: totalMb * MB,
    done,
});

describe('shouldPublishAssetProgress', () => {
    it('publishes the first reading', () => {
        expect(shouldPublishAssetProgress(null, at(0))).toBe(true);
    });

    /** A few hundred chunks arrive; the readout moves in megabytes. */
    it('holds back a step the readout would not show', () => {
        expect(shouldPublishAssetProgress(at(12), at(12.4))).toBe(false);
        expect(shouldPublishAssetProgress(at(12), at(13))).toBe(true);
        expect(shouldPublishAssetProgress(at(12), { ...at(12), loaded: 12 * MB + ASSET_PROGRESS_STEP_BYTES })).toBe(true);
    });

    it('always publishes the end of the download', () => {
        expect(shouldPublishAssetProgress(at(53), at(53, 53, true))).toBe(true);
    });

    /** An engine restart begins again, and the readout must go with it. */
    it('publishes a count that has gone backwards', () => {
        expect(shouldPublishAssetProgress(at(40), at(0))).toBe(true);
    });
});

describe('engineDownloadPercent', () => {
    it('reads a percentage off the declared size', () => {
        expect(engineDownloadPercent(at(0))).toBe(0);
        expect(engineDownloadPercent(at(26.5))).toBe(50);
        expect(engineDownloadPercent(at(53))).toBe(100);
    });

    /**
     * `content-length` is the encoded length. GitHub Pages gzips this net to
     * slightly more than it started as, so the decoded body can outrun the
     * number the bar is drawn against.
     */
    it('cannot exceed its own end', () => {
        expect(engineDownloadPercent(at(60))).toBe(100);
        expect(engineDownloadPercent({ loaded: -5, total: 53 * MB, done: false })).toBeNull();
    });

    it('has no percentage without a declared size', () => {
        expect(engineDownloadPercent({ loaded: 4 * MB, total: 0, done: false })).toBeNull();
        expect(engineDownloadPercent(null)).toBeNull();
    });
});

describe('what the status line reads', () => {
    it('names both halves once bytes have arrived', () => {
        expect(formatEngineDownload(at(12))).toBe('12 of 53 MB');
        expect(formatEngineDownloadShort(at(12))).toBe('23%');
    });

    it('keeps one decimal under ten megabytes, where whole numbers stall', () => {
        expect(formatEngineDownload(at(4.5))).toBe('4.5 of 53 MB');
    });

    it('does not print a trailing .0 on a round megabyte', () => {
        expect(formatEngineDownload(at(3))).toBe('3 of 53 MB');
        expect(formatEngineDownloadShort({ loaded: 3 * MB, total: 0, done: false })).toBe('3MB');
    });

    it('says only what it knows when the size was never declared', () => {
        expect(formatEngineDownload({ loaded: 12 * MB, total: 0, done: false })).toBe('12 MB');
        expect(formatEngineDownloadShort({ loaded: 12 * MB, total: 0, done: false })).toBe('12MB');
    });

    /**
     * After the last byte the wait is the engine starting rather than the
     * network, and "53 of 53 MB" would sit there through it claiming otherwise.
     */
    /** The word "Loading" it would replace says more than "0%" does. */
    it('holds the short form back until there is a whole percent of it', () => {
        expect(formatEngineDownloadShort({ loaded: 0.2 * MB, total: 53 * MB, done: false })).toBeNull();
        expect(formatEngineDownloadShort({ loaded: 0.6 * MB, total: 53 * MB, done: false })).toBe('1%');
    });

    it('says nothing before the first byte or after the last', () => {
        expect(formatEngineDownload(null)).toBeNull();
        expect(formatEngineDownload(at(0))).toBeNull();
        expect(formatEngineDownload(at(53, 53, true))).toBeNull();
        expect(formatEngineDownloadShort(at(53, 53, true))).toBeNull();
    });
});
