// Web Audio API sound effects — no external dependencies

let ctx: AudioContext | null = null;

function createCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
        try {
            ctx = new AudioContext();
        } catch {
            return null;
        }
    }
    return ctx;
}

/**
 * Build the AudioContext before the reader touches anything.
 *
 * `new AudioContext()` starts the audio device, and that is a fixed cost --
 * ~125ms of blocked main thread here, essentially unchanged under 4x CPU
 * throttling, because it is device startup rather than script. Spent inside the
 * `pointerdown` listener that unlocks sound it lands on the reader's very first
 * tap: measured, the frame answering that tap ran 131ms unthrottled and 186ms
 * at 4x, against 0ms for every tap after it. Spent at idle it costs them
 * nothing, and the gesture is left with `resume()`, which is under a
 * millisecond.
 *
 * Returns a cancel function; the context is only wanted while sound is on.
 */
export function prepareSoundEffects(): () => void {
    if (typeof window === 'undefined' || ctx) return () => {};
    if (typeof window.requestIdleCallback === 'function') {
        const handle = window.requestIdleCallback(() => { createCtx(); });
        return () => window.cancelIdleCallback?.(handle);
    }
    // Safari before 16.4 has no requestIdleCallback. A timer once the load has
    // settled is not idle, but it is still off the interaction path.
    const timer = window.setTimeout(() => { createCtx(); }, 1000);
    return () => window.clearTimeout(timer);
}

export function unlockSoundEffects() {
    // Still creates the context if the idle prime above has not run yet, so
    // this is never worse than doing the work here -- only usually free.
    const ac = createCtx();
    if (!ac) return;
    if (ac.state === 'suspended') {
        ac.resume().catch(() => {});
    }
}

function getUnlockedCtx(): AudioContext | null {
    if (!ctx || ctx.state !== 'running') return null;
    return ctx;
}

function playTone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    decay?: number
) {
    const ac = getUnlockedCtx();
    if (!ac) return;

    const osc = ac.createOscillator();
    const gainNode = ac.createGain();

    osc.connect(gainNode);
    gainNode.connect(ac.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ac.currentTime);

    gainNode.gain.setValueAtTime(gain, ac.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + (decay ?? duration));

    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + duration);
}

function playNoise(duration: number, gainValue: number, filterFreq: number) {
    const ac = getUnlockedCtx();
    if (!ac) return;

    const bufferSize = ac.sampleRate * duration;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    const source = ac.createBufferSource();
    source.buffer = buffer;

    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;

    const gainNode = ac.createGain();
    gainNode.gain.setValueAtTime(gainValue, ac.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ac.destination);

    source.start(ac.currentTime);
    source.stop(ac.currentTime + duration);
}

/** Light wooden click when a piece is placed on an empty square */
export function playMoveSound() {
    // Two-tone "clack": high click + brief body
    playTone(900, 0.04, 'square', 0.18, 0.04);
    playTone(400, 0.08, 'triangle', 0.12, 0.08);
}

/** Thud when a piece is captured */
export function playCaptureSound() {
    playNoise(0.12, 0.22, 1800);
    playTone(220, 0.1, 'triangle', 0.15, 0.1);
}

/** High-pitched ping on check */
export function playCheckSound() {
    playTone(1200, 0.06, 'sine', 0.2, 0.06);
    playTone(1600, 0.08, 'sine', 0.15, 0.08);
}
