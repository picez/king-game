// Stage 15.3 — P0 gameplay sound events. The React hooks are thin ref-diffing
// wrappers around the pure decision core; the node test env has no DOM, so we test
// the pure functions (which hold ALL the logic) plus a spy on the engine to prove
// transitions route through playSound (and mount / no-change do not).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { soundEventsFor, finishSoundFor } from './useSoundEvents';

describe('soundEventsFor (pure decision core)', () => {
  it('plays NOTHING on the first render (no previous snapshot)', () => {
    expect(soundEventsFor(null, { tableCount: 0 })).toEqual([]);
    // reconnect straight into an in-progress trick still plays nothing on mount
    expect(soundEventsFor(null, { tableCount: 3, trumpVisible: true })).toEqual([]);
  });

  it('plays card-play when the table count increases', () => {
    expect(soundEventsFor({ tableCount: 0 }, { tableCount: 1 })).toEqual(['card-play']);
    expect(soundEventsFor({ tableCount: 2 }, { tableCount: 3 })).toEqual(['card-play']);
  });

  it('plays trick-collect when the table count decreases (trick/bout cleared)', () => {
    expect(soundEventsFor({ tableCount: 4 }, { tableCount: 0 })).toEqual(['trick-collect']);
    expect(soundEventsFor({ tableCount: 3 }, { tableCount: 2 })).toEqual(['trick-collect']);
  });

  it('plays NOTHING when the state is identical (no replay on re-render)', () => {
    expect(soundEventsFor({ tableCount: 2 }, { tableCount: 2 })).toEqual([]);
    expect(soundEventsFor({ tableCount: 2, trumpVisible: true }, { tableCount: 2, trumpVisible: true })).toEqual([]);
  });

  it('plays trump-reveal only on a false→true transition', () => {
    expect(soundEventsFor({ trumpVisible: false }, { trumpVisible: true })).toEqual(['trump-reveal']);
    expect(soundEventsFor({ trumpVisible: true }, { trumpVisible: true })).toEqual([]);
    expect(soundEventsFor({ trumpVisible: true }, { trumpVisible: false })).toEqual([]); // new round reset, no sound
  });

  it('omitted trumpVisible (e.g. Durak, always-visible trump) never plays trump-reveal', () => {
    expect(soundEventsFor({ tableCount: 1 }, { tableCount: 2 })).toEqual(['card-play']);
    expect(soundEventsFor({ tableCount: 1 }, { tableCount: 1 })).toEqual([]);
  });

  it('can emit a card-play and a trump-reveal together', () => {
    expect(soundEventsFor(
      { tableCount: 0, trumpVisible: false },
      { tableCount: 1, trumpVisible: true },
    )).toEqual(['card-play', 'trump-reveal']);
  });
});

describe('finishSoundFor', () => {
  it('maps a celebratory result to finish-win, else finish-neutral', () => {
    expect(finishSoundFor(true)).toBe('finish-win');
    expect(finishSoundFor(false)).toBe('finish-neutral');
  });
});

// The effect bodies just iterate the decision core into playSound. Prove the wiring
// hits the engine on a transition and stays silent on mount / no-change. The engine's
// own off/hidden/throttle no-ops are covered in soundEngine.test.ts.
vi.mock('./soundEngine', () => ({ playSound: vi.fn() }));
import { playSound } from './soundEngine';

describe('event → engine wiring', () => {
  beforeEach(() => vi.mocked(playSound).mockClear());

  const applyEvents = (prev: Parameters<typeof soundEventsFor>[0], next: Parameters<typeof soundEventsFor>[1]) => {
    for (const id of soundEventsFor(prev, next)) playSound(id);
  };

  it('calls playSound for each transition sound', () => {
    applyEvents({ tableCount: 0 }, { tableCount: 1 });
    expect(playSound).toHaveBeenCalledExactlyOnceWith('card-play');
  });

  it('does NOT call playSound on mount or an unchanged state', () => {
    applyEvents(null, { tableCount: 3, trumpVisible: true });
    applyEvents({ tableCount: 3 }, { tableCount: 3 });
    expect(playSound).not.toHaveBeenCalled();
  });

  it('routes the finish sound through the engine once', () => {
    playSound(finishSoundFor(true));
    expect(playSound).toHaveBeenCalledExactlyOnceWith('finish-win');
  });
});
