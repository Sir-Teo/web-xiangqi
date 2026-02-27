import { useState, useEffect, useCallback, useRef } from 'react';

// Advanced wrapper hook for Pikafish engine communication in Web Worker
export interface EngineInitOptions {
    variant?: 'auto' | 'threaded' | 'single';
    onBestMove?: (uci: string, score: number) => void;
}

export function useEngine(options: EngineInitOptions = {}) {
    const [isReady, setIsReady] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [outputLines, setOutputLines] = useState<string[]>([]);
    const [pvLines, setPvLines] = useState<any[]>([]);
    const [evalScore, setEvalScore] = useState<number>(0);

    const engineRef = useRef<any>(null);
    const onBestMoveRef = useRef(options.onBestMove);

    useEffect(() => {
        onBestMoveRef.current = options.onBestMove;
    }, [options.onBestMove]);

    // Track when we are actually searching
    const startSearch = useCallback((cmd: string) => {
        setIsSearching(true);
        sendCommand(cmd);
    }, []);

    const stopSearch = useCallback(() => {
        sendCommand('stop');
        setIsSearching(false);
    }, []);

    useEffect(() => {
        // We expect `window.Pikafish` to be available after loading `pikafish.js`.
        // In Vite, we can inject a script tag dynamically or add it to index.html.

        // Check if script is already present
        if (!document.querySelector('#pikafish-script')) {
            const script = document.createElement('script');
            script.id = 'pikafish-script';
            script.src = '/pikafish.js';
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

        // Boot engine using the wrapper component
        pikafishFactory.createWorkerEngine({ variant: options.variant || 'auto' })
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

    const sendCommand = useCallback((cmd: string) => {
        if (engineRef.current) {
            engineRef.current.postMessage(cmd);
            setOutputLines((prev) => [...prev, `> ${cmd}`]);
        } else {
            console.warn("Engine not ready, ignoring command:", cmd);
        }
    }, []);

    const handleUciOut = (rawMsg: string) => {
        const msg = rawMsg.trim();
        if (!msg) return;

        setOutputLines((prev) => [...prev.slice(-100), msg]); // Keep last 100 lines

        if (msg === 'uciok') {
            sendCommand('isready');
        } else if (msg === 'readyok') {
            setIsReady(true);
        } else if (msg.startsWith('bestmove')) {
            setIsSearching(false);
            const moveMatch = msg.match(/bestmove\s+([a-i]\d[a-i]\d[a-z]?)/i);
            if (moveMatch && moveMatch[1]) {
                const uciMove = moveMatch[1];
                setEvalScore((currentScore) => {
                    if (onBestMoveRef.current) {
                        onBestMoveRef.current(uciMove, currentScore);
                    }
                    return currentScore;
                });
            }
        }

        // Parse PV info line
        if (msg.startsWith('info')) {
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
                setEvalScore(finalScore);
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

                // In a real app we'd map multipv index or just replace the root line.
                // Here we'll just push it and keep the top N
                setPvLines(prev => {
                    const current = [newPv, ...prev].slice(0, 3);
                    return current;
                });
            }
        }
    };

    return { isReady, isSearching, startSearch, stopSearch, sendCommand, outputLines, pvLines, evalScore };
}
