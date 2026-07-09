// Stage 15.2 — sound engine decision logic, with a FAKE audio boundary. No real
// playback: we inject a SoundEnv whose createAudio() returns a spy element, and
// assert the engine's should-play / volume / throttle / lazy-init behaviour.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  playSound, __resetSoundEngineForTests, SOUND_THROTTLE_MS,
  type SoundEnv, type AudioLike,
} from './soundEngine';
import type { SoundPreference } from './soundPreference';
import { getSoundAsset } from './soundAssets';

/** A spy audio element recording volume + play() calls. */
function spyAudio(): AudioLike & { plays: number; volumeAt: number[] } {
  const el = {
    src: '', volume: 1, currentTime: 0, plays: 0, volumeAt: [] as number[],
    canPlayType: (_t: string) => 'probably', // pretend webm/opus is supported
    play() { this.plays++; this.volumeAt.push(this.volume); return Promise.resolve(); },
  };
  return el;
}

/** Build an env + capture every created element. */
function makeEnv(over: Partial<{ preference: SoundPreference; hidden: boolean; now: number }> = {}) {
  const created: Array<ReturnType<typeof spyAudio>> = [];
  let now = over.now ?? 1000;
  const env: SoundEnv = {
    preference: () => over.preference ?? 'full',
    isHidden: () => over.hidden ?? false,
    now: () => now,
    createAudio: () => { const a = spyAudio(); created.push(a); return a; },
  };
  return { env, created, advance: (ms: number) => { now += ms; } };
}

beforeEach(() => __resetSoundEngineForTests());

describe('soundEngine.playSound', () => {
  it('does NOT create any audio until a play is actually requested', () => {
    const { created } = makeEnv();
    expect(created).toHaveLength(0); // building the env alone touches nothing
  });

  it('is a no-op when the preference is off (never creates audio)', () => {
    const { env, created } = makeEnv({ preference: 'off' });
    playSound('ui-click', env);
    expect(created).toHaveLength(0);
  });

  it('is a no-op when the tab is hidden', () => {
    const { env, created } = makeEnv({ hidden: true });
    playSound('ui-click', env);
    expect(created).toHaveLength(0);
  });

  it('is a no-op for an unknown id', () => {
    const { env, created } = makeEnv();
    playSound('nope' as never, env);
    expect(created).toHaveLength(0);
  });

  it('plays once for a valid id at full volume = asset.volumeHint * 1', () => {
    const { env, created } = makeEnv({ preference: 'full' });
    playSound('ui-click', env);
    expect(created).toHaveLength(1);
    expect(created[0].plays).toBe(1);
    expect(created[0].volumeAt[0]).toBeCloseTo(getSoundAsset('ui-click')!.volumeHint);
  });

  it('subtle mode plays quieter than full mode', () => {
    const full = makeEnv({ preference: 'full' });
    playSound('card-play', full.env);
    __resetSoundEngineForTests();
    const subtle = makeEnv({ preference: 'subtle' });
    playSound('card-play', subtle.env);
    expect(subtle.created[0].volumeAt[0]).toBeLessThan(full.created[0].volumeAt[0]);
    expect(subtle.created[0].volumeAt[0]).toBeGreaterThan(0);
  });

  it('throttles repeated plays of the same id within the window, reuses one element', () => {
    const { env, created, advance } = makeEnv();
    playSound('ui-click', env);
    playSound('ui-click', env); // immediate repeat → throttled
    expect(created).toHaveLength(1);
    expect(created[0].plays).toBe(1);
    advance(SOUND_THROTTLE_MS + 10);
    playSound('ui-click', env); // after the window → plays again on the cached element
    expect(created).toHaveLength(1);
    expect(created[0].plays).toBe(2);
  });

  it('never throws even if play() rejects (load/autoplay failure degrades to no-op)', () => {
    const created: AudioLike[] = [];
    const env: SoundEnv = {
      preference: () => 'full', isHidden: () => false, now: () => 0,
      createAudio: () => {
        const a: AudioLike = {
          src: '', volume: 1, currentTime: 0,
          canPlayType: () => 'probably',
          play: () => Promise.reject(new Error('blocked')),
        };
        created.push(a); return a;
      },
    };
    expect(() => playSound('ui-click', env)).not.toThrow();
    expect(created).toHaveLength(1);
  });
});
