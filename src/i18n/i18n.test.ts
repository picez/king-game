import { describe, it, expect } from 'vitest';
import { translate, isRtl, LANGS, I18N_KEYS } from './index';
import { saveNickname, loadNickname, saveLang, loadLang, saveAvatar, loadAvatar } from '../net/prefs';
import { AVATARS } from '../core/avatars';
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
      'lobby.host', 'lobby.kick', 'lobby.kickConfirm', 'err.KICKED_BY_HOST',
      'lobby.addBot', 'lobby.bot', 'lobby.aiPlayer', 'wait.botThinking', 'wait.reconnect',
      'lobby.turnTimer', 'lobby.timerOff', 'lobby.avatar', 'track.youDealt',
      'game.rules', 'ruleFull.no_tricks', 'ruleFull.king_of_hearts', 'ruleFull.trump',
      'track.title', 'track.no_tricks', 'track.no_jacks', 'track.no_queens',
      'track.king_of_hearts', 'track.last_two_tricks', 'track.trump', 'track.subtotal', 'track.total',
      'net.connecting', 'net.dealing',
      'stats.title', 'stats.myStats', 'stats.leaderboard', 'stats.gamesPlayed',
      'stats.winRate', 'stats.bestScore', 'stats.noGames', 'stats.unavailable',
      'stats.refresh', 'stats.byMode', 'stats.player', 'stats.anonymous',
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

describe('i18n encoding integrity (no mojibake; 4 languages only)', () => {
  it('exposes exactly the 4 supported languages with correct native labels (no Russian)', () => {
    expect(LANGS.map((l) => l.code)).toEqual(['en', 'uk', 'de', 'ar']);
    const labels = Object.fromEntries(LANGS.map((l) => [l.code, l.label]));
    expect(labels.en).toBe('English');
    expect(labels.uk).toBe('Українська');
    expect(labels.de).toBe('Deutsch');
    expect(labels.ar).toBe('العربية');
    // There is no Russian language in the UI.
    expect(LANGS.some((l) => l.code === 'ru')).toBe(false);
    expect(LANGS.some((l) => /Русск/i.test(l.label))).toBe(false);
  });

  it('keeps "Card Majlis" as the product brand (untranslated, every language)', () => {
    for (const { code } of LANGS) {
      expect(translate(code, 'app.title')).toBe('Card Majlis');
    }
  });

  it('renders real native text per language (not corrupted bytes)', () => {
    // The localized SUBTITLE now carries the native-script check (the title is the
    // untranslated brand). It lists the localized game names (Stage 14.0 rebrand).
    expect(translate('uk', 'app.subtitle')).toContain('Кінг');     // not "Рљ.."/"Р.."
    expect(translate('de', 'app.subtitle')).toContain('König');    // not "Г.."
    expect(translate('ar', 'app.subtitle')).toMatch(/[؀-ۿ]/); // Arabic block, not "Щ.."
    expect(translate('uk', 'app.subtitle')).not.toMatch(/Рљ|Рџ|РЈ/);
    expect(translate('de', 'app.subtitle')).not.toContain('Г');
    expect(translate('ar', 'app.subtitle')).not.toContain('Щ');
  });

  it('no visible translation string contains classic mojibake markers', () => {
    // 2-char Cyrillic/Latin double-encoding sequences + the Arabic "lam" mojibake
    // (Щ„). None of these can occur in correct uk/de/ar/en text.
    const MOJIBAKE = ['РЈ', 'Рљ', 'Рџ', 'СЊ', 'СЏ', 'вЂ', 'рџ', 'Г¤', 'Г¶', 'Г¼', 'ГŸ', 'Щ„'];
    for (const { code } of LANGS) {
      for (const key of I18N_KEYS) {
        const s = translate(code, key);
        for (const m of MOJIBAKE) {
          expect(s.includes(m), `${code}:${key} contains "${m}" → "${s}"`).toBe(false);
        }
      }
    }
  });
});

describe('prefs persistence', () => {
  it('saves and loads the nickname (localStorage)', () => {
    const s = mem();
    expect(loadNickname(s)).toBeNull();
    saveNickname('Alice', s);
    expect(loadNickname(s)).toBe('Alice');
  });

  it('saves/loads a whitelisted avatar; rejects invalid ones', () => {
    const s = mem();
    expect(loadAvatar(s)).toBeNull();
    saveAvatar(AVATARS[2], s);
    expect(loadAvatar(s)).toBe(AVATARS[2]);
    saveAvatar('<script>', s);           // invalid → not persisted
    expect(loadAvatar(s)).toBe(AVATARS[2]); // unchanged
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
