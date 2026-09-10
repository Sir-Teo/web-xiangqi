/**
 * How the engine's own numbers are written for a reader: the depth badge, the
 * one-line summary under it, and the longer form that goes in the title and the
 * accessible name.
 *
 * All of it is string work over an optional-everything stats record -- the
 * engine reports what it has, when it has it -- so the interesting cases are
 * the absences. Split out of `App.tsx` because a browser gate can only reach
 * the states a real search happens to produce, and the states worth being sure
 * about are the ones it does not: no stats at all, a queued search, a search
 * reporting nodes but no rate, a hash figure of zero.
 */

/** What the engine has told us about the search so far. Every field optional. */
export type EngineTelemetryStats = {
  depth?: number;
  seldepth?: number;
  nodes?: number;
  nps?: number;
  hashfull?: number;
  timeMs?: number;
};

/**
 * Thousands and millions, with one decimal until the number is long enough that
 * the decimal is noise: three figures before the unit is the most this shows,
 * and a trailing `.0` is dropped rather than printed.
 */
export function formatCompactCount(value: number) {
  const normalized = Math.max(0, Math.trunc(value));
  const write = (scaled: number, decimals: number, unit: string) =>
    `${scaled.toFixed(decimals).replace(/\.0$/, '')}${unit}`;

  if (normalized >= 1_000_000) {
    return write(normalized / 1_000_000, normalized >= 10_000_000 ? 0 : 1, 'M');
  }
  if (normalized >= 1_000) {
    const decimals = normalized >= 100_000 ? 0 : 1;
    // Rounding can carry a number out of its own unit: 999,600 nps is 999.6
    // thousand, which to no decimal places is "1000k" -- four figures where the
    // rest of the scale shows three, and a unit the value has just left. Promote
    // it rather than print that.
    if (Number((normalized / 1_000).toFixed(decimals)) >= 1_000) {
      return write(normalized / 1_000_000, 1, 'M');
    }
    return write(normalized / 1_000, decimals, 'k');
  }
  return `${normalized}`;
}

/**
 * With no stats the badge says what the engine is doing instead of what it
 * found; with stats it is the depth, and the selective depth beside it only
 * when the search has actually gone deeper than the nominal one.
 */
export function formatEngineDepthLabel(
  stats: EngineTelemetryStats | null,
  fallbackDepth: number,
  isSearchQueued: boolean,
  isSearching: boolean,
  isReady: boolean,
) {
  if (!stats) {
    if (isSearchQueued) return 'Queued';
    if (isSearching) return 'Pending';
    return isReady ? 'Idle' : 'Booting';
  }

  const depth = stats.depth ?? fallbackDepth;
  const seldepth = stats?.seldepth;
  if (seldepth && seldepth > depth) {
    return `D${depth}/S${seldepth}`;
  }
  return `D${depth}`;
}

/** At most two figures, because this line sits under the badge in a narrow card. */
export function formatEngineTelemetry(
  stats: EngineTelemetryStats | null,
  fallbackDepth: number,
  fallbackMoveTimeMs: number,
  isSearchQueued: boolean,
  isSearching: boolean,
) {
  if (!stats) {
    const target = `target D${fallbackDepth}`;
    if (isSearchQueued) return `${target} · queued`;
    return isSearching ? `${target} · ${fallbackMoveTimeMs}ms` : target;
  }

  const parts: string[] = [];
  if (typeof stats.nps === 'number') {
    parts.push(`${formatCompactCount(stats.nps)} nps`);
  } else if (typeof stats.nodes === 'number') {
    parts.push(`${formatCompactCount(stats.nodes)} nodes`);
  }
  if (typeof stats.hashfull === 'number') {
    parts.push(`hash ${Math.round(stats.hashfull / 10)}%`);
  }
  if (parts.length === 0 && typeof stats.timeMs === 'number') {
    parts.push(`${stats.timeMs}ms`);
  }

  return parts.length > 0 ? parts.slice(0, 2).join(' · ') : `${fallbackMoveTimeMs}ms primary`;
}

/** The long form, for a title and an accessible name: everything the engine said. */
export function formatEngineTelemetryDetail(
  stats: EngineTelemetryStats | null,
  fallbackDepth: number,
  fallbackMoveTimeMs: number,
  isSearchQueued: boolean,
  isSearching: boolean,
  isReady: boolean,
) {
  if (!stats) {
    return `Search ${formatEngineDepthLabel(stats, fallbackDepth, isSearchQueued, isSearching, isReady)}; ${formatEngineTelemetry(stats, fallbackDepth, fallbackMoveTimeMs, isSearchQueued, isSearching)}`;
  }

  const parts = [formatEngineDepthLabel(stats, fallbackDepth, isSearchQueued, isSearching, isReady)];
  if (typeof stats.nodes === 'number') {
    parts.push(`${formatCompactCount(stats.nodes)} nodes`);
  }
  if (typeof stats.nps === 'number') {
    parts.push(`${formatCompactCount(stats.nps)} nps`);
  }
  if (typeof stats.hashfull === 'number') {
    parts.push(`hash ${Math.round(stats.hashfull / 10)}%`);
  }
  if (typeof stats.timeMs === 'number') {
    parts.push(`${stats.timeMs}ms`);
  }
  return `Search ${parts.join(' · ')}`;
}
