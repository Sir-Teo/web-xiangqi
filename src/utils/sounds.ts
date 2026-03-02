// Web Audio API sound effects — no external dependencies

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
        try {
            ctx = new AudioContext();
        } catch {
            return null;
        }
    }
    // Resume if suspended (browsers require user gesture)
    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
    return ctx;
}

function playTone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    decay?: number
) {
    const ac = getCtx();
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
    const ac = getCtx();
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
