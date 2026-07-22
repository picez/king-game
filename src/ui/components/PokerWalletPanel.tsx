// ---------------------------------------------------------------------------
// Poker chip wallet card (Stage 37.7). Shown on the Profile → account screen. Reads
// the server-authoritative balance + daily-claim eligibility and lets a signed-in
// (non-guest) player claim their once-per-UTC-day 1,000,000 chips. The economy is
// server-side — this component never computes a balance or unlocks a claim locally;
// it only reflects what the server returns. Signed-out / guest → a sign-in hint; a
// no-DB server → an "unavailable" note. Self-contained state (no ProfileMenu wiring).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { fetchPokerWallet, claimDailyChips } from '../../net/pokerWalletApi';
import type { PokerWalletView } from '../../net/pokerWallet';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; wallet: PokerWalletView; justClaimed: boolean }
  | { kind: 'signed_out' }
  | { kind: 'no_economy' }
  | { kind: 'error' };

export default function PokerWalletPanel({ base, signedIn }: { base: string; signedIn: boolean }) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [claiming, setClaiming] = useState(false);
  const alive = useRef(true);

  const fmt = useCallback(
    (n: number) => { try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); } },
    [lang],
  );

  const load = useCallback(async () => {
    if (!signedIn) { setPhase({ kind: 'signed_out' }); return; }
    setPhase({ kind: 'loading' });
    const r = await fetchPokerWallet(base);
    if (!alive.current) return;
    if (r.ok) setPhase({ kind: 'ready', wallet: r.wallet, justClaimed: false });
    else setPhase({ kind: r.reason === 'signed_out' ? 'signed_out' : r.reason === 'no_economy' ? 'no_economy' : 'error' });
  }, [base, signedIn]);

  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  const claim = useCallback(async () => {
    setClaiming(true);
    const r = await claimDailyChips(base);
    if (!alive.current) { return; }
    setClaiming(false);
    if (r.ok) setPhase({ kind: 'ready', wallet: r.claim, justClaimed: r.claim.granted });
    else setPhase({ kind: r.reason === 'signed_out' ? 'signed_out' : r.reason === 'no_economy' ? 'no_economy' : 'error' });
  }, [base]);

  return (
    <section className="wallet-card" aria-label={t('wallet.title')}>
      <header className="wallet-card__head">
        <span className="wallet-card__chip" aria-hidden="true">🪙</span>
        <div className="wallet-card__titles">
          <h4 className="wallet-card__title">{t('wallet.title')}</h4>
          <p className="wallet-card__sub">{t('wallet.subtitle')}</p>
        </div>
      </header>

      {phase.kind === 'loading' && <p className="wallet-card__muted">…</p>}

      {phase.kind === 'signed_out' && <p className="wallet-card__muted">{t('wallet.signInRequired')}</p>}

      {phase.kind === 'no_economy' && <p className="wallet-card__muted">{t('wallet.unavailable')}</p>}

      {phase.kind === 'error' && (
        <div className="wallet-card__row">
          <p className="wallet-card__muted">{t('wallet.error')}</p>
          <button type="button" className="btn btn--small" onClick={() => void load()}>{t('wallet.retry')}</button>
        </div>
      )}

      {phase.kind === 'ready' && (
        <>
          <div className="wallet-card__balance">
            <span className="wallet-card__balance-label">{t('wallet.balance')}</span>
            <span className="wallet-card__balance-value" aria-live="polite">{fmt(phase.wallet.balance)}</span>
          </div>
          {phase.justClaimed && <p className="wallet-card__granted" role="status">{t('wallet.grantedToast')}</p>}
          {phase.wallet.canClaimToday ? (
            <button type="button" className="btn btn--primary wallet-card__claim"
              disabled={claiming} onClick={() => void claim()}>
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
