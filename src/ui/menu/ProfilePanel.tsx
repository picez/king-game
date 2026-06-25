import { useEffect, useRef } from 'react';
import { useI18n, LanguageSelector } from '../../i18n';
import { AVATARS } from '../../core/avatars';
import { saveNickname, saveAvatar, saveDefaultTimer } from '../../net/prefs';
import type { Account } from '../../hooks/useAccount';

const TIMER_OPTIONS = [0, 30, 60, 90] as const;

interface Props {
  account: Account;
  name: string;
  onName: (v: string) => void;
  avatar: string;
  onAvatar: (v: string) => void;
  defaultTimer: number;
  onDefaultTimer: (v: number) => void;
}

/**
 * Profile settings sheet (Stage 7.1): nickname, avatar, LANGUAGE selector, and
 * the King default timer. This is the ONLY place the language selector lives.
 * It writes through to the server when signed in (else local-only), and offers
 * "Save progress" for a guest who hasn't created a session yet. Sign-in/out is
 * NOT here — that lives in the top AccountBar.
 */
export default function ProfilePanel({
  account, name, onName, avatar, onAvatar, defaultTimer, onDefaultTimer,
}: Props) {
  const { t, lang } = useI18n();
  const firstLang = useRef(true);

  // The LanguageSelector persists the language locally; mirror it to the server.
  useEffect(() => {
    if (firstLang.current) { firstLang.current = false; return; }
    account.pushLang(lang);
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeName(v: string) { onName(v); saveNickname(v); account.pushName(v); }
  function changeAvatar(v: string) { onAvatar(v); saveAvatar(v); account.pushAvatar(v); }
  function changeTimer(v: number) { onDefaultTimer(v); saveDefaultTimer(v); account.pushTimer(v); }

  return (
    <div className="profile-form">
      <div className="field">
        <label className="field__label">{t('account.displayName')}</label>
        <input className="input" value={name} maxLength={20}
          onChange={(e) => changeName(e.target.value)} placeholder={t('form.name')} />
      </div>

      <div className="field">
        <label className="field__label">{t('lobby.avatar')} <span className="avatar-current">{avatar}</span></label>
        <div className="avatar-picker">
          {AVATARS.map((a) => (
            <button key={a} type="button"
              className={`avatar-chip ${avatar === a ? 'avatar-chip--active' : ''}`}
              aria-label={`avatar ${a}`} aria-pressed={avatar === a}
              onClick={() => changeAvatar(a)}>{a}</button>
          ))}
        </div>
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

      {!account.hasSession && (
        <div className="profile-form__save">
          <button className="btn btn--primary" disabled={account.syncing}
            onClick={() => void account.saveProgress({ name, avatar, lang, defaultTimer })}>
            {account.syncing ? `${t('net.connecting')}…` : `💾 ${t('account.saveProgress')}`}
          </button>
          <p className="setup-hint">{t('account.signInCta')}</p>
        </div>
      )}
      {account.signedIn && account.email && (
        <p className="setup-hint profile-form__email">{account.email}</p>
      )}
    </div>
  );
}
