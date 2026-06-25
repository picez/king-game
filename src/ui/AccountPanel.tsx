import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n, LanguageSelector } from '../i18n';
import { AVATARS } from '../core/avatars';
import { saveNickname, saveAvatar, saveDefaultTimer, loadGuestKey, saveGuestKey } from '../net/prefs';
import {
  apiBaseFromWsUrl, fetchMe, ensureGuestSession,
  updateProfile, updateSettings, fetchKingSettings, updateKingSettings,
  googleStartUrl, logout, type MeResponse,
} from '../net/profileApi';

const TIMER_OPTIONS = [0, 30, 60, 90] as const;

interface Props {
  /** The WebSocket server URL the menu already resolved — API shares its host. */
  serverUrl: string;
  name: string;
  onName: (v: string) => void;
  avatar: string;
  onAvatar: (v: string) => void;
  defaultTimer: number;
  onDefaultTimer: (v: number) => void;
}

/**
 * A small, OPTIONAL account/profile area (Stage 4 + 6). It works fully offline
 * on localStorage prefs; when the API + a DB session are available it hydrates
 * from and writes through to the server, and offers **Google sign-in** to save
 * progress across devices (guest data is merged server-side on login — Stage 6).
 * Nothing here gates play — local pass-and-play and online guest rooms work
 * whether or not this panel ever talks to a server.
 */
export default function AccountPanel({
  serverUrl, name, onName, avatar, onAvatar, defaultTimer, onDefaultTimer,
}: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState<'success' | 'error' | null>(null);
  const hydrated = useRef(false);

  const base = apiBaseFromWsUrl(serverUrl);

  // Derived auth state from /api/me.
  const hasSession = !!me?.authenticated && !!me?.user;
  const isGuest = hasSession && me?.user?.isGuest === true;
  const signedIn = hasSession && !!me?.provider;

  const hydrate = useCallback(async () => {
    const m = await fetchMe(base);
    setMe(m ?? { authenticated: false, user: null });
    if (m?.authenticated && m.user) {
      if (m.user.displayName) onName(m.user.displayName);
      if (m.settings?.avatar) onAvatar(m.settings.avatar);
    }
    const king = await fetchKingSettings(base);
    if (king) onDefaultTimer(king.defaultTimer);
  }, [base, onName, onAvatar, onDefaultTimer]);

  // On mount: react to the OAuth redirect (?login=success|error), then strip it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const login = params.get('login');
    if (login !== 'success' && login !== 'error') return;
    setOpen(true);
    setBanner(login);
    params.delete('login');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
    hydrated.current = true;
    void hydrate();
  }, [hydrate]);

  // On first open, hydrate identity/settings (soft).
  useEffect(() => {
    if (!open || hydrated.current) return;
    hydrated.current = true;
    void hydrate();
  }, [open, hydrate]);

  /** Create/reuse a guest user + session, then push current prefs. "Save progress". */
  async function saveProgress() {
    setSyncing(true);
    try {
      const res = await ensureGuestSession(base, loadGuestKey());
      if (!res) return; // API unavailable — stays local
      saveGuestKey(res.guestKey);
      await updateProfile(base, name);
      await updateSettings(base, { lang, avatar });
      await updateKingSettings(base, { defaultTimer });
      await hydrate();
    } finally {
      setSyncing(false);
    }
  }

  async function doLogout() {
    await logout(base);
    setBanner(null);
    setMe({ authenticated: false, user: null });
  }

  // Fire-and-forget sync helpers: always save locally, try the server if signed in.
  function changeName(v: string) {
    onName(v); saveNickname(v);
    if (hasSession) void updateProfile(base, v);
  }
  function changeAvatar(v: string) {
    onAvatar(v); saveAvatar(v);
    if (hasSession) void updateSettings(base, { avatar: v });
  }
  function changeTimer(v: number) {
    onDefaultTimer(v); saveDefaultTimer(v);
    if (hasSession) void updateKingSettings(base, { defaultTimer: v });
  }

  const statusLabel = signedIn ? t('account.signedInGoogle') : isGuest ? t('account.guest') : t('account.local');

  return (
    <div className="account-panel">
      <button className="btn btn--ghost btn--small account-panel__toggle"
        onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        👤 {t('account.title')} {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="account-panel__body">
          {banner === 'success' && <p className="account-panel__ok">✅ {t('account.loginSuccess')}</p>}
          {banner === 'error' && <p className="lobby-error">{t('account.loginError')}</p>}

          <p className="account-panel__status">
            {t('account.status')}: <strong>{statusLabel}</strong>
            {signedIn && me?.email && <span className="account-panel__email"> · {me.email}</span>}
          </p>

          <div className="field-group">
            <label>{t('account.displayName')}</label>
            <input className="input" value={name} maxLength={20}
              onChange={(e) => changeName(e.target.value)} placeholder={t('form.name')} />
          </div>

          <div className="field-group">
            <label>{t('lobby.avatar')} <span className="avatar-current">{avatar}</span></label>
            <div className="avatar-picker">
              {AVATARS.map((a) => (
                <button key={a} type="button"
                  className={`avatar-chip ${avatar === a ? 'avatar-chip--active' : ''}`}
                  aria-label={`avatar ${a}`} aria-pressed={avatar === a}
                  onClick={() => changeAvatar(a)}>{a}</button>
              ))}
            </div>
          </div>

          <div className="field-group">
            <label>{t('lang.label')}</label>
            <LanguageSelector />
          </div>

          <div className="field-group">
            <label>{t('account.defaultTimer')}</label>
            <div className="button-row">
              {TIMER_OPTIONS.map((s) => (
                <button key={s}
                  className={`btn btn--outline btn--small ${defaultTimer === s ? 'btn--active' : ''}`}
                  onClick={() => changeTimer(s)}>
                  {s === 0 ? t('lobby.timerOff') : `${s}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="account-panel__actions">
            {signedIn ? (
              <button className="btn btn--outline" onClick={doLogout}>🚪 {t('account.logout')}</button>
            ) : (
              <>
                {!isGuest && (
                  <button className="btn btn--outline" onClick={saveProgress} disabled={syncing}>
                    {syncing ? `${t('net.connecting')}…` : `💾 ${t('account.saveProgress')}`}
                  </button>
                )}
                {me ? (
                  <>
                    <p className="setup-hint">{t('account.signInCta')}</p>
                    <a className="btn btn--outline account-panel__google" href={googleStartUrl(base)}>
                      🔵 {t('account.google')}
                    </a>
                  </>
                ) : (
                  <button className="btn btn--outline" disabled title={t('account.comingSoon')}>
                    🔵 {t('account.google')} · {t('account.comingSoon')}
                  </button>
                )}
              </>
            )}
          </div>
          <p className="setup-hint">{t('account.hint')}</p>
        </div>
      )}
    </div>
  );
}
