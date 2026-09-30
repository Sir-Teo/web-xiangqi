import { samePvReading } from '../utils/samePvReading';
import { createEngineTelemetryStore, type EngineTelemetryStore } from '../utils/engineTelemetryStore';
import type { EvaluationScoreKind } from '../utils/engineEvalReading';
import { parseScoreBound, type ScoreBound } from '../utils/engineScore';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { EngineRuntimeVariant } from '../utils/analysisProfile';
import { detectEngineBootConfig } from '../utils/analysisProfile';
import { MATE_SCORE_BASE, emptyEvalReading, takeEvalReading } from '../utils/engineEvalReading';
import { shouldPublishAssetProgress, type EngineAssetProgress } from '../utils/engineAssetProgress';

// Advanced wrapper hook for Pikafish engine communication in Web Worker
const OUTPUT_LINE_LIMIT = 100;
const INFO_FLUSH_MS = 200;
const ENGINE_SCRIPT_LOAD_TIMEOUT_MS = 12000;
const ENGINE_READY_TIMEOUT_MS = 90000;

export type PvLine = {
    depth: string;
    score: number;
    scoreStr: string;
    moves: string[];
    multipv?: number;
    searchTag: string | null;
    /** The engine reported this score as a bound, not a value. */
    bounded?: boolean;
    /** Direction in the engine's side-to-move perspective, if reported unambiguously. */
    bound?: ScoreBound;
    /** Win/draw/loss per mille for the side to move, when UCI_ShowWDL is on. */
    wdl?: WdlStats;
    /** Reported with this PV, independent of later search-wide telemetry. */
    effort?: EngineSearchEffort;
};

export type WdlStats = { win: number; draw: number; loss: number };

export type EngineSearchStats = {
    depth?: number;
    seldepth?: number;
    nodes?: number;
    nps?: number;
    hashfull?: number;
    timeMs?: number;
};

export type EngineSearchEffort = Pick<EngineSearchStats, 'nodes' | 'timeMs' | 'seldepth'>;

type SearchRequest = {
    positionCmd: string;
    goCmd: string;
    signature: string;
    tag?: string;
};

type WindowWithEngineQa = Window & { __WEB_XIANGQI_ENGINE_READY_TIMEOUT_MS?: number };

export interface EngineInitOptions {
    enabled?: boolean;
    variant?: EngineRuntimeVariant;
    allowSIMD?: boolean;
    threads?: number;
    hashMB?: number;
    captureInfoLines?: boolean;
    onBestMove?: (uci: string, score: number, searchTag: string | null, pvLines: PvLine[], hasEvaluation: boolean, hasExactEvaluation: boolean, scoreKind?: EvaluationScoreKind) => void;
    onWorkerError?: (message: string) => void;
    restartToken?: number;
}

function detectSIMDSupport(): boolean {
    try {
        return WebAssembly.validate(new Uint8Array([
            0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,
            10,10,1,8,0,65,0,253,15,253,98,11
        ]));
    } catch (_) { return false; }
}

/**
 * How much of the machine the engine gets, when the caller has not said.
 *
 * This used to be two functions here that read `window.innerWidth <= 900` and
 * decided threads and hash from it. App.tsx already explains, next to
 * `detectDeviceScreen`, why that is wrong: a window made short -- dragged
 * smaller, or with devtools opened -- crosses the threshold and reboots the
 * engine single-threaded on hardware that has not changed, and an off-screen
 * tab reports 0 and looks like the weakest device there is. The repo had
 * learned that lesson in one file and left the same mistake in the other,
 * because the judgement was written down twice.
 *
 * The two disagreed by 3x on threads on the machine this was written on: 18
 * cores and 32GB, where the device tier says 3 threads and 64MB and the window
 * said 1 thread and 16MB. Nothing reached the wrong one -- App.tsx is the only
 * caller and it always passes a config from `analysisProfile` -- so this was a
 * default waiting for a second caller to find it.
 */
function defaultEngineBootConfig() {
    return detectEngineBootConfig();
}

function getEngineReadyTimeoutMs() {
    if (typeof window === 'undefined') return ENGINE_READY_TIMEOUT_MS;
    const override = Number((window as WindowWithEngineQa).__WEB_XIANGQI_ENGINE_READY_TIMEOUT_MS);
    if (Number.isFinite(override) && override > 0) {
        return Math.max(50, Math.trunc(override));
    }
    return ENGINE_READY_TIMEOUT_MS;
}

function getEngineAssetUrl(fileName = '') {
    if (typeof window === 'undefined') return `${import.meta.env.BASE_URL}${fileName}`;
    return new URL(fileName, new URL(import.meta.env.BASE_URL, window.location.href)).href;
}

function logEngineDiagnosticWarning(message: string, ...details: unknown[]) {
    if (import.meta.env.DEV) {
        console.warn(message, ...details);
    }
}

function logEngineDiagnosticError(message: string, ...details: unknown[]) {
    if (import.meta.env.DEV) {
        console.error(message, ...details);
    }
}

function hasPikafishRuntimeHint(value: string) {
    const normalized = value.toLowerCase();
    return normalized.includes('pikafish.js') ||
        normalized.includes('pikafish-core') ||
        normalized.includes('pikafishcore') ||
        normalized.includes('pikafish worker') ||
        normalized.includes('worker engine');
}

