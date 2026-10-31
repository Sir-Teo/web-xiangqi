import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * `sounds.ts` holds its AudioContext in module state and reads two globals
 * this project's tests do not otherwise have, so each case gets fresh globals
 * and a fresh module.
 */
class FakeAudioContext {
    static built = 0;
    state: 'running' | 'suspended' | 'closed' = 'running';
    suspends = 0;
    resumes = 0;
    constructor() { FakeAudioContext.built += 1; FakeAudioContext.last = this; }
    static last: FakeAudioContext | undefined;
    suspend() { this.suspends += 1; this.state = 'suspended'; return Promise.resolve(); }
    resume() { this.resumes += 1; this.state = 'running'; return Promise.resolve(); }
}

let idleCallbacks: Array<() => void>;

beforeEach(() => {
    FakeAudioContext.built = 0;
    FakeAudioContext.last = undefined;
    idleCallbacks = [];
    vi.resetModules();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('window', {
        requestIdleCallback: (fn: () => void) => { idleCallbacks.push(fn); return idleCallbacks.length; },
        cancelIdleCallback: () => {},
    });
});

afterEach(() => { vi.unstubAllGlobals(); });

const load = () => import('./sounds');
const primed = async () => {
    const sounds = await load();
    sounds.prepareSoundEffects();
    idleCallbacks.forEach((fn) => fn());
    return sounds;
};

describe('releasing the audio device', () => {
    it('does not start the audio device when a gesture beats idle preparation', async () => {
        const sounds = await load();
        sounds.prepareSoundEffects();
        sounds.unlockSoundEffects();
        expect(FakeAudioContext.built).toBe(0);

        idleCallbacks.forEach(fn => fn());
        sounds.suspendSoundEffects();
        sounds.unlockSoundEffects();
        expect(FakeAudioContext.built).toBe(1);
        expect(FakeAudioContext.last?.resumes).toBe(1);
    });

    it('suspends a context that is running', async () => {
        const sounds = await primed();
        // The control: priming really did build one and leave it running, so a
        // pass below cannot be the suspend finding nothing to do.
        expect(FakeAudioContext.built).toBe(1);
        expect(FakeAudioContext.last?.state).toBe('running');

        sounds.suspendSoundEffects();
        expect(FakeAudioContext.last?.suspends).toBe(1);
        expect(FakeAudioContext.last?.state).toBe('suspended');
    });

    it('suspends rather than closes, so turning sound back on is a resume', async () => {
        const sounds = await primed();
        sounds.suspendSoundEffects();

        sounds.unlockSoundEffects();
        // The same context, resumed -- not a second one built, which is the
        // ~125ms of device startup prepareSoundEffects exists to avoid.
        expect(FakeAudioContext.built).toBe(1);
        expect(FakeAudioContext.last?.resumes).toBe(1);
        expect(FakeAudioContext.last?.state).toBe('running');
    });

    it('does not build a context just to release one that was never built', async () => {
        const sounds = await load();
        sounds.suspendSoundEffects();
        expect(FakeAudioContext.built).toBe(0);
    });

    it('leaves an already suspended context alone', async () => {
        const sounds = await primed();
        sounds.suspendSoundEffects();
        sounds.suspendSoundEffects();
        expect(FakeAudioContext.last?.suspends).toBe(1);
    });
});

/**
 * The release only happens if `App.tsx` asks for it, and no unit test here can
 * reach that effect. Pin the wiring the way `preferencesRoundTrip` pins its
 * lists: the cleanup that drops the unlock listeners must also suspend, or
 * turning sound off leaves the device running and nothing in this file notices.
 */
describe('the sound effect in App.tsx', () => {
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

    it('suspends the device in the same cleanup that drops the unlock listeners', () => {
        const start = appSource.indexOf("const unlock = () => unlockSoundEffects();");
        expect(start, 'the sound effect has moved').toBeGreaterThanOrEqual(0);
        const cleanup = appSource.slice(start, appSource.indexOf('}, [soundEnabled]);', start));
        expect(cleanup).toContain("window.removeEventListener('pointerdown', unlock)");
        expect(cleanup).toContain('suspendSoundEffects()');
    });
});
