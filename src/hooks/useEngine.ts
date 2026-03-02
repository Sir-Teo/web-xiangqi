import { useState, useEffect, useCallback, useRef } from 'react';

// Advanced wrapper hook for Pikafish engine communication in Web Worker
const OUTPUT_LINE_LIMIT = 100;
const INFO_FLUSH_MS = 200;

type PvLine = {
    depth: string;
    score: number;
    scoreStr: string;
    moves: string[];
};

export interface EngineInitOptions {
    variant?: 'auto' | 'threaded' | 'single';
    allowSIMD?: boolean;
    threads?: number;
    hashMB?: number;
    onBestMove?: (uci: string, score: number) => void;
}

function detectUiSafeThreads() {
    if (typeof navigator === 'undefined') return 1;
    const hardwareThreads = Number(navigator.hardwareConcurrency) || 2;
    const compactLayout = typeof window !== 'undefined' ? window.innerWidth <= 900 : false;
    if (compactLayout) return 1;
    return Math.max(1, Math.min(2, Math.floor(hardwareThreads / 4) || 1));
}

function detectUiSafeHashMB() {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
        return 32;
    }
    return 64;
}

export function useEngine(options: EngineInitOptions = {}) {
    const [isReady, setIsReady] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [outputLines, setOutputLines] = useState<string[]>([]);
    const [pvLines, setPvLines] = useState<PvLine[]>([]);
    const [evalScore, setEvalScore] = useState<number>(0);

    const engineRef = useRef<any>(null);
    const onBestMoveRef = useRef(options.onBestMove);
    const outputLinesRef = useRef<string[]>([]);
    const pvLinesRef = useRef<PvLine[]>([]);
    const latestEvalRef = useRef(0);
    const pendingInfoLineRef = useRef<string | null>(null);
    const pendingEvalRef = useRef<number | null>(null);
    const pvDirtyRef = useRef(false);
    const infoFlushTimerRef = useRef<number | null>(null);
    const didConfigureSessionRef = useRef(false);

    useEffect(() => {
        onBestMoveRef.current = options.onBestMove;
    }, [options.onBestMove]);

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

        if (pvDirtyRef.current) {
            pvDirtyRef.current = false;
            setPvLines([...pvLinesRef.current]);
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

    const sendCommand = useCallback((cmd: string) => {
        if (engineRef.current) {
            engineRef.current.postMessage(cmd);
            appendOutputLine(`> ${cmd}`);
        } else {
            console.warn("Engine not ready, ignoring command:", cmd);
        }
    }, [appendOutputLine]);

    // Track searching state from actual UCI search commands only.
    // Keep `isSearching` true after `stop` until the engine emits `bestmove`.
    const startSearch = useCallback((cmd: string) => {
        const normalized = cmd.trim().toLowerCase();
        if (normalized.startsWith('go')) {
            setIsSearching(true);
            isSearchingRef.current = true;
        }
        sendCommand(cmd);
    }, [sendCommand]);

    // Only send `stop` when actually searching — calling stop on an idle engine
    // causes a WASM function signature mismatch crash.
    const stopSearch = useCallback(() => {
        if (!isSearchingRef.current) return;
        sendCommand('stop');
    }, [sendCommand]);

    useEffect(() => {
        // We expect `window.Pikafish` to be available after loading `pikafish.js`.
        // In Vite, we can inject a script tag dynamically or add it to index.html.
        const engineScriptSrc = '/pikafish.js?v=nosimd-worker-propagation-fix';
        const existingScript = document.querySelector('#pikafish-script') as HTMLScriptElement | null;

        if (existingScript && existingScript.getAttribute('src') !== engineScriptSrc) {
            existingScript.remove();
        }

        const activeScript = document.querySelector('#pikafish-script') as HTMLScriptElement | null;
        if (!activeScript) {
            const script = document.createElement('script');
            script.id = 'pikafish-script';
            script.src = engineScriptSrc;
            script.async = true;
            script.onload = () => {
                initializeEngine();
            };
            document.body.appendChild(script);
        } else {
            initializeEngine();
        }

        return () => {
            // Cleanup
            if (engineRef.current && typeof engineRef.current.terminate === 'function') {
                engineRef.current.terminate();
            }
        };
    }, []);

    const initializeEngine = () => {
        if (typeof (window as any).Pikafish !== 'function' || typeof (window as any).Pikafish.createWorkerEngine !== 'function') {
            console.error("Pikafish is not loaded.");
            return;
        }

        // Wait for the constructor. We'll use "auto" variant as default.
        const pikafishFactory = (window as any).Pikafish;
        const threads = options.threads ?? detectUiSafeThreads();
        const hashMB = options.hashMB ?? detectUiSafeHashMB();
        didConfigureSessionRef.current = false;
        setIsReady(false);

        // Boot engine using the wrapper component
        pikafishFactory.createWorkerEngine({
            variant: options.variant || 'auto',
            // Prefer stability over speed: some environments crash in single-simd.
            allowSIMD: options.allowSIMD ?? false,
            threads,
            hashMB,
        })
            .then((engineInstance: any) => {
                engineRef.current = engineInstance;

                // Listen to stdout from the worker
                engineInstance.addMessageListener((msg: string) => {
                    handleUciOut(msg);
                });

                // Send initialization commands
                engineInstance.postMessage('uci');
            })
            .catch((err: any) => {
                console.error("Failed to boot Pikafish engine", err);
            });
    };

    const handleUciOut = (rawMsg: string) => {
        const msg = rawMsg.trim();
        if (!msg) return;

        if (msg === 'uciok') {
            appendOutputLine(msg);
            if (!didConfigureSessionRef.current) {
                didConfigureSessionRef.current = true;
                sendCommand('setoption name UCI_Variant value xiangqi');
                sendCommand('setoption name MultiPV value 1');
                sendCommand('setoption name UCI_ShowWDL value false');
                sendCommand('setoption name Ponder value false');
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
        } else if (msg.startsWith('bestmove')) {
            flushBufferedInfo();
            appendOutputLine(msg);
            setIsSearching(false);
            isSearchingRef.current = false;
            const moveMatch = msg.match(/bestmove\s+([a-i]\d[a-i]\d[a-z]?)/i);
            if (moveMatch && moveMatch[1]) {
                const uciMove = moveMatch[1];
                onBestMoveRef.current?.(uciMove, latestEvalRef.current);
            }
        } else if (!msg.startsWith('info')) {
            appendOutputLine(msg);
        }

        // Parse PV info line
        if (msg.startsWith('info')) {
            pendingInfoLineRef.current = msg;
            const depthMatch = msg.match(/\bdepth (\d+)/);
            const scoreMatch = msg.match(/\bscore cp ([+-]?\d+)/);

            // Matte score: score mate -1
            const mateMatch = msg.match(/\bscore mate ([+-]?\d+)/);

            let finalScore = 0;
            if (scoreMatch) {
                finalScore = parseInt(scoreMatch[1], 10);
            } else if (mateMatch) {
                const mateIn = parseInt(mateMatch[1], 10);
                finalScore = mateIn > 0 ? 10000 - mateIn : -10000 - mateIn;
            }

            if (scoreMatch || mateMatch) {
                pendingEvalRef.current = finalScore;
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

                const newPv = {
                    depth: depthMatch[1],
                    score: finalScore,
                    scoreStr,
                    moves: pvMatch[1].trim().split(' ')
                };

                pvLinesRef.current = [
                    newPv,
                    ...pvLinesRef.current.filter((pv) => pv.depth !== newPv.depth),
                ].slice(0, 3);
                pvDirtyRef.current = true;
            }

            scheduleInfoFlush();
        }
    };

    useEffect(() => {
        return () => {
            if (infoFlushTimerRef.current !== null) {
                window.clearTimeout(infoFlushTimerRef.current);
            }
        };
    }, []);

    return { isReady, isSearching, startSearch, stopSearch, sendCommand, outputLines, pvLines, evalScore };
}