function hasMemoryAccessOutOfBounds(value: string) {
    return value.toLowerCase().includes('memory access out of bounds');
}

function reasonToDiagnosticText(reason: unknown) {
    if (!reason) return '';
    if (reason instanceof Error) {
        return [reason.name, reason.message, reason.stack].filter(Boolean).join('\n');
    }
    if (typeof reason === 'object') {
        const record = reason as Record<string, unknown>;
        return [record.name, record.message, record.stack, String(reason)].filter(Boolean).join('\n');
    }
    return String(reason);
}

export function shouldSuppressEngineRuntimeError(filename: string, message: string) {
    const normalizedFilename = String(filename || '');
    const normalizedMessage = String(message || '');
    return hasMemoryAccessOutOfBounds(normalizedMessage) && hasPikafishRuntimeHint(normalizedFilename);
}

export function shouldSuppressEngineRuntimeRejection(reason: unknown) {
    const diagnostic = reasonToDiagnosticText(reason);
    return hasMemoryAccessOutOfBounds(diagnostic) && hasPikafishRuntimeHint(diagnostic);
}

/** `upperbound` / `lowerbound` on a UCI info line: the score is not exact. */
export const BOUNDED_SCORE_PATTERN = /\b(?:upperbound|lowerbound)\b/;

export function isBoundedScoreLine(line: string): boolean {
    return BOUNDED_SCORE_PATTERN.test(line);
}

/**
 * Whether a freshly parsed line should replace the one already in its multipv
 * slot.
 *
 * Almost always yes -- later lines are deeper or better informed. The exception
 * is a bound arriving after the exact score at the same depth, which is what an
 * aspiration re-search produces. web-chess had the same last-line-wins shape
 * and put "at least +9" on its eval bar for a +3 position; the browser test
 * there reproduced it. A deeper bound still wins, because depth is the stronger
 * signal and it is the most the engine has said about the position.
 */
export function shouldReplacePvLine(previous: PvLine | undefined, next: PvLine): boolean {
    if (!previous) return true;
    if (!next.bounded) return true;
    if (previous.bounded) return true;
    return Number(next.depth) > Number(previous.depth);
}

export function parseBestMoveUci(message: string) {
    const match = String(message).trim().match(/^bestmove\s+([a-i][0-9][a-i][0-9])(?:\s|$)/i);
    return match?.[1].toLowerCase() ?? '';
}

export function parsePvUciMoves(value: string) {
    const moves: string[] = [];
    for (const token of String(value).trim().split(/\s+/)) {
        if (!token) continue;
        if (!/^[a-i][0-9][a-i][0-9]$/i.test(token)) break;
        moves.push(token.toLowerCase());
    }
    return moves;
}

