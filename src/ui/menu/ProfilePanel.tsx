import { useEffect, useRef, useState } from 'react';
import { useI18n, LanguageSelector } from '../../i18n';
import { AVATARS, sanitizeAvatar } from '../../core/avatars';
import { saveNickname, saveAvatar, saveDefaultTimer, saveCardStyle, saveMotionPreference, saveFavoriteGame, saveCardFaceTheme } from '../../net/prefs';
import { saveCustomAvatar, clearCustomAvatar, AVATAR_ACCEPT_ATTR } from '../../net/customAvatar';
import { processAvatarImage } from '../components/customAvatarImage';
import { useCustomAvatar, setCustomAvatar } from '../components/customAvatarStore';
import MyAvatar from '../components/MyAvatar';
import type { Account } from '../../hooks/useAccount';
import SelectMenu from '../components/SelectMenu';
import {
  CARD_BACK_STYLES, cardBackUrl, cardBackWebpUrl, cardBackToSetting, type CardBackStyle,
} from '../components/cardArt';
import { useCardBackStyle, setCardBackStyle } from '../components/cardBackStore';
import { CARD_FACE_THEMES, type CardFaceTheme } from '../components/cardFaceTheme';
import { useCardFaceTheme, setCardFaceTheme } from '../components/cardFaceStore';
import { ANIMATION_PREFERENCES, type AnimationPreference } from '../components/motionPref';
import { useMotionPreference, setMotionPreference } from '../components/motionPreferenceStore';
import { GAME_TYPES, type GameType } from '../../games/catalog';
import { gameIconSrc } from '../../visual/visualAssets';

const TIMER_OPTIONS = [0, 30, 60, 90] as const;
/** Emoji fallback for each game's favorite-picker option (matches StartMenu). */
const GAME_EMOJI: Record<GameType, string> = { king: '👑', durak: '🃏', deberc: '🎴', tarneeb: '♠️' };

/** i18n label key per card-back style. */
const CARD_BACK_LABEL_KEY: Record<CardBackStyle, string> = {
  green: 'profile.cardBackClassic',
  red: 'profile.cardBackRed',
  blue: 'profile.cardBackBlue',
  dark: 'profile.cardBackDark',
};

/** i18n label key per card-face theme. */
const CARD_FACE_LABEL_KEY: Record<CardFaceTheme, string> = {
  classic: 'profile.cardFacesClassic',
  clean: 'profile.cardFacesClean',
};

/** i18n key for each animation option's label. */
const ANIMATION_LABEL_KEY: Record<AnimationPreference, string> = {
  system: 'profile.animationSystem',
  full: 'profile.animationFull',
  reduced: 'profile.animationReduced',
  off: 'profile.animationOff',
};

interface Props {
  account: Account;
  name: string;
  onName: (v: string) => void;
  avatar: string;
  onAvatar: (v: string) => void;
  defaultTimer: number;
  onDefaultTimer: (v: number) => void;
  favoriteGame: GameType;
  onFavoriteGame: (v: GameType) => void;
}

/**
 * Profile settings sheet (Stage 7.1): nickname, avatar, LANGUAGE selector, and
 * the King default timer. This is the ONLY place the language selector lives.
 * It writes through to the server when signed in (else local-only), and offers
 * "Save progress" for a guest who hasn't created a session yet. Sign-in/out is
 * NOT here — that lives in the top AccountBar.
 */
