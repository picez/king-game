import { useEffect, useRef, useState } from 'react';
import { useI18n, LanguageSelector } from '../i18n';
import { AVATARS } from '../core/avatars';
import { saveNickname, saveAvatar, saveDefaultTimer, loadGuestKey, saveGuestKey } from '../net/prefs';
import {
  apiBaseFromWsUrl, fetchMe, ensureGuestSession,
  updateProfile, updateSettings, fetchKingSettings, updateKingSettings,
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

type Account = 'local' | 'guest';

/**
 * A small, OPTIONAL account/profile area (Stage 4). It works fully offline on
 * localStorage prefs; when the API + a DB session are available it hydrates from
 * and writes through to the server. Nothing here gates play — local pass-and-play
 * and online guest rooms work whether or not this panel ever talks to a server.
 */
export default function AccountPanel({
  serverUrl, name, onName, avatar, onAvatar, defaultTimer, onDefaultTimer,
}: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<Account>('local');
  const [syncing, setSyncing] = useState(false);
  const hydrated = useRef(false);

  const base = apiBaseFromWsUrl(serverUrl);

  // On first open, try to hydrate identity/settings from the server (soft).
  useEffect(() => {
    if (!open || hydrated.current) return;
    hydrated.current = true;
    let cancelled = false;
    (async () => {
      const me = await fetchMe(base);
      if (cancelled || !me) return; // API down / db disabled → stay local
      if (me.authenticated && me.user) {
        setAccount('guest');
        if (me.user.displayName) onName(me.user.displayName);
        if (me.settings?.avatar) onAvatar(me.settings.avatar);
      }
      const king = await fetchKingSettings(base);
      if (!cancelled && king) onDefaultTimer(king.defaultTimer);
    })();
    return () => { cancelled = true; };
  }, [open, base, onName, onAvatar, onDefaultTimer]);

  /** Create/reuse a guest user + session, then push current prefs. "Save progress". */
  async function saveProgress() {
    setSyncing(true);
    try {
      const res = await ensureGuestSession(base, loadGuestKey());
      if (!res) { setSyncing(false); return; } // API unavailable — stays local
      saveGuestKey(res.guestKey);
      setAccount('guest');
      // Push the local prefs so the DB reflects what the user sees.
      await updateProfile(base, name);
      await updateSettings(base, { lang, avatar });
      await updateKingSettings(base, { defaultTimer });
    } finally {
      setSyncing(false);
    }
  }

  // Fire-and-forget sync helpers: always save locally, try the server if signed in.
  function changeName(v: string) {
    onName(v); saveNickname(v);
    if (account === 'guest') void updateProfile(base, v);
  }
  function changeAvatar(v: string) {
    onAvatar(v); saveAvatar(v);
    if (account === 'guest') void updateSettings(base, { avatar: v });
  }
  function changeTimer(v: number) {
    onDefaultTimer(v); saveDefaultTimer(v);
    if (account === 'guest') void updateKingSettings(base, { defaultTimer: v });
  }

  return (
    <div className="account-panel">
      <button className="btn btn--ghost btn--small account-panel__toggle"
        onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        👤 {t('account.title')} {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="account-panel__body">
          <p className="account-panel__status">
            {t('account.status')}: <strong>{account === 'guest' ? t('account.guest') : t('account.local')}</strong>
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
            {account === 'local' && (
              <button className="btn btn--outline" onClick={saveProgress} disabled={syncing}>
                {syncing ? `${t('net.connecting')}…` : `💾 ${t('account.saveProgress')}`}
              </button>
            )}
            <button className="btn btn--outline" disabled title={t('account.comingSoon')}>
              🔵 {t('account.google')} · {t('account.comingSoon')}
            </button>
          </div>
          <p className="setup-hint">{t('account.hint')}</p>
        </div>
      )}
    </div>
  );
}
