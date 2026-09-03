/**
 * How far the engine's weights have got, and what to call that on screen.
 *
 * `pikafish.nnue` is 53MB and the engine cannot answer a single thing without
 * it. A first visit therefore spends its whole download on "Loading engine"
 * and no more -- a minute or more on a phone connection, with a board that has
 * no evaluation and nothing saying why. The architecture doc measures the visit
 * at 55MB of which the net is 97.6%, and rules out a smaller one: upstream
 * ships a single "Big" net and nothing else. So the wait is what it is, and the
 * thing to fix is that it is unexplained.
 *
 * The page cannot see the request. The weights are fetched inside the engine's
 * worker, and a worker's fetches appear in neither the document's resource
 * timing nor its network events -- which is why `templates/pikafish.js` reads
 * the body as a stream and posts the count out.
 */
export interface EngineAssetProgress {
    /** Bytes decoded so far. */
    loaded: number;
    /** `content-length`, or the final count once it is known; 0 when neither. */
    total: number;
    done: boolean;
}

/**
 * Mebibytes, called MB the way browsers and file managers label them. The
 * architecture doc quotes the net as 53,719,310 bytes, which is the same file
 * at 51 MB here; the two are not disagreeing about the size.
 */
const BYTES_PER_MB = 1024 * 1024;

/**
 * A chunk is a few hundred kilobytes, so a 53MB download reports a few hundred
 * times. Publishing every one of them would re-render the app for a number that
 * has not visibly changed; a megabyte is the smallest step the readout shows.
 */
export const ASSET_PROGRESS_STEP_BYTES = BYTES_PER_MB;

export function shouldPublishAssetProgress(
    published: EngineAssetProgress | null,
    next: EngineAssetProgress
): boolean {
    if (!published) return true;
    if (next.done !== published.done) return true;
    // A restart begins again from nothing, and going backwards is a change.
    if (next.loaded < published.loaded) return true;
    return next.loaded - published.loaded >= ASSET_PROGRESS_STEP_BYTES;
}

/** Whole percent downloaded, or null when the size was never declared. */
export function engineDownloadPercent(progress: EngineAssetProgress | null): number | null {
    if (!progress || !Number.isFinite(progress.total) || progress.total <= 0) return null;
    if (!Number.isFinite(progress.loaded) || progress.loaded < 0) return null;
    // `content-length` is the encoded length and the body is decoded, so a
    // compressed response can decode past its own declared size. GitHub Pages
    // gzips this net to slightly *more* than it started as, which is the same
    // arithmetic in the other direction; either way the bar cannot pass its end.
    return Math.max(0, Math.min(100, Math.round((progress.loaded / progress.total) * 100)));
}

function megabytes(bytes: number): string {
    const value = bytes / BYTES_PER_MB;
    // A decimal below ten, where whole megabytes would sit still for seconds --
    // but not a trailing `.0`, which reads as spurious precision on a round
    // number.
    if (value >= 10) return `${Math.round(value)}`;
    return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * The readout beside "Loading engine", or null when there is nothing to add --
 * before the first byte, and once the download is done and the wait is the
 * engine starting rather than the network.
 */
export function formatEngineDownload(progress: EngineAssetProgress | null): string | null {
    if (!progress || progress.done) return null;
    if (!Number.isFinite(progress.loaded) || progress.loaded <= 0) return null;
    if (progress.total > 0) {
        return `${megabytes(progress.loaded)} of ${megabytes(progress.total)} MB`;
    }
    return `${megabytes(progress.loaded)} MB`;
}

/** The same in the shortest form that still says what it is, for a phone. */
export function formatEngineDownloadShort(progress: EngineAssetProgress | null): string | null {
    const percent = engineDownloadPercent(progress);
    if (!progress || progress.done) return null;
    if (percent === null) {
        return Number.isFinite(progress.loaded) && progress.loaded > 0 ? `${megabytes(progress.loaded)}MB` : null;
    }
    // "0%" says less than the word it would replace, and on a 53MB net the
    // first percent takes a while.
    return percent > 0 ? `${percent}%` : null;
}
