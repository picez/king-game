import { useEffect, useRef, useState } from 'react';
import { useI18n, LanguageSelector } from '../../i18n';
import { AVATARS, sanitizeAvatar } from '../../core/avatars';
import { saveNickname, saveAvatar, saveDefaultTimer, saveCardStyle, saveMotionPreference, saveFavoriteGame, saveCardFaceTheme } from '../../net/prefs';
import { saveCustomAvatar, clearCustomAvatar, AVATAR_ACCEPT_ATTR } from '../../net/customAvatar';
import type { AvatarUploadError } from '../../net/avatarApi';
import { saveCustomServer, clearCustomServer } from '../../net/connection';
import { defaultServerUrl, isInsecureWsOnSecurePage } from '../../net/online';
import { processAvatarImage } from '../components/customAvatarImage';
import { useCustomAvatar, setCustomAvatar } from '../components/customAvatarStore';
import MyAvatar from '../components/MyAvatar';
import GameIcon from '../components/GameIcon';
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
import { SOUND_PREFERENCES, type SoundPreference } from '../../audio/soundPreference';
import { useSoundPreference, setSoundPreference } from '../../audio/soundPreferenceStore';
import { playSound } from '../../audio/soundEngine';
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

/** i18n key for each sound option's label. */
const SOUND_LABEL_KEY: Record<SoundPreference, string> = {
  off: 'profile.soundOff',
  subtle: 'profile.soundSubtle',
  full: 'profile.soundFull',
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
  /** Custom server URL (null = default server); Stage 14.2 connection setting. */
  customServer: string | null;
  onCustomServer: (v: string | null) => void;
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
  customServer, onCustomServer,
}: Props) {
  const { t, lang } = useI18n();
  const firstLang = useRef(true);
  const cardBack = useCardBackStyle();
  const cardFace = useCardFaceTheme();
  const animation = useMotionPreference();
  const sound = useSoundPreference();
  // Local-only custom avatar (Stage 14.1): NEVER uploaded/synced/put on the wire.
  const customAvatar = useCustomAvatar();
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  // Server-SYNCED avatar (Stage 17.2): signed-in only, uploaded via the dedicated
  // multipart endpoint (NOT settings). Its own busy/error state so the two avatar
  // paths (synced vs this-device) never share UI state.
  const syncedFileRef = useRef<HTMLInputElement>(null);
  const [syncedBusy, setSyncedBusy] = useState(false);
  const [syncedError, setSyncedError] = useState<string | null>(null);
  // Connection setting (Stage 14.2): default vs custom server, device-local.
  const [serverMode, setServerMode] = useState<'default' | 'custom'>(customServer ? 'custom' : 'default');
  const [serverDraft, setServerDraft] = useState(customServer ?? '');
  const [serverError, setServerError] = useState<string | null>(null);

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

  // Synced avatar: upload the picked file to the server (multipart), then the
  // account re-hydrates so the preview + AccountBar pick up the new URL. Guests
  // never reach here (the control is signed-in only). No image bytes on the WS.
  const syncedErrorMsg = (e: AvatarUploadError): string => {
    switch (e) {
      case 'unsupported_type': return t('avatar.errType');
      case 'too_large': return t('avatar.errSize');
      case 'rate_limited': return t('avatar.errRate');
      case 'unavailable': return t('avatar.errUnavailable');
      case 'unauthenticated': case 'forbidden': return t('avatar.errSignIn');
      default: return t('avatar.errFailed');
    }
  };
  async function onPickSynced(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSyncedError(null); setSyncedBusy(true);
    try {
      const res = await account.uploadAvatarImage(file);
      if (!res.ok) setSyncedError(syncedErrorMsg(res.error));
    } finally {
      setSyncedBusy(false);
    }
  }
  async function removeSyncedAvatar() {
    setSyncedError(null); setSyncedBusy(true);
    try { await account.removeAvatarImage(); } finally { setSyncedBusy(false); }
  }

  // Connection: switching to "Custom" reveals the input (prefilled with the default
  // as a starting point); switching to "Default" immediately resets to the default.
  function switchServerMode(mode: 'default' | 'custom') {
    setServerMode(mode);
    setServerError(null);
    if (mode === 'default') {
      clearCustomServer(); onCustomServer(null); setServerDraft('');
    } else if (!serverDraft.trim()) {
      setServerDraft(customServer ?? defaultServerUrl(undefined, undefined));
    }
  }
  // Validate + persist the custom URL locally (never synced). Invalid → inline error.
  function applyCustomServer() {
    const saved = saveCustomServer(serverDraft);
    if (!saved) { setServerError(t('conn.invalid')); return; }
    onCustomServer(saved); setServerDraft(saved); setServerError(null);
  }
  function resetToDefaultServer() { switchServerMode('default'); }
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
  // Sound is a LOCAL, device-only preference (default off), never synced to the
  // server — so no account.push*, unlike the visual prefs above. The store
  // persists it to localStorage itself.
  function changeSound(v: SoundPreference) { setSoundPreference(v); }
  const soundLabel = (s: SoundPreference) => t(SOUND_LABEL_KEY[s]);
  // The ONLY sound wired in Stage 15.2: an explicit-gesture preview. Silent when off.
  function previewSound() { if (sound !== 'off') playSound('ui-click'); }
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

  // Summary header (Stage 14.2): who you are + how your profile is stored. The
  // display name mirrors AccountBar's precedence (server name → local → Guest).
  const displayName = account.displayName ?? name ?? t('account.guestShort');
  // Sync state, three plain tiers — signed-in (cross-device) → guest session on
  // the server → local-only (no session / API down). Drives the status chip text.
  const status: { kind: 'synced' | 'guest' | 'local'; label: string } =
    account.signedIn ? { kind: 'synced', label: t('profile.statusSynced') }
      : account.hasSession ? { kind: 'guest', label: t('profile.statusGuest') }
        : { kind: 'local', label: t('profile.statusLocal') };

  return (
    <div className="profile-form">
      {/* Profile summary card: avatar + name + account line + favorite game +
          storage status. Read-only overview; the controls to change any of it
          live in the grouped sections below. Sign-in/out stays in AccountBar. */}
      <div className="profile-summary">
        <span className="profile-summary__avatar">
          <MyAvatar emoji={sanitizeAvatar(avatar, name)} imageUrl={account.avatarImageUrl} className="profile-summary__avatar-inner" />
        </span>
        <div className="profile-summary__meta">
          <span className="profile-summary__name">{displayName}</span>
          {account.signedIn && account.email ? (
            <span className="profile-summary__email">
              <span className="account-bar__chip" aria-hidden="true">G</span> {account.email}
            </span>
          ) : (
            <span className="profile-summary__sub">{t('account.guestShort')}</span>
          )}
          <div className="profile-summary__tags">
            <span className="profile-summary__fav" title={t('profile.favoriteGame')}>
              <GameIcon game={favoriteGame} size="sm" className="profile-summary__fav-icon" />
              <span className="profile-summary__fav-label">{t(`gameType.${favoriteGame}`)}</span>
            </span>
            <span className={`profile-summary__status profile-summary__status--${status.kind}`}>
              {status.label}
            </span>
          </div>
        </div>
      </div>
      {!account.signedIn && (
        <p className="profile-summary__note field__hint">{t('profile.localPrefsNote')}</p>
      )}

      <h3 className="profile-section-head">{t('account.title')}</h3>

      <div className="field">
        <label className="field__label">{t('account.displayName')}</label>
        <input className="input" value={name} maxLength={20}
          onChange={(e) => changeName(e.target.value)} placeholder={t('form.name')} />
      </div>

      <div className="field">
        <label className="field__label">{t('lobby.avatar')}</label>
        <div className="avatar-row">
          {/* Circular preview: synced server image → local custom image → emoji. */}
          <span className="avatar-preview">
            <MyAvatar emoji={sanitizeAvatar(avatar, name)} imageUrl={account.avatarImageUrl} className="avatar-preview__inner" />
          </span>
          <div className="avatar-row__picker">
            {/* Emoji fallback identity — what online players still see. */}
            <span className="avatar-group__title">{t('avatar.emojiTitle')}</span>
            <SelectMenu
              ariaLabel={t('lobby.avatar')}
              className="avatar-picker"
              layout="grid"
              compactTrigger
              value={sanitizeAvatar(avatar, name)}
              onChange={changeAvatar}
              options={AVATARS.map((a) => ({ value: a, label: a, icon: a }))}
            />
          </div>
        </div>

        {/* Synced avatar (server, Stage 17.2) — signed-in only; visible in your
            profile now, on table/lobby seats in a later update. */}
        <div className="avatar-group">
          <span className="avatar-group__title">☁️ {t('avatar.syncedTitle')}</span>
          {account.signedIn ? (
            <>
              <div className="avatar-row__actions">
                <input ref={syncedFileRef} type="file" accept={AVATAR_ACCEPT_ATTR}
                  className="visually-hidden" onChange={onPickSynced} />
                <button type="button" className="btn btn--outline btn--small" disabled={syncedBusy}
                  onClick={() => syncedFileRef.current?.click()}>
                  {syncedBusy ? `${t('avatar.uploading')}…` : `☁️ ${t('avatar.uploadSynced')}`}
                </button>
                {account.avatarImageUrl && (
                  <button type="button" className="btn btn--ghost btn--small" disabled={syncedBusy}
                    onClick={() => void removeSyncedAvatar()}>
                    {t('avatar.removeSynced')}
                  </button>
                )}
              </div>
              {syncedError && <p className="lobby-error avatar-error">{syncedError}</p>}
              <p className="field__hint">{t('avatar.syncedHint')}</p>
            </>
          ) : (
            <p className="field__hint">{t('avatar.syncedGuestHint')}</p>
          )}
        </div>

        {/* This device (local-only, Stage 14.1) — never uploaded / on the wire. */}
        <div className="avatar-group">
          <span className="avatar-group__title">🖼️ {t('avatar.deviceTitle')}</span>
          <div className="avatar-row__actions">
            {/* A visually-hidden file input driven by a styled button (no native
                picker chrome). Accept is EXACTLY the png/jpeg/webp whitelist. */}
            <input ref={avatarFileRef} type="file" accept={AVATAR_ACCEPT_ATTR}
              className="visually-hidden" onChange={onPickAvatar} />
            <button type="button" className="btn btn--outline btn--small"
              onClick={() => avatarFileRef.current?.click()}>
              🖼️ {t('avatar.chooseLocal')}
            </button>
            {customAvatar && (
              <button type="button" className="btn btn--ghost btn--small" onClick={removeCustomAvatar}>
                {t('avatar.remove')}
              </button>
            )}
          </div>
          {avatarError && <p className="lobby-error avatar-error">{avatarError}</p>}
          <p className="field__hint">{t('avatar.localHint')}</p>
        </div>
      </div>

      <h3 className="profile-section-head">{t('profile.preferences')}</h3>

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

      <div className="field">
        <label className="field__label">{t('profile.sound')}</label>
        <div className="segmented segmented--inline" role="radiogroup" aria-label={t('profile.sound')}>
          {SOUND_PREFERENCES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={sound === s}
              className={`segmented__tab ${sound === s ? 'segmented__tab--active' : ''}`}
              onClick={() => changeSound(s)}>
              {soundLabel(s)}
            </button>
          ))}
        </div>
        <p className="field__hint">{t('profile.soundHint')}</p>
        <div className="sound-preview">
          <button type="button" className="btn btn--outline btn--small"
            disabled={sound === 'off'} onClick={previewSound}>
            🔈 {t('profile.soundPreview')}
          </button>
          {sound === 'off' && <span className="field__hint">{t('profile.soundPreviewOff')}</span>}
        </div>
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

      <h3 className="profile-section-head">{t('profile.connection')}</h3>

      {/* Advanced connection (Stage 14.2): a normal player never sees a server
          address — the app auto-uses the default. Custom is an opt-in for LAN/dev/
          private deployments. A DEVICE setting (localStorage), never synced. */}
      <details className="advanced">
        <summary className="advanced__summary">
          🔌 {t('menu.advancedConnection')}
          <span className="advanced__status">· {customServer ? t('conn.custom') : t('conn.default')}</span>
        </summary>
        <div className="advanced__body">
          <p className="field__hint">{t('conn.help')}</p>
          <div className="segmented segmented--inline" role="radiogroup" aria-label={t('menu.advancedConnection')}>
            {(['default', 'custom'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={serverMode === m}
                className={`segmented__tab ${serverMode === m ? 'segmented__tab--active' : ''}`}
                onClick={() => switchServerMode(m)}>
                {t(m === 'default' ? 'conn.useDefault' : 'conn.useCustom')}
              </button>
            ))}
          </div>
          {serverMode === 'custom' && (
            <div className="field conn-custom">
              <label className="field__label">{t('form.server')}</label>
              <input className={`input ${serverError ? 'input--error' : ''}`} value={serverDraft}
                onChange={(e) => { setServerDraft(e.target.value); setServerError(null); }}
                placeholder="ws://host-ip:3001/ws" spellCheck={false} autoCapitalize="none" />
              {serverError && <p className="lobby-error">{serverError}</p>}
              {isInsecureWsOnSecurePage(serverDraft) && (
                <p className="lobby-error">{t('menu.wssWarning')}</p>
              )}
              <div className="conn-custom__actions">
                <button type="button" className="btn btn--outline btn--small" onClick={applyCustomServer}>
                  {t('conn.apply')}
                </button>
                {customServer && (
                  <button type="button" className="btn btn--ghost btn--small" onClick={resetToDefaultServer}>
                    {t('conn.reset')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </details>

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
    </div>
  );
}
