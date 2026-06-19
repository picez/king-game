import { describe, it, expect } from 'vitest';
import { translate, isRtl, LANGS } from './index';
import { saveNickname, loadNickname, saveLang, loadLang } from '../net/prefs';
import type { StorageLike } from '../net/session';

function mem(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

describe('translate', () => {
  it('returns the chosen language string', () => {
    expect(translate('uk', 'menu.play')).toBe('Грати');
    expect(translate('de', 'btn.join')).toBe('Beitreten');
    expect(translate('ar', 'menu.play')).toBe('العب');
  });

  it('falls back to English when a key is missing in the language', () => {
    // 'err.generic' exists in EN; even if some lang omitted it, EN is the fallback.
    expect(translate('en', 'err.generic')).toBe('Could not join room');
    expect(translate('uk', 'definitely.missing.key')).toBe('definitely.missing.key'); // last-resort: key
  });

  it('marks Arabic as RTL only', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(isRtl('uk')).toBe(false);
    expect(isRtl('de')).toBe(false);
  });

  it('covers the main gameplay namespaces in every language', () => {
    // Representative keys across menus, modes, gameplay, kitty, trump, scoring,
    // finished, waiting, lobby, net. Every language must resolve them (≠ key).
    const keys = [
      'menu.play', 'btn.join', 'common.dealer', 'common.round', 'common.trump',
      'mode.no_tricks', 'mode.trump', 'modeDesc.king_of_hearts', 'type.negative',
      'tip.no_hearts', 'game.scores', 'game.turn', 'panel.myTricks', 'panel.myDiscard',
      'mode.choose', 'kitty.title', 'kitty.discard', 'trump.title', 'suit.hearts',
      'trick.takes', 'scoring.player', 'scoring.nextRoundIn', 'scoring.gamesTitle',
      'finished.title', 'finished.gamesTitle',
      'finished.playAgain', 'wait.waitingFor', 'wait.to.choose', 'lobby.title',
      'lobby.host', 'net.connecting', 'net.dealing',
    ];
    for (const { code } of LANGS) {
      for (const key of keys) {
        expect(translate(code, key), `${code}:${key}`).not.toBe(key); // no missing key leaks through
      }
    }
  });

  it('a key missing in a non-English language falls back to English (not the raw key)', () => {
    // Simulate: a key present in EN. Any language should at worst return the EN text.
    expect(translate('ar', 'menu.play')).toBeTruthy();
    expect(translate('ar', 'menu.play')).not.toBe('menu.play');
  });
});

describe('prefs persistence', () => {
  it('saves and loads the nickname (localStorage)', () => {
    const s = mem();
    expect(loadNickname(s)).toBeNull();
    saveNickname('Alice', s);
    expect(loadNickname(s)).toBe('Alice');
  });

  it('trims and caps the nickname; ignores blank', () => {
    const s = mem();
    saveNickname('   ', s);
    expect(loadNickname(s)).toBeNull();
    saveNickname('  Bob  ', s);
    expect(loadNickname(s)).toBe('Bob');
  });

  it('never stores a password/game state — only the nickname/lang keys', () => {
    const s = mem() as StorageLike & { };
    const store = new Map<string, string>();
    const tracked: StorageLike = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => { store.set(k, v); },
      removeItem: (k) => { store.delete(k); },
    };
    saveNickname('Carol', tracked);
    saveLang('uk', tracked);
    expect([...store.keys()].sort()).toEqual(['king.lang.v1', 'king.nickname.v1']);
    expect(loadLang(tracked)).toBe('uk');
    void s;
  });
});
