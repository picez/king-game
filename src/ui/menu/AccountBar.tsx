import { useEffect } from 'react';
import { useI18n } from '../../i18n';
import type { Account } from '../../hooks/useAccount';
import MyAvatar from '../components/MyAvatar';

interface Props {
  account: Account;
  /** Local nickname + avatar (shown until the server provides its own). */
  name: string;
  avatar: string;
}

/**
 * Top account bar (Stage 7.1): avatar + name on the left, sign-in / sign-out on
 * the right. Login/logout lives HERE — never inside the Profile settings tab.
 * No language selector (that moved to Profile). Degrades to a plain "Guest" view
 * when the API/DB is unreachable.
 */
export default function AccountBar({ account, name, avatar }: Props) {
  const { t } = useI18n();
  const display = account.displayName ?? name ?? t('account.guestShort');

  useEffect(() => {
    if (!account.banner) return;
    const id = setTimeout(account.clearBanner, 4000);
    return () => clearTimeout(id);
  }, [account.banner, account.clearBanner]);

  return (
    <div className="account-bar-wrap">
      <div className="account-bar">
        <div className="account-bar__id">
          <MyAvatar emoji={avatar} imageUrl={account.avatarImageUrl} className="account-bar__avatar" />
          <span className="account-bar__meta">
            <span className="account-bar__name">{display}</span>
            <span className="account-bar__sub">
              {account.loading
                ? t('account.checking')
                : account.signedIn
                  ? <><span className="account-bar__chip">G</span> {t('account.signedInShort')}</>
                  : t('account.guestShort')}
            </span>
          </span>
        </div>

        <div className="account-bar__action">
          {account.signedIn ? (
            <button className="btn btn--ghost btn--small" onClick={() => void account.logout()}>
              {t('account.logout')}
            </button>
          ) : account.authAvailable ? (
            <a className="btn btn--primary btn--small account-bar__signin" href={account.googleUrl}>
              {t('account.signIn')}
            </a>
          ) : !account.loading && !account.serverReachable ? (
            // Server unreachable (network/CORS/wrong URL) → a compact recovery action,
            // never a dead-end. The Profile screen holds the fuller options.
            <button className="btn btn--outline btn--small" onClick={() => account.retry()}>
              ↻ {t('account.retry')}
            </button>
          ) : null}
        </div>
      </div>

      {account.banner && (
        <div className={`account-bar__banner account-bar__banner--${account.banner}`} role="status">
          {account.banner === 'success' ? `✅ ${t('account.loginSuccess')}` : t('account.loginError')}
        </div>
      )}
    </div>
  );
}
