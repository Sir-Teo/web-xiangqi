import { useState, useEffect, useCallback, useRef } from 'react';
import type { EngineRuntimeVariant } from '../utils/analysisProfile';

// Advanced wrapper hook for Pikafish engine communication in Web Worker
const OUTPUT_LINE_LIMIT = 100;
const INFO_FLUSH_MS = 200;

type PvLine = {
    depth: string;
    score: number;
    scoreStr: string;
    moves: string[];
    multipv?: number;
    searchTag: string | null;
};

export type WdlStats = { win: number; draw: number; loss: number };

type SearchRequest = {
    positionCmd: string;
    goCmd: string;
    signature: string;
    tag?: string;
};

export interface EngineInitOptions {
    enabled?: boolean;
    variant?: EngineRuntimeVariant;
    allowSIMD?: boolean;
    threads?: number;
    hashMB?: number;
    onBestMove?: (uci: string, score: number, searchTag: string | null) => void;
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
    const memGB = (navigator as any).deviceMemory || 0;
    if (isCompact) return memGB >= 4 ? 32 : 16;
    if (memGB >= 8) return 128;
    if (memGB >= 4) return 64;
    return 32;
}

function shouldSuppressEngineRuntimeError(filename: string, message: string) {
    const normalizedFilename = String(filename || '');
    const normalizedMessage = String(message || '');
    const fromPikafishRuntime =
        normalizedFilename.includes('/pikafish-core.js') ||
        normalizedFilename.includes('/pikafish.js') ||
        normalizedFilename.includes('/pikafish-core.wasm');
    return fromPikafishRuntime && normalizedMessage.includes('memory access out of bounds');
}

