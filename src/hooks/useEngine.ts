import { useState, useEffect, useCallback, useRef } from 'react';
import type { EngineRuntimeVariant } from '../utils/analysisProfile';

// Advanced wrapper hook for Pikafish engine communication in Web Worker
const OUTPUT_LINE_LIMIT = 100;
const INFO_FLUSH_MS = 200;
const ENGINE_SCRIPT_LOAD_TIMEOUT_MS = 12000;

export type PvLine = {
    depth: string;
    score: number;
    scoreStr: string;
    moves: string[];
    multipv?: number;
    searchTag: string | null;
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

type SearchRequest = {
    positionCmd: string;
    goCmd: string;
    signature: string;
    tag?: string;
};

type NavigatorWithDeviceMemory = Navigator & { deviceMemory?: number };

export interface EngineInitOptions {
    enabled?: boolean;
    variant?: EngineRuntimeVariant;
    allowSIMD?: boolean;
    threads?: number;
    hashMB?: number;
    captureInfoLines?: boolean;
    onBestMove?: (uci: string, score: number, searchTag: string | null, pvLines: PvLine[]) => void;
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

function detectUiSafeThreads() {
    if (typeof navigator === 'undefined') return 1;
    const hw = Number(navigator.hardwareConcurrency) || 2;
    const isCompact = typeof window !== 'undefined' && window.innerWidth <= 900;
    if (isCompact) return 1;
    return Math.max(1, Math.min(4, hw - 2));
}

function detectUiSafeHashMB() {
    const isCompact = typeof window !== 'undefined' && window.innerWidth <= 900;
    const memGB = Number((navigator as NavigatorWithDeviceMemory).deviceMemory ?? 0);
    if (isCompact) return memGB >= 4 ? 32 : 16;
    if (memGB >= 8) return 128;
    if (memGB >= 4) return 64;
    return 32;
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
    const [isSearching, setIsSearching] = useState(false);
    const [variant, setVariant] = useState<string>('unknown');
    const [outputLines, setOutputLines] = useState<string[]>([]);
    const [pvLines, setPvLines] = useState<PvLine[]>([]);
    const [evalScore, setEvalScore] = useState<number>(0);
    const [wdl, setWdl] = useState<WdlStats | null>(null);
    const [searchStats, setSearchStats] = useState<EngineSearchStats | null>(null);
    const [isSearchQueued, setIsSearchQueued] = useState(false);
    const enabled = options.enabled ?? true;

    const engineRef = useRef<any>(null);
    const onBestMoveRef = useRef(options.onBestMove);
    const onWorkerErrorRef = useRef(options.onWorkerError);
    const outputLinesRef = useRef<string[]>([]);
    const pvLinesRef = useRef<PvLine[]>([]);
    const pvSlotRef = useRef<Record<number, PvLine>>({});
    const latestEvalRef = useRef(0);
    const pendingInfoLineRef = useRef<string | null>(null);
    const pendingEvalRef = useRef<number | null>(null);
    const pendingWdlRef = useRef<WdlStats | null>(null);
    const pendingSearchStatsRef = useRef<EngineSearchStats | null>(null);
    const pvDirtyRef = useRef(false);
    const captureInfoLinesRef = useRef(options.captureInfoLines ?? false);
    const infoFlushTimerRef = useRef<number | null>(null);
    const queuedSearchTimerRef = useRef<number | null>(null);
    const didConfigureSessionRef = useRef(false);
    const initTokenRef = useRef(0);
    const isSearchingRef = useRef(false);
    const stopRequestedRef = useRef(false);
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
        setOutputLines(trimmed);
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
        pendingEvalRef.current = null;
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

        if (pendingEvalRef.current !== null && pendingEvalRef.current !== latestEvalRef.current) {
            latestEvalRef.current = pendingEvalRef.current;
            setEvalScore(pendingEvalRef.current);
        }
        pendingEvalRef.current = null;

        if (pendingWdlRef.current !== null) {
            setWdl(pendingWdlRef.current);
            pendingWdlRef.current = null;
        }

        if (pendingSearchStatsRef.current !== null) {
            setSearchStats(pendingSearchStatsRef.current);
            pendingSearchStatsRef.current = null;
        }

        if (pvDirtyRef.current) {
            pvDirtyRef.current = false;
            const sorted = Object.values(pvSlotRef.current).sort((a, b) => (a.multipv ?? 0) - (b.multipv ?? 0));
            pvLinesRef.current = sorted;
            setPvLines(sorted);
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
        setSearchStats(null);
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
        setWdl(null);
    }, []);

    const sendCommand = useCallback((cmd: string) => {
        if (engineRef.current) {
            engineRef.current.postMessage(cmd);
            appendOutputLine(`> ${cmd}`);
        } else {
            console.warn("Engine not ready, ignoring command:", cmd);
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
        pendingEvalRef.current = null;
        pendingWdlRef.current = null;
        latestEvalRef.current = 0;
        pvSlotRef.current = {};
        pvLinesRef.current = [];
        pvDirtyRef.current = false;
        setPvLines([]);
        setWdl(null);
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
            console.warn('Pikafish loader finished without the engine API.');
            return;
        }

        if (engineRef.current) {
            terminateEngineInstance(engineRef.current);
            engineRef.current = null;
        }
        clearQueuedSearch();
        clearBufferedInfoState();
        activeSearchSignatureRef.current = '';
        pendingOptionCommandsRef.current.clear();
        stopRequestedRef.current = false;
        isSearchingRef.current = false;

        // Wait for the constructor. We'll use "auto" variant as default.
        const pikafishFactory = (window as any).Pikafish;
        const threads = options.threads ?? detectUiSafeThreads();
        const hashMB = options.hashMB ?? detectUiSafeHashMB();
        didConfigureSessionRef.current = false;
        setIsReady(false);
        setIsSearching(false);
        setSearchStats(null);
        setVariant('unknown');

        // Boot engine using the wrapper component
        pikafishFactory.createWorkerEngine({
            variant: options.variant || 'auto',
            allowSIMD: options.allowSIMD ?? detectSIMDSupport(),
            threads,
            hashMB,
        })
            .then((engineInstance: any) => {
                if (initToken !== initTokenRef.current) {
                    terminateEngineInstance(engineInstance);
                    return;
                }

                engineRef.current = engineInstance;
                setVariant(String(engineInstance?.variant || options.variant || 'auto'));

                // Listen to stdout from the worker
                engineInstance.addMessageListener((msg: string) => {
                    if (initToken !== initTokenRef.current) return;
                    handleUciOutRef.current(msg);
                });

                // Send initialization commands
                engineInstance.postMessage('uci');
            })
            .catch((err: any) => {
                if (initToken !== initTokenRef.current) return;
                setIsReady(false);
                setIsSearching(false);
                isSearchingRef.current = false;
                engineRef.current = null;
                activeSearchSignatureRef.current = '';
                clearQueuedSearch();
                onWorkerErrorRef.current?.(`[boot-error] ${err?.message || String(err)}`);
                console.error("Failed to boot Pikafish engine", err);
            });
    }, [clearBufferedInfoState, clearQueuedSearch, options.variant, options.threads, options.hashMB, options.allowSIMD, terminateEngineInstance]);

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
            setOutputLines([]);
            setPvLines([]);
            setEvalScore(0);
            setWdl(null);
            setSearchStats(null);
        };

        if (!enabled) {
            initTokenRef.current += 1;
            terminateEngineInstance(engineRef.current);
            engineRef.current = null;
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
            console.warn(message);
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
            clearQueuedSearch();
            clearBufferedInfoState();
            isSearchingRef.current = false;
            stopRequestedRef.current = false;
            activeSearchSignatureRef.current = '';
            terminateEngineInstance(engineRef.current);
            engineRef.current = null;
            activeSearchTagRef.current = null;
        };
    }, [clearBufferedInfoState, clearQueuedSearch, enabled, initializeEngine, terminateEngineInstance, options.restartToken]);

    const handleUciOut = (rawMsg: string) => {
        const msg = rawMsg.trim();
        if (!msg) return;

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
            appendOutputLine(msg);
            setIsReady(true);
        } else if (msg.startsWith('[worker-error]')) {
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
            setSearchStats(null);
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
            onBestMoveRef.current?.(uciMove, latestEvalRef.current, completedSearchTag, pvLinesRef.current.slice());
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
                finalScore = mateIn > 0 ? 10000 - mateIn : -10000 - mateIn;
            }

            // Only update eval and WDL from the primary PV line (multipv 1)
            if (multipvIndex === 0) {
                if (scoreMatch || mateMatch) {
                    pendingEvalRef.current = finalScore;
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
                };

                // Direct slot assignment — no array manipulation in hot path
                pvSlotRef.current[multipvIndex] = newPv;
                pvDirtyRef.current = true;
            }

            scheduleInfoFlush();
        }
    };

    handleUciOutRef.current = handleUciOut;

    useEffect(() => {
        return () => {
            clearBufferedInfoState();
            if (queuedSearchTimerRef.current !== null) {
                window.clearTimeout(queuedSearchTimerRef.current);
                queuedSearchTimerRef.current = null;
            }
        };
    }, [clearBufferedInfoState]);

    return {
        isReady,
        isSearching,
        isSearchQueued,
        variant,
        startSearch,
        stopSearch,
        queueSearch,
        clearQueuedSearch,
        clearPvLines,
        trimPvLines,
        clearWdl,
        setOption,
        sendCommand,
        outputLines,
        pvLines,
        evalScore,
        wdl,
        searchStats,
    };
}