export default function ProfilePanel({
  account, name, onName, avatar, onAvatar, defaultTimer, onDefaultTimer, favoriteGame, onFavoriteGame,
}: Props) {
  const { t, lang } = useI18n();
  const firstLang = useRef(true);
  const cardBack = useCardBackStyle();
  const cardFace = useCardFaceTheme();
  const animation = useMotionPreference();
  // Local-only custom avatar (Stage 14.1): NEVER uploaded/synced/put on the wire.
  const customAvatar = useCustomAvatar();
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // The LanguageSelector persists the language locally; mirror it to the server.
  useEffect(() => {
    if (firstLang.current) { firstLang.current = false; return; }
    account.pushLang(lang);
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeName(v: string) { onName(v); saveNickname(v); account.pushName(v); }
  function changeAvatar(v: string) { onAvatar(v); saveAvatar(v); account.pushAvatar(v); }

  // Custom avatar: re-encode the picked image (canvas) to a small local data URL,
  // store it LOCALLY only, and update the "me" surfaces. The emoji `avatar` above
  // is untouched — it stays the server-safe identity everyone else sees online.
  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setAvatarError(null);
    try {
      const dataUrl = await processAvatarImage(file);
      if (!saveCustomAvatar(dataUrl)) throw new Error('too_large');
      setCustomAvatar(dataUrl);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'decode_failed';
      setAvatarError(code === 'unsupported' ? t('avatar.errType')
        : code === 'too_large' ? t('avatar.errSize')
          : t('avatar.errFailed'));
    }
  }
  function removeCustomAvatar() {
    clearCustomAvatar(); setCustomAvatar(null); setAvatarError(null);
  }
  function changeTimer(v: number) { onDefaultTimer(v); saveDefaultTimer(v); account.pushTimer(v); }
  // Card back is a local visual pref applied immediately (store + <html> attr),
  // persisted locally, and mirrored to the server profile when signed in.
  function changeCardBack(v: CardBackStyle) {
    setCardBackStyle(v); saveCardStyle(v); account.pushCardStyle(cardBackToSetting(v));
  }
  const cardBackLabel = (s: CardBackStyle) => t(CARD_BACK_LABEL_KEY[s]);
  // Card face theme is a local, CSS-only visual pref (store + <html data-card-faces>),
  // persisted locally + mirrored to the server profile when signed in.
  function changeCardFace(v: CardFaceTheme) {
    setCardFaceTheme(v); saveCardFaceTheme(v); account.pushCardFaceTheme(v);
  }
  const cardFaceLabel = (th: CardFaceTheme) => t(CARD_FACE_LABEL_KEY[th]);
  // Animation intensity is a local visual pref applied immediately (store + <html>
  // attrs), persisted locally, and mirrored to the server profile when signed in.
  // The OS reduced-motion setting still overrides 'full'/'system' at apply time.
  function changeAnimation(v: AnimationPreference) {
    setMotionPreference(v); saveMotionPreference(v); account.pushAnimation(v);
  }
  // Favorite game pre-selects the Local/Host picker. Local pref + server profile
  // sync (signed in). onFavoriteGame lets the menu update its live picker default.
  function changeFavorite(v: GameType) {
    onFavoriteGame(v); saveFavoriteGame(v); account.pushFavoriteGame(v);
  }
  const favoriteOptions = GAME_TYPES.map((id) => ({
    value: id,
    label: t(`gameType.${id}`),
    icon: GAME_EMOJI[id],       // emoji fallback if the emblem PNG 404s
    iconSrc: gameIconSrc(id),   // Stage 12.3 image emblem
  }));

  return (
    <div className="profile-form">
      <div className="field">
        <label className="field__label">{t('account.displayName')}</label>
        <input className="input" value={name} maxLength={20}
          onChange={(e) => changeName(e.target.value)} placeholder={t('form.name')} />
      </div>

      <div className="field">
        <label className="field__label">{t('lobby.avatar')}</label>
        <div className="avatar-row">
          {/* Circular preview: the local custom image if set, else the emoji. */}
          <span className="avatar-preview">
            <MyAvatar emoji={sanitizeAvatar(avatar, name)} className="avatar-preview__inner" />
          </span>
          <div className="avatar-row__picker">
            <SelectMenu
              ariaLabel={t('lobby.avatar')}
              className="avatar-picker"
              layout="grid"
              compactTrigger
              value={sanitizeAvatar(avatar, name)}
              onChange={changeAvatar}
              options={AVATARS.map((a) => ({ value: a, label: a, icon: a }))}
            />
            <div className="avatar-row__actions">
              {/* A visually-hidden file input driven by a styled button (no native
                  picker chrome). Accept is EXACTLY the png/jpeg/webp whitelist. */}
              <input
                ref={avatarFileRef}
                type="file"
                accept={AVATAR_ACCEPT_ATTR}
                className="visually-hidden"
                onChange={onPickAvatar}
              />
              <button type="button" className="btn btn--outline btn--small"
                onClick={() => avatarFileRef.current?.click()}>
                🖼️ {t('avatar.upload')}
              </button>
              {customAvatar && (
                <button type="button" className="btn btn--ghost btn--small" onClick={removeCustomAvatar}>
                  {t('avatar.remove')}
                </button>
              )}
            </div>
          </div>
        </div>
        {avatarError && <p className="lobby-error avatar-error">{avatarError}</p>}
        <p className="field__hint">{t('avatar.localHint')}</p>
      </div>

      <div className="field">
        <label className="field__label">{t('profile.favoriteGame')}</label>
        <SelectMenu
          ariaLabel={t('profile.favoriteGame')}
          className="game-picker"
          value={favoriteGame}
          onChange={(v) => changeFavorite(v as GameType)}
          options={favoriteOptions}
        />
        <p className="field__hint">{t('profile.favoriteGameHint')}</p>
      </div>

      <h3 className="profile-section-head">{t('profile.appearance')}</h3>

      <div className="field">
        <label className="field__label">{t('profile.cardBack')}</label>
        <div className="cardback-picker" role="radiogroup" aria-label={t('profile.cardBack')}>
          {CARD_BACK_STYLES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={cardBack === s}
              className={`cardback-swatch ${cardBack === s ? 'cardback-swatch--on' : ''}`}
              onClick={() => changeCardBack(s)} title={cardBackLabel(s)}>
              <span className="cardback-swatch__art">
                <picture>
                  <source srcSet={cardBackWebpUrl(s)} type="image/webp" />
                  <img src={cardBackUrl(s)} alt="" draggable={false} loading="lazy" decoding="async" />
                </picture>
              </span>
              <span className="cardback-swatch__label">{cardBackLabel(s)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field__label">{t('profile.cardFaces')}</label>
        <div className="cardface-picker" role="radiogroup" aria-label={t('profile.cardFaces')}>
          {CARD_FACE_THEMES.map((th) => (
            <button key={th} type="button" role="radio" aria-checked={cardFace === th}
              className={`cardface-swatch ${cardFace === th ? 'cardface-swatch--on' : ''}`}
              onClick={() => changeCardFace(th)} title={cardFaceLabel(th)}>
              {/* A tiny MOCK sample card (independent of the live global theme) so
                  each swatch always previews its OWN look. */}
              <span className={`cardface-sample cardface-sample--${th}`} aria-hidden="true">
                <span className="cardface-sample__index">A<span className="cardface-sample__suit">♠</span></span>
                <span className="cardface-sample__center">♠</span>
              </span>
              <span className="cardface-swatch__label">{cardFaceLabel(th)}</span>
            </button>
          ))}
        </div>
        <p className="field__hint">{t('profile.cardFacesHint')}</p>
      </div>

      <div className="field">
        <label className="field__label">{t('profile.animation')}</label>
        <div className="segmented segmented--inline" role="radiogroup" aria-label={t('profile.animation')}>
          {ANIMATION_PREFERENCES.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={animation === a}
              className={`segmented__tab ${animation === a ? 'segmented__tab--active' : ''}`}
              onClick={() => changeAnimation(a)}>
              {t(ANIMATION_LABEL_KEY[a])}
            </button>
          ))}
        </div>
        <p className="field__hint">{t('profile.animationHint')}</p>
      </div>

      <div className="field">
        <label className="field__label">{t('lang.label')}</label>
        <LanguageSelector />
      </div>

      <div className="field">
        <label className="field__label">{t('account.defaultTimer')}</label>
        <div className="segmented segmented--inline">
          {TIMER_OPTIONS.map((s) => (
            <button key={s} type="button"
              className={`segmented__tab ${defaultTimer === s ? 'segmented__tab--active' : ''}`}
              onClick={() => changeTimer(s)}>
              {s === 0 ? t('lobby.timerOff') : `${s}s`}
            </button>
          ))}
        </div>
      </div>

      {/* Profile/settings auto-save locally, and auto-sync to the server on every
          change once there is a session (guest-session or signed-in). Before the
          first sync a guest can OPT IN to server sync — a secondary action, never
          a primary "save" button. Hidden when the API is unreachable (no-op). */}
      {account.apiReachable && !account.hasSession && (
        <div className="profile-form__sync">
          <button className="btn btn--ghost btn--small" disabled={account.syncing}
            onClick={() => void account.saveProgress({ name, avatar, lang, defaultTimer, cardStyle: cardBackToSetting(cardBack), animationPreference: animation, favoriteGame, cardFaceTheme: cardFace })}>
            {account.syncing ? `${t('net.connecting')}…` : `☁️ ${t('account.syncProfile')}`}
          </button>
          <p className="field__hint">{t('account.signInCta')}</p>
        </div>
      )}
      {account.signedIn && account.email && (
        <p className="setup-hint profile-form__email">{account.email}</p>
      )}
    </div>
  );
}