export function useEngine(options: EngineInitOptions = {}) {
    const [isReady, setIsReady] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [variant, setVariant] = useState<string>('unknown');
    const [outputLines, setOutputLines] = useState<string[]>([]);
    const [pvLines, setPvLines] = useState<PvLine[]>([]);
    const [evalScore, setEvalScore] = useState<number>(0);
    const [wdl, setWdl] = useState<WdlStats | null>(null);
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
    const pvDirtyRef = useRef(false);
    const infoFlushTimerRef = useRef<number | null>(null);
    const queuedSearchTimerRef = useRef<number | null>(null);
    const didConfigureSessionRef = useRef(false);
    const initTokenRef = useRef(0);
    const stopRequestedRef = useRef(false);
    const pendingSearchRef = useRef<SearchRequest | null>(null);
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
        const handleWindowError = (event: ErrorEvent) => {
            if (!shouldSuppressEngineRuntimeError(event.filename || '', event.message || '')) {
                return;
            }
            event.preventDefault();
        };

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const message = String(reason?.message || reason?.stack || reason || '');
            if (!message.includes('memory access out of bounds')) {
                return;
            }
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
        commitOutputLines([...outputLinesRef.current, line]);
    }, [commitOutputLines]);

    const flushBufferedInfo = useCallback(() => {
        if (infoFlushTimerRef.current !== null) {
            window.clearTimeout(infoFlushTimerRef.current);
            infoFlushTimerRef.current = null;
        }

        if (pendingInfoLineRef.current) {
            commitOutputLines([...outputLinesRef.current, pendingInfoLineRef.current]);
            pendingInfoLineRef.current = null;
        }

        if (pendingEvalRef.current !== null && pendingEvalRef.current !== latestEvalRef.current) {
            latestEvalRef.current = pendingEvalRef.current;
            setEvalScore(pendingEvalRef.current);
        }
        pendingEvalRef.current = null;

        if (pendingWdlRef.current !== null) {
            setWdl(pendingWdlRef.current);
            pendingWdlRef.current = null;
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

    // Ref mirrors isSearching so stopSearch doesn't need it in its deps
    const isSearchingRef = useRef(false);

    const clearPvLines = useCallback(() => {
        pvSlotRef.current = {};
        pvLinesRef.current = [];
        pvDirtyRef.current = false;
        setPvLines([]);
    }, []);

    const trimPvLines = useCallback((maxLines = 1) => {
        const limit = Math.max(0, Math.trunc(maxLines));
        const sorted = Object.values(pvSlotRef.current).sort((a, b) => (a.multipv ?? 0) - (b.multipv ?? 0));
        const trimmed = sorted.slice(0, limit);
        pvSlotRef.current = Object.fromEntries(trimmed.map(pv => [pv.multipv ?? 0, pv]));
        pvLinesRef.current = trimmed;
        pvDirtyRef.current = false;
        setPvLines(trimmed);
    }, []);

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
        sendCommand(`setoption name ${name}${suffix}`);
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
        startSearch(nextRequest.positionCmd);
        startSearch(nextRequest.goCmd);
    }, [startSearch, stopSearch]);

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
            console.error("Pikafish is not loaded.");
            return;
        }

        if (engineRef.current) {
            terminateEngineInstance(engineRef.current);
            engineRef.current = null;
        }
        clearQueuedSearch();
        activeSearchSignatureRef.current = '';
        stopRequestedRef.current = false;

        // Wait for the constructor. We'll use "auto" variant as default.
        const pikafishFactory = (window as any).Pikafish;
        const threads = options.threads ?? detectUiSafeThreads();
        const hashMB = options.hashMB ?? detectUiSafeHashMB();
        didConfigureSessionRef.current = false;
        setIsReady(false);
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
    }, [clearQueuedSearch, options.variant, options.threads, options.hashMB, options.allowSIMD, terminateEngineInstance]);

    useEffect(() => {
        const resetInactiveEngineState = () => {
            clearQueuedSearch();
            if (infoFlushTimerRef.current !== null) {
                window.clearTimeout(infoFlushTimerRef.current);
                infoFlushTimerRef.current = null;
            }
            pendingInfoLineRef.current = null;
            pendingEvalRef.current = null;
            pendingWdlRef.current = null;
            latestEvalRef.current = 0;
            pvSlotRef.current = {};
            pvLinesRef.current = [];
            pvDirtyRef.current = false;
            outputLinesRef.current = [];
            activeSearchSignatureRef.current = '';
            activeSearchTagRef.current = null;
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

        const start = () => {
            if (initToken !== initTokenRef.current) return;
            initializeEngine(initToken);
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
                document.body.appendChild(script);
            }
            script.addEventListener('load', start, { once: true });
        }

        return () => {
            initTokenRef.current += 1;
            if (script) {
                script.removeEventListener('load', start);
            }
            clearQueuedSearch();
            terminateEngineInstance(engineRef.current);
            engineRef.current = null;
            activeSearchTagRef.current = null;
        };
    }, [clearQueuedSearch, enabled, initializeEngine, terminateEngineInstance, options.restartToken]);

    const handleUciOut = (rawMsg: string) => {
        const msg = rawMsg.trim();
        if (!msg) return;

        if (msg === 'uciok') {
            appendOutputLine(msg);
            if (!didConfigureSessionRef.current) {
                didConfigureSessionRef.current = true;
                setOption('UCI_Variant', 'xiangqi');
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
            setIsReady(false);
            setIsSearching(false);
            isSearchingRef.current = false;
            engineRef.current = null;
            activeSearchSignatureRef.current = '';
            activeSearchTagRef.current = null;
            clearQueuedSearch();
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
            const moveMatch = msg.match(/bestmove\s+([a-i]\d[a-i]\d[a-z]?)/i);
            const uciMove = moveMatch?.[1] ?? '';
            onBestMoveRef.current?.(uciMove, latestEvalRef.current, completedSearchTag);
            if (pendingSearchRef.current) {
                dispatchQueuedSearch();
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

            const multipvIndex = multipvMatch ? parseInt(multipvMatch[1], 10) - 1 : 0;

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
                    moves: pvMatch[1].trim().split(' '),
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
            if (infoFlushTimerRef.current !== null) {
                window.clearTimeout(infoFlushTimerRef.current);
            }
            if (queuedSearchTimerRef.current !== null) {
                window.clearTimeout(queuedSearchTimerRef.current);
            }
        };
    }, []);

    return {
        isReady,
        isSearching,
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
    };
}