export function useEngine(options: EngineInitOptions = {}) {
    const [isReady, setIsReady] = useState(false);
    // A fast replacement can become ready within the same React batch that
    // marked its predecessor unready. Session identity must still change.
    const [readySessionId, setReadySessionId] = useState(0);
    const [engineName, setEngineName] = useState<string | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [variant, setVariant] = useState<string>('unknown');
    const telemetryRef = useRef<EngineTelemetryStore | null>(null);
    if (!telemetryRef.current) telemetryRef.current = createEngineTelemetryStore();
    const [pvLines, setPvLines] = useState<PvLine[]>([]);
    const wdlRef = useRef<WdlStats | null>(null);
    const [isSearchQueued, setIsSearchQueued] = useState(false);
    /**
     * How far the engine's 53MB weights have got. Null before the first byte
     * and after the engine is up; see `utils/engineAssetProgress`.
     */
    const [assetProgress, setAssetProgress] = useState<EngineAssetProgress | null>(null);
    const enabled = options.enabled ?? true;

    const engineRef = useRef<any>(null);
    const onBestMoveRef = useRef(options.onBestMove);
    const onWorkerErrorRef = useRef(options.onWorkerError);
    const outputLinesRef = useRef<string[]>([]);
    const pvLinesRef = useRef<PvLine[]>([]);
    const getLatestPvLines = useCallback(() => pvLinesRef.current, []);
    const pvSlotRef = useRef<Record<number, PvLine>>({});
    /**
     * The evaluation this search has most recently read, handed to
     * `onBestMove` when it finishes. Reset to 0 when a search starts, so a
     * search that never reports a score cannot carry the previous position's
     * number. The completion callback separately says whether a score arrived;
     * its numeric zero default must never be mistaken for an evaluation.
     *
     * A `useState` mirrored this and was returned from the hook, and nothing
     * ever read it: App.tsx takes its evaluation off the top PV line, which
     * carries a search tag and so cannot be mistaken for another position's.
     * The state was a re-render of the whole app on every buffered info flush
     * -- five a second while a search runs -- for a number with no reader, and
     * it was quietly wrong as well: the reset above cleared the ref but not the
     * state, so a position evaluating to exactly 0 compared equal to the reset
     * and left the previous position's evaluation standing.
     */
    const latestEvalRef = useRef(0);
    const pendingInfoLineRef = useRef<string | null>(null);
    /**
     * The evaluation buffered for the search now running, and whether it came
     * from an exact score or a bound -- see `utils/engineEvalReading`. One
     * value rather than two refs, because starting a search has to discard both
     * and used to discard only the number.
     */
    const pendingEvalRef = useRef(emptyEvalReading());
    const pendingWdlRef = useRef<WdlStats | null>(null);
    const pendingSearchStatsRef = useRef<EngineSearchStats | null>(null);
    const pvDirtyRef = useRef(false);
    const captureInfoLinesRef = useRef(options.captureInfoLines ?? false);
    const infoFlushTimerRef = useRef<number | null>(null);
    const queuedSearchTimerRef = useRef<number | null>(null);
    const engineBootTimerRef = useRef<number | null>(null);
    const engineBootAbortRef = useRef<AbortController | null>(null);
    const engineReadyTimerRef = useRef<number | null>(null);
    const didConfigureSessionRef = useRef(false);
    const initTokenRef = useRef(0);
    const isSearchingRef = useRef(false);
    const stopRequestedRef = useRef(false);
    /**
     * The last reading handed to React. A chunk is a few hundred kilobytes, so
     * the download reports a few hundred times and the readout moves in
     * megabytes; publishing every chunk would re-render the app for a number
     * nobody could see change.
     */
    const publishedAssetProgressRef = useRef<EngineAssetProgress | null>(null);
    const pendingSearchRef = useRef<SearchRequest | null>(null);
    const pendingOptionCommandsRef = useRef<Map<string, string>>(new Map());
    const activeSearchSignatureRef = useRef('');
    const activeSearchTagRef = useRef<string | null>(null);
    const handleUciOutRef = useRef<(rawMsg: string) => void>(() => {});

    useEffect(() => {
        onBestMoveRef.current = options.onBestMove;
    }, [options.onBestMove]);

    useEffect(() => {
        onWorkerErrorRef.current = options.onWorkerError;
    }, [options.onWorkerError]);

    useEffect(() => {
        captureInfoLinesRef.current = options.captureInfoLines ?? false;
    }, [options.captureInfoLines]);

    useEffect(() => {
        const handleWindowError = (event: ErrorEvent) => {
            if (!shouldSuppressEngineRuntimeError(event.filename || '', event.message || '')) {
                return;
            }
            event.preventDefault();
        };

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            if (!shouldSuppressEngineRuntimeRejection(event.reason)) return;
            event.preventDefault();
        };

        window.addEventListener('error', handleWindowError);
        window.addEventListener('unhandledrejection', handleUnhandledRejection);
        return () => {
            window.removeEventListener('error', handleWindowError);
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        };
    }, []);

    const terminateEngineInstance = useCallback((engineInstance: any) => {
        if (!engineInstance || typeof engineInstance.terminate !== 'function') return;
        try {
            const termination = engineInstance.terminate();
            if (termination && typeof termination.catch === 'function') {
                termination.catch(() => {});
            }
        } catch (_) {}
    }, []);

    const commitOutputLines = useCallback((nextLines: string[]) => {
        const trimmed = nextLines.slice(-OUTPUT_LINE_LIMIT);
        outputLinesRef.current = trimmed;
        telemetryRef.current!.setOutput(trimmed);
    }, []);

    const appendOutputLine = useCallback((line: string) => {
        if (!captureInfoLinesRef.current) return;
        commitOutputLines([...outputLinesRef.current, line]);
    }, [commitOutputLines]);

    const clearBufferedInfoState = useCallback(() => {
        if (infoFlushTimerRef.current !== null) {
            window.clearTimeout(infoFlushTimerRef.current);
            infoFlushTimerRef.current = null;
        }
        pendingInfoLineRef.current = null;
        pendingEvalRef.current = emptyEvalReading();
        pendingWdlRef.current = null;
        pendingSearchStatsRef.current = null;
        pvDirtyRef.current = false;
    }, []);

    const flushBufferedInfo = useCallback(() => {
        if (infoFlushTimerRef.current !== null) {
            window.clearTimeout(infoFlushTimerRef.current);
            infoFlushTimerRef.current = null;
        }

        if (pendingInfoLineRef.current && captureInfoLinesRef.current) {
            commitOutputLines([...outputLinesRef.current, pendingInfoLineRef.current]);
        }
        pendingInfoLineRef.current = null;

        const bufferedEval = pendingEvalRef.current.score;
        if (bufferedEval !== null) {
            latestEvalRef.current = bufferedEval;
        }

        if (pendingWdlRef.current !== null) {
            wdlRef.current = pendingWdlRef.current;
            pendingWdlRef.current = null;
        }

        if (pendingSearchStatsRef.current !== null) {
            const update = pendingSearchStatsRef.current;
            // UCI info messages can update only some counters. Keep the other
            // readings from this search across flushes; clearSearchStats resets
            // them when the next search starts.
            telemetryRef.current!.setStats(previous => ({ ...previous, ...update }));
            pendingSearchStatsRef.current = null;
        }

        if (pvDirtyRef.current) {
            pvDirtyRef.current = false;
            const sorted = Object.values(pvSlotRef.current).sort((a, b) => (a.multipv ?? 0) - (b.multipv ?? 0));
            pvLinesRef.current = sorted;
            setPvLines(previous => samePvReading(previous, sorted) ? previous : sorted);
        }
    }, [commitOutputLines]);

    const scheduleInfoFlush = useCallback(() => {
        if (infoFlushTimerRef.current !== null) return;
        infoFlushTimerRef.current = window.setTimeout(() => {
            flushBufferedInfo();
        }, INFO_FLUSH_MS);
    }, [flushBufferedInfo]);

    const clearSearchStats = useCallback(() => {
        pendingSearchStatsRef.current = null;
        telemetryRef.current!.setStats(null);
    }, []);

    const clearEngineReadyTimer = useCallback(() => {
        if (engineReadyTimerRef.current !== null) {
            window.clearTimeout(engineReadyTimerRef.current);
            engineReadyTimerRef.current = null;
        }
    }, []);

    const clearEngineBootTimer = useCallback(() => {
        if (engineBootTimerRef.current !== null) {
            window.clearTimeout(engineBootTimerRef.current);
            engineBootTimerRef.current = null;
        }
        engineBootAbortRef.current?.abort();
        engineBootAbortRef.current = null;
    }, []);

    const clearPvLines = useCallback(() => {
        pvSlotRef.current = {};
        pvLinesRef.current = [];
        pvDirtyRef.current = false;
        setPvLines([]);
        clearSearchStats();
    }, [clearSearchStats]);

    const trimPvLines = useCallback((maxLines = 1) => {
        const limit = Math.max(0, Math.trunc(maxLines));
        const sorted = Object.values(pvSlotRef.current).sort((a, b) => (a.multipv ?? 0) - (b.multipv ?? 0));
        const trimmed = sorted.slice(0, limit);
        pvSlotRef.current = Object.fromEntries(trimmed.map(pv => [pv.multipv ?? 0, pv]));
        pvLinesRef.current = trimmed;
        pvDirtyRef.current = false;
        setPvLines(trimmed);
        clearSearchStats();
    }, [clearSearchStats]);

    const clearWdl = useCallback(() => {
        pendingWdlRef.current = null;
        wdlRef.current = null;
    }, []);

    const sendCommand = useCallback((cmd: string) => {
        if (engineRef.current) {
            engineRef.current.postMessage(cmd);
            appendOutputLine(`> ${cmd}`);
        } else {
            logEngineDiagnosticWarning("Engine not ready, ignoring command:", cmd);
        }
    }, [appendOutputLine]);

    const setOption = useCallback((name: string, value?: string | number | boolean) => {
        let suffix = '';
        if (typeof value !== 'undefined') {
            const normalizedValue = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
            suffix = ` value ${normalizedValue}`;
        }
        const command = `setoption name ${name}${suffix}`;

        if (!engineRef.current || isSearchingRef.current || stopRequestedRef.current) {
            pendingOptionCommandsRef.current.set(name, command);
            return;
        }

        sendCommand(command);
    }, [sendCommand]);

    const flushPendingOptions = useCallback(() => {
        if (!engineRef.current || isSearchingRef.current || pendingOptionCommandsRef.current.size === 0) {
            return;
        }

        const commands = Array.from(pendingOptionCommandsRef.current.values());
        pendingOptionCommandsRef.current.clear();
        commands.forEach((command) => sendCommand(command));
    }, [sendCommand]);

    // Track searching state from actual UCI search commands only.
    // Keep `isSearching` true after `stop` until the engine emits `bestmove`.
    const startSearch = useCallback((cmd: string) => {
        const normalized = cmd.trim().toLowerCase();
        if (normalized.startsWith('go')) {
            setIsSearching(true);
            isSearchingRef.current = true;
            stopRequestedRef.current = false;
        }
        sendCommand(cmd);
    }, [sendCommand]);

    // Only send `stop` when actually searching — calling stop on an idle engine
    // causes a WASM function signature mismatch crash.
    const stopSearch = useCallback(() => {
        if (!isSearchingRef.current || stopRequestedRef.current) return;
        stopRequestedRef.current = true;
        sendCommand('stop');
    }, [sendCommand]);

    /**
     * The tag of the search now running, or null when nothing is. A ref
     * rather than state because the caller that needs it is an effect
     * deciding whether the running search is its own to stop; App.tsx used
     * to answer that question with "is anything searching", and stopped the
     * review's searches two milliseconds after each one started.
     */
    const getActiveSearchTag = useCallback(() => activeSearchTagRef.current, []);

    const clearQueuedSearch = useCallback(() => {
        pendingSearchRef.current = null;
        setIsSearchQueued(false);
        if (queuedSearchTimerRef.current !== null) {
            window.clearTimeout(queuedSearchTimerRef.current);
            queuedSearchTimerRef.current = null;
        }
    }, []);

    const dispatchQueuedSearch = useCallback(() => {
        if (!engineRef.current || !pendingSearchRef.current) return;
        // An old search can finish while navigation is still settling. Its
        // bestmove must not dispatch the next position before the debounce.
        if (queuedSearchTimerRef.current !== null) return;

        if (isSearchingRef.current) {
            stopSearch();
            return;
        }

        const nextRequest = pendingSearchRef.current;
        pendingSearchRef.current = null;
        setIsSearchQueued(false);
        flushPendingOptions();
        activeSearchSignatureRef.current = nextRequest.signature;
        activeSearchTagRef.current = nextRequest.tag ?? null;
        stopRequestedRef.current = false;
        pendingInfoLineRef.current = null;
        pendingEvalRef.current = emptyEvalReading();
        pendingWdlRef.current = null;
        latestEvalRef.current = 0;
        pvSlotRef.current = {};
        pvLinesRef.current = [];
        pvDirtyRef.current = false;
        setPvLines([]);
        wdlRef.current = null;
        clearSearchStats();
        startSearch(nextRequest.positionCmd);
        startSearch(nextRequest.goCmd);
    }, [clearSearchStats, flushPendingOptions, startSearch, stopSearch]);

    const queueSearch = useCallback((positionCmd: string, goCmd: string, debounceMs = 0, tag?: string) => {
        const signature = `${positionCmd}\n${goCmd}\n${tag ?? ''}`;
        if (activeSearchSignatureRef.current === signature && isSearchingRef.current && !pendingSearchRef.current) {
            return;
        }
        if (
            pendingSearchRef.current?.signature === signature &&
            (queuedSearchTimerRef.current !== null || isSearchingRef.current || activeSearchSignatureRef.current === signature)
        ) {
            return;
        }

        pendingSearchRef.current = { positionCmd, goCmd, signature, tag };
        setIsSearchQueued(true);

        if (queuedSearchTimerRef.current !== null) {
            window.clearTimeout(queuedSearchTimerRef.current);
            queuedSearchTimerRef.current = null;
        }

        if (debounceMs <= 0) {
            dispatchQueuedSearch();
            return;
        }

        queuedSearchTimerRef.current = window.setTimeout(() => {
            queuedSearchTimerRef.current = null;
            dispatchQueuedSearch();
        }, debounceMs);
    }, [dispatchQueuedSearch]);

    const initializeEngine = useCallback((initToken: number) => {
        if (typeof (window as any).Pikafish !== 'function' || typeof (window as any).Pikafish.createWorkerEngine !== 'function') {
            setIsReady(false);
            setIsSearching(false);
            isSearchingRef.current = false;
            activeSearchSignatureRef.current = '';
            clearQueuedSearch();
            onWorkerErrorRef.current?.('[boot-error] Pikafish loader finished without the engine API.');
            logEngineDiagnosticWarning('Pikafish loader finished without the engine API.');
            return;
        }

        if (engineRef.current) {
            terminateEngineInstance(engineRef.current);
            engineRef.current = null;
        }
        clearEngineBootTimer();
        clearEngineReadyTimer();
        clearQueuedSearch();
        clearBufferedInfoState();
        activeSearchSignatureRef.current = '';
        pendingOptionCommandsRef.current.clear();
        stopRequestedRef.current = false;
        isSearchingRef.current = false;

        // Wait for the constructor. We'll use "auto" variant as default.
        const pikafishFactory = (window as any).Pikafish;
        const fallbackBootConfig = options.threads === undefined || options.hashMB === undefined
            ? defaultEngineBootConfig()
            : null;
        const threads = options.threads ?? fallbackBootConfig!.threads;
        const hashMB = options.hashMB ?? fallbackBootConfig!.hashMB;
        didConfigureSessionRef.current = false;
        publishedAssetProgressRef.current = null;
        setAssetProgress(null);
        setIsReady(false);
        setIsSearching(false);
        telemetryRef.current!.setStats(null);
        setVariant('unknown');
        setEngineName(null);

        // Boot engine using the wrapper component
        const readyTimeoutMs = getEngineReadyTimeoutMs();
        engineBootTimerRef.current = window.setTimeout(() => {
            if (initToken !== initTokenRef.current || engineRef.current) return;
            engineBootTimerRef.current = null;
            initTokenRef.current += 1;
            clearEngineBootTimer();
            setIsReady(false);
            setIsSearching(false);
            isSearchingRef.current = false;
            activeSearchSignatureRef.current = '';
            activeSearchTagRef.current = null;
            clearQueuedSearch();
            telemetryRef.current!.setStats(null);
            stopRequestedRef.current = false;
            onWorkerErrorRef.current?.(`[boot-error] Pikafish did not finish booting within ${Math.ceil(readyTimeoutMs / 1000)}s.`);
        }, readyTimeoutMs);

        const handleAssetProgress = (progress: EngineAssetProgress) => {
            if (initToken !== initTokenRef.current) return;
            if (!shouldPublishAssetProgress(publishedAssetProgressRef.current, progress)) return;
            publishedAssetProgressRef.current = progress;
            setAssetProgress(progress);
        };

        let createEnginePromise: Promise<any>;
        try {
            const controller = new AbortController();
            engineBootAbortRef.current = controller;
            const engineBasePath = getEngineAssetUrl();
            createEnginePromise = Promise.resolve(pikafishFactory.createWorkerEngine({
                signal: controller.signal,
                basePath: engineBasePath,
                workerScript: getEngineAssetUrl('pikafish.js'),
                nnuePath: getEngineAssetUrl('pikafish.nnue'),
                variant: options.variant || 'auto',
                allowSIMD: options.allowSIMD ?? detectSIMDSupport(),
                threads,
                hashMB,
                initTimeoutMs: readyTimeoutMs,
                onAssetProgress: handleAssetProgress,
            }));
        } catch (err: any) {
            clearEngineBootTimer();
            clearEngineReadyTimer();
            setIsReady(false);
            setIsSearching(false);
            isSearchingRef.current = false;
            engineRef.current = null;
            activeSearchSignatureRef.current = '';
            clearQueuedSearch();
            onWorkerErrorRef.current?.(`[boot-error] ${err?.message || String(err)}`);
            logEngineDiagnosticError("Failed to boot Pikafish engine", err);
            return;
        }

        createEnginePromise
            .then((engineInstance: any) => {
                if (initToken !== initTokenRef.current) {
                    terminateEngineInstance(engineInstance);
                    return;
                }
                // A late constructor belongs to the abandoned attempt; it
                // must not clear the replacement attempt's shared watchdog.
                clearEngineBootTimer();

                engineRef.current = engineInstance;
                setVariant(String(engineInstance?.variant || options.variant || 'auto'));

                // Listen to stdout from the worker
                engineInstance.addMessageListener((msg: string) => {
                    if (initToken !== initTokenRef.current) return;
                    handleUciOutRef.current(msg);
                });

                // Send initialization commands
                engineReadyTimerRef.current = window.setTimeout(() => {
                    if (initToken !== initTokenRef.current || engineRef.current !== engineInstance) return;
                    engineReadyTimerRef.current = null;
                    terminateEngineInstance(engineInstance);
                    engineRef.current = null;
                    setIsReady(false);
                    setIsSearching(false);
                    isSearchingRef.current = false;
                    activeSearchSignatureRef.current = '';
                    activeSearchTagRef.current = null;
                    clearQueuedSearch();
                    telemetryRef.current!.setStats(null);
                    stopRequestedRef.current = false;
                    onWorkerErrorRef.current?.(`[worker-error] Pikafish did not become ready within ${Math.ceil(readyTimeoutMs / 1000)}s.`);
                }, readyTimeoutMs);
                engineInstance.postMessage('uci');
            })
            .catch((err: any) => {
                if (initToken !== initTokenRef.current) return;
                clearEngineBootTimer();
                clearEngineReadyTimer();
                setIsReady(false);
                setIsSearching(false);
                isSearchingRef.current = false;
                engineRef.current = null;
                activeSearchSignatureRef.current = '';
                clearQueuedSearch();
                onWorkerErrorRef.current?.(`[boot-error] ${err?.message || String(err)}`);
                logEngineDiagnosticError("Failed to boot Pikafish engine", err);
            });
    }, [clearBufferedInfoState, clearEngineBootTimer, clearEngineReadyTimer, clearQueuedSearch, options.variant, options.threads, options.hashMB, options.allowSIMD, terminateEngineInstance]);

    useEffect(() => {
        const resetInactiveEngineState = () => {
            clearQueuedSearch();
            clearBufferedInfoState();
            latestEvalRef.current = 0;
            pvSlotRef.current = {};
            pvLinesRef.current = [];
            outputLinesRef.current = [];
            activeSearchSignatureRef.current = '';
            activeSearchTagRef.current = null;
            pendingOptionCommandsRef.current.clear();
            stopRequestedRef.current = false;
            didConfigureSessionRef.current = false;
            setIsReady(false);
            setIsSearching(false);
            isSearchingRef.current = false;
            setVariant('disabled');
            telemetryRef.current!.setOutput([]);
            setPvLines([]);
            wdlRef.current = null;
            publishedAssetProgressRef.current = null;
            setAssetProgress(null);
            telemetryRef.current!.setStats(null);
        };

        if (!enabled) {
            initTokenRef.current += 1;
            terminateEngineInstance(engineRef.current);
            engineRef.current = null;
            clearEngineBootTimer();
            clearEngineReadyTimer();
            resetInactiveEngineState();
            return;
        }

        // Prefer the script already declared in index.html. Only inject a loader
        // when the page didn't include Pikafish yet.
        const initToken = ++initTokenRef.current;
        const engineScriptSrc = `${import.meta.env.BASE_URL}pikafish.js`;
        let script: HTMLScriptElement | null = null;
        let scriptLoadTimer: number | null = null;
        let didReportScriptFailure = false;
        clearBufferedInfoState();
        isSearchingRef.current = false;
        stopRequestedRef.current = false;
        activeSearchSignatureRef.current = '';
        activeSearchTagRef.current = null;
        setIsSearching(false);

        const clearScriptLoadWatch = () => {
            if (scriptLoadTimer !== null) {
                window.clearTimeout(scriptLoadTimer);
                scriptLoadTimer = null;
            }
            if (script) {
                script.removeEventListener('load', handleScriptLoad);
                script.removeEventListener('error', handleScriptError);
            }
        };

        const reportScriptFailure = (reason: string) => {
            if (initToken !== initTokenRef.current || didReportScriptFailure) return;
            didReportScriptFailure = true;
            clearScriptLoadWatch();
            setIsReady(false);
            setIsSearching(false);
            isSearchingRef.current = false;
            activeSearchSignatureRef.current = '';
            activeSearchTagRef.current = null;
            clearQueuedSearch();
            const message = `[boot-error] Pikafish loader failed: ${reason}.`;
            onWorkerErrorRef.current?.(message);
            logEngineDiagnosticWarning(message);
        };

        const start = () => {
            if (initToken !== initTokenRef.current) return;
            initializeEngine(initToken);
        };

        const handleScriptLoad = () => {
            clearScriptLoadWatch();
            if (typeof (window as any).Pikafish === 'function' && typeof (window as any).Pikafish.createWorkerEngine === 'function') {
                start();
                return;
            }
            reportScriptFailure('script loaded without registering the engine API');
        };

        const handleScriptError = () => {
            reportScriptFailure(`could not download ${engineScriptSrc}`);
        };

        if (typeof (window as any).Pikafish === 'function' && typeof (window as any).Pikafish.createWorkerEngine === 'function') {
            start();
        } else {
            const existingScript = Array.from(document.scripts).find((candidate) => {
                const src = candidate.getAttribute('src') || '';
                return src.includes('/pikafish.js');
            }) as HTMLScriptElement | undefined;

            script = existingScript ?? document.createElement('script');
            if (!existingScript) {
                script.id = 'pikafish-script';
                script.src = engineScriptSrc;
                script.async = true;
            }
            script.addEventListener('load', handleScriptLoad, { once: true });
            script.addEventListener('error', handleScriptError, { once: true });
            scriptLoadTimer = window.setTimeout(() => {
                reportScriptFailure(`timed out loading ${engineScriptSrc}`);
            }, ENGINE_SCRIPT_LOAD_TIMEOUT_MS);
            if (!existingScript) {
                document.body.appendChild(script);
            }
        }

        return () => {
            initTokenRef.current += 1;
            clearScriptLoadWatch();
            clearEngineBootTimer();
            clearEngineReadyTimer();
            clearQueuedSearch();
            clearBufferedInfoState();
            isSearchingRef.current = false;
            stopRequestedRef.current = false;
            activeSearchSignatureRef.current = '';
            terminateEngineInstance(engineRef.current);
            engineRef.current = null;
            activeSearchTagRef.current = null;
        };
    }, [clearBufferedInfoState, clearEngineBootTimer, clearEngineReadyTimer, clearQueuedSearch, enabled, initializeEngine, terminateEngineInstance, options.restartToken]);

    const handleUciOut = (rawMsg: string) => {
        const msg = rawMsg.trim();
        if (!msg) return;
        if (msg.startsWith('id name ')) setEngineName(msg.slice(8).trim().slice(0, 120) || null);

        if (msg === 'uciok') {
            appendOutputLine(msg);
            if (!didConfigureSessionRef.current) {
                didConfigureSessionRef.current = true;
                setOption('MultiPV', 1);
                setOption('UCI_ShowWDL', false);
                setOption('Ponder', false);
                sendCommand('ucinewgame');
            }
            sendCommand('isready');
        } else if (msg === 'readyok') {
            setReadySessionId(initTokenRef.current);
            clearEngineReadyTimer();
            appendOutputLine(msg);
            setIsReady(true);
            if (publishedAssetProgressRef.current !== null) {
                publishedAssetProgressRef.current = null;
                setAssetProgress(null);
            }
        } else if (msg.startsWith('[worker-error]')) {
            clearEngineReadyTimer();
            flushBufferedInfo();
            appendOutputLine(msg);
            // The worker aborted. Mark the engine unavailable so callers do not
            // keep reissuing the same search in a loop.
            terminateEngineInstance(engineRef.current);
            setIsReady(false);
            setIsSearching(false);
            isSearchingRef.current = false;
            engineRef.current = null;
            activeSearchSignatureRef.current = '';
            activeSearchTagRef.current = null;
            clearQueuedSearch();
            telemetryRef.current!.setStats(null);
            stopRequestedRef.current = false;
            onWorkerErrorRef.current?.(msg);
        } else if (msg.startsWith('bestmove')) {
            flushBufferedInfo();
            appendOutputLine(msg);
            setIsSearching(false);
            isSearchingRef.current = false;
            stopRequestedRef.current = false;
            const completedSearchTag = activeSearchTagRef.current;
            activeSearchTagRef.current = null;
            const uciMove = parseBestMoveUci(msg);
            onBestMoveRef.current?.(uciMove, latestEvalRef.current, completedSearchTag, pvLinesRef.current.slice(), pendingEvalRef.current.score !== null, pendingEvalRef.current.exact, pendingEvalRef.current.kind);
            if (pendingSearchRef.current) {
                dispatchQueuedSearch();
            } else {
                flushPendingOptions();
            }
        } else if (!msg.startsWith('info')) {
            appendOutputLine(msg);
        }

        // Parse PV info line
        if (msg.startsWith('info')) {
            pendingInfoLineRef.current = msg;
            const depthMatch = msg.match(/\bdepth (\d+)/);
            const scoreMatch = msg.match(/\bscore cp ([+-]?\d+)/);
            const mateMatch = msg.match(/\bscore mate ([+-]?\d+)/);
            const multipvMatch = msg.match(/\bmultipv (\d+)/);
            const wdlMatch = msg.match(/\bwdl (\d+) (\d+) (\d+)/);
            const seldepthMatch = msg.match(/\bseldepth (\d+)/);
            const nodesMatch = msg.match(/\bnodes (\d+)/);
            const npsMatch = msg.match(/\bnps (\d+)/);
            const hashfullMatch = msg.match(/\bhashfull (\d+)/);
            const timeMatch = msg.match(/\btime (\d+)/);

            const multipvIndex = multipvMatch ? parseInt(multipvMatch[1], 10) - 1 : 0;
            const nextSearchStats: EngineSearchStats = {};
            let hasSearchStats = false;
            if (depthMatch) {
                nextSearchStats.depth = parseInt(depthMatch[1], 10);
                hasSearchStats = true;
            }
            if (seldepthMatch) {
                nextSearchStats.seldepth = parseInt(seldepthMatch[1], 10);
                hasSearchStats = true;
            }
            if (nodesMatch) {
                nextSearchStats.nodes = parseInt(nodesMatch[1], 10);
                hasSearchStats = true;
            }
            if (npsMatch) {
                nextSearchStats.nps = parseInt(npsMatch[1], 10);
                hasSearchStats = true;
            }
            if (hashfullMatch) {
                nextSearchStats.hashfull = parseInt(hashfullMatch[1], 10);
                hasSearchStats = true;
            }
            if (timeMatch) {
                nextSearchStats.timeMs = parseInt(timeMatch[1], 10);
                hasSearchStats = true;
            }
            if (hasSearchStats) {
                pendingSearchStatsRef.current = {
                    ...(pendingSearchStatsRef.current ?? {}),
                    ...nextSearchStats,
                };
            }

            let finalScore = 0;
            if (scoreMatch) {
                finalScore = parseInt(scoreMatch[1], 10);
            } else if (mateMatch) {
                const mateIn = parseInt(mateMatch[1], 10);
                finalScore = mateIn > 0 ? MATE_SCORE_BASE - mateIn : -MATE_SCORE_BASE - mateIn;
            }

            // Only update eval and WDL from the primary PV line (multipv 1)
            if (multipvIndex === 0) {
                if (scoreMatch || mateMatch) {
                    // A bound is taken only while nothing exact has arrived for
                    // this search -- better than no reading at all -- and never
                    // in place of one that has.
                    pendingEvalRef.current = takeEvalReading(
                        pendingEvalRef.current,
                        finalScore,
                        BOUNDED_SCORE_PATTERN.test(msg),
                        scoreMatch ? 'cp' : 'mate'
                    );
                }
                if (wdlMatch) {
                    pendingWdlRef.current = {
                        win: parseInt(wdlMatch[1], 10),
                        draw: parseInt(wdlMatch[2], 10),
                        loss: parseInt(wdlMatch[3], 10),
                    };
                }
            }

            const pvMatch = msg.match(/\bpv (.*)/);
            if (depthMatch && pvMatch && (scoreMatch || mateMatch)) {
                const moves = parsePvUciMoves(pvMatch[1]);
                if (moves.length === 0) {
                    scheduleInfoFlush();
                    return;
                }

                let scoreStr = '';
                if (scoreMatch) {
                    scoreStr = finalScore > 0 ? `+${finalScore}` : `${finalScore}`;
                } else if (mateMatch) {
                    const mateIn = parseInt(mateMatch![1], 10);
                    scoreStr = mateIn > 0 ? `+M${mateIn}` : `-M${Math.abs(mateIn)}`;
                }

                const newPv: PvLine = {
                    depth: depthMatch[1],
                    score: finalScore,
                    scoreStr,
                    moves,
                    multipv: multipvIndex,
                    searchTag: activeSearchTagRef.current,
                    bounded: BOUNDED_SCORE_PATTERN.test(msg),
                    bound: parseScoreBound(msg),
                    ...(nodesMatch || timeMatch || seldepthMatch ? { effort: {
                        ...(nodesMatch ? { nodes: parseInt(nodesMatch[1], 10) } : {}),
                        ...(timeMatch ? { timeMs: parseInt(timeMatch[1], 10) } : {}),
                        ...(seldepthMatch ? { seldepth: parseInt(seldepthMatch[1], 10) } : {}),
                    } } : {}),
                    // Every multipv line carries its own wdl; only the first
                    // feeds the bar, but a reader comparing candidates wants
                    // each line's chances beside its score.
                    ...(wdlMatch ? { wdl: {
                        win: parseInt(wdlMatch[1], 10),
                        draw: parseInt(wdlMatch[2], 10),
                        loss: parseInt(wdlMatch[3], 10),
                    } } : {}),
                };

                // Direct slot assignment — no array manipulation in hot path.
                // A bound may not displace the exact score for the same depth;
                // see shouldReplacePvLine.
                const heldPv = pvSlotRef.current[multipvIndex];
                const heldThisSearch = heldPv?.searchTag === activeSearchTagRef.current;
                if (!heldThisSearch || shouldReplacePvLine(heldPv, newPv)) {
                    pvSlotRef.current[multipvIndex] = newPv;
                    pvDirtyRef.current = true;
                }
            }

            scheduleInfoFlush();
        }
    };

    handleUciOutRef.current = handleUciOut;

    useEffect(() => {
        return () => {
            clearBufferedInfoState();
            clearEngineBootTimer();
            if (queuedSearchTimerRef.current !== null) {
                window.clearTimeout(queuedSearchTimerRef.current);
                queuedSearchTimerRef.current = null;
            }
            clearEngineReadyTimer();
        };
    }, [clearBufferedInfoState, clearEngineBootTimer, clearEngineReadyTimer]);

    return {
        isReady,
        readySessionId,
        engineName,
        isSearching,
        isSearchQueued,
        variant,
        startSearch,
        stopSearch,
        getActiveSearchTag,
        queueSearch,
        clearQueuedSearch,
        clearPvLines,
        trimPvLines,
        clearWdl,
        setOption,
        sendCommand,
        telemetry: telemetryRef.current,
        pvLines,
        getLatestPvLines,
        wdl: wdlRef.current,
        assetProgress,
    };
}
