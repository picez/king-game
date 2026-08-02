// ---------------------------------------------------------------------------
// Poker chip wallet card (Stage 38.0.2 — moved OUT of Profile). It now sits in the
// Poker host flow in the start menu, right above the stakes picker, so the daily
// "Get 1,000,000" button is where a player actually needs chips instead of being
// buried in Profile.
//
// Purely presentational: it renders the SHARED `PokerWalletStore` the menu owns, so
// the balance shown here and the buy-in affordability in `PokerStakesPicker` are the
// same value and update together after a claim. The economy is server-authoritative —
// nothing here computes a balance or unlocks a claim.
// ---------------------------------------------------------------------------

import { useI18n } from '../../i18n';
import type { PokerWalletStore } from './usePokerWallet';

export default function PokerWalletCard({ wallet: store }: { wallet: PokerWalletStore }) {
  const { t, lang } = useI18n();
  const fmt = (n: number) => { try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); } };
  const { phase, wallet, justClaimed, claiming } = store;

  return (
    <section className="wallet-card poker-wallet-card" aria-label={t('wallet.title')}>
      <header className="wallet-card__head">
        <span className="wallet-card__chip" aria-hidden="true">🪙</span>
        <div className="wallet-card__titles">
          <h4 className="wallet-card__title">{t('wallet.title')}</h4>
          <p className="wallet-card__sub">{t('wallet.subtitle')}</p>
        </div>
      </header>

      {(phase === 'loading' || phase === 'idle') && <p className="wallet-card__muted">…</p>}

      {phase === 'signed_out' && <p className="wallet-card__muted">{t('wallet.signInRequired')}</p>}

      {/* Only a REAL 503 from the wallet API reaches this state. */}
      {phase === 'no_economy' && <p className="wallet-card__muted">{t('wallet.unavailable')}</p>}

      {phase === 'error' && (
        <div className="wallet-card__row">
          <p className="wallet-card__muted">{t('wallet.error')}</p>
          <button type="button" className="btn btn--small" onClick={store.reload}>{t('wallet.retry')}</button>
        </div>
      )}

      {phase === 'ready' && wallet && (
        <>
          <div className="wallet-card__balance">
            <span className="wallet-card__balance-label">{t('wallet.balance')}</span>
            <span className="wallet-card__balance-value" aria-live="polite">{fmt(wallet.balance)}</span>
          </div>
          {justClaimed && <p className="wallet-card__granted" role="status">{t('wallet.grantedToast')}</p>}
          {wallet.canClaimToday ? (
            <button type="button" className="btn btn--primary wallet-card__claim"
              disabled={claiming} onClick={store.claim}>
              {claiming ? t('wallet.claiming') : t('wallet.claim')}
            </button>
          ) : (
            <p className="wallet-card__muted wallet-card__muted--claimed">
              ✓ {t('wallet.claimedTitle')} · {t('wallet.availableTomorrow')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
