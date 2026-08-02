// ---------------------------------------------------------------------------
// Between-hands REBUY panel (§17, Stage 38.0.3B). Shown while the match is paused in
// `rebuy_window`, UNDER the showdown/fold review so the hand result stays readable.
//
// Presentational only. It never derives an amount, never decides eligibility and never
// talks to a wallet: the caller passes the authoritative amount and which seats this
// viewer may act for.
//   • LOCAL  — every busted seat (human AND bot) is actionable, the rebuy is free, and an
//              explicit Continue closes the window.
//   • ONLINE — only the viewer's OWN seat is actionable, the chips come from their wallet
//              and the server closes the window (deadline shown, never client-decided).
//
// Other players are described by PUBLIC seat/name only — no wallet balance, no user id.
// ---------------------------------------------------------------------------

import { useI18n } from '../../i18n';
import { rebuyWindowOf } from '../../games/poker/rules';
import type { PokerState } from '../../games/poker/types';

interface Props {
  state: PokerState;
  /** Chips one rebuy restores. Local: the chosen starting stack. Online: the table buy-in. */
  amount: number;
  /** Seats this viewer may decide for (local: all eligible; online: own seat only). */
  actionableSeats: readonly number[];
  onRebuy: (seat: number) => void;
  onDecline: (seat: number) => void;
  /** LOCAL only — the explicit control that closes the window. */
  onContinue?: () => void;
  /** ONLINE only — seconds left on the SERVER deadline (already derived by the caller). */
  secondsLeft?: number | null;
  /** ONLINE only — a request is in flight for this seat (disables both buttons). */
  busySeat?: number | null;
  /** ONLINE only — the viewer's wallet balance, shown for their own seat only. */
  walletBalance?: number | null;
  /** ONLINE only — set when the viewer cannot afford the buy-in. */
  insufficient?: boolean;
  /** ONLINE only — a failed request message. */
  failed?: boolean;
}

export default function PokerRebuyPanel({
  state, amount, actionableSeats, onRebuy, onDecline, onContinue,
  secondsLeft = null, busySeat = null, walletBalance = null, insufficient = false, failed = false,
}: Props) {
  const { t, lang } = useI18n();
  const win = rebuyWindowOf(state);
  if (!win) return null;
  const fmt = (n: number) => { try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); } };

  return (
    <section className="poker-rebuy" aria-label={t('poker.rebuy.title')}>
      <header className="poker-rebuy__head">
        <span className="poker-rebuy__title">🪙 {t('poker.rebuy.title')}</span>
        {secondsLeft != null && (
          <span className="poker-rebuy__countdown" aria-live="off">
            ⏳ {t('poker.rebuy.countdown').replace('{n}', String(Math.max(0, secondsLeft)))}
          </span>
        )}
      </header>
      <p className="poker-rebuy__hint">{t('poker.rebuy.hint')}</p>
      {walletBalance != null && (
        <p className="poker-rebuy__balance">{t('poker.rebuy.balance')}: 🪙 {fmt(walletBalance)}</p>
      )}

      <ul className="poker-rebuy__seats">
        {win.eligibleSeats.map((seat) => {
          const decision = win.decisionBySeat[seat] ?? 'pending';
          const mine = actionableSeats.includes(seat);
          const busy = busySeat === seat;
          return (
            <li key={seat} className="poker-rebuy__seat">
              <span className="poker-rebuy__name">{state.players[seat]?.name ?? `#${seat + 1}`}</span>
              {decision === 'rebought' && <span className="poker-rebuy__state">✓ {t('poker.rebuy.bought')}</span>}
              {decision === 'declined' && <span className="poker-rebuy__state">{t('poker.rebuy.declined')}</span>}
              {decision === 'pending' && !mine && (
                <span className="poker-rebuy__state poker-rebuy__state--muted">{t('poker.rebuy.pending')}</span>
              )}
              {decision === 'pending' && mine && (
                <span className="poker-rebuy__actions">
                  <button type="button" className="btn btn--primary btn--small poker-rebuy__add"
                    disabled={busy || insufficient}
                    onClick={() => onRebuy(seat)}>
                    {t('poker.rebuy.add').replace('{amount}', fmt(amount))}
                  </button>
                  <button type="button" className="btn btn--ghost btn--small"
                    disabled={busy}
                    onClick={() => onDecline(seat)}>
                    {t('poker.rebuy.decline')}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {insufficient && <p className="poker-rebuy__warn" role="status">⚠️ {t('poker.rebuy.insufficient')}</p>}
      {failed && <p className="poker-rebuy__warn" role="status">{t('poker.rebuy.failed')}</p>}

      {/* One live region for the whole panel so a screen reader hears each resolution. */}
      <p className="poker-rebuy__status" role="status" aria-live="polite">
        {win.eligibleSeats
          .filter((s) => (win.decisionBySeat[s] ?? 'pending') === 'rebought')
          .map((s) => `${state.players[s]?.name ?? `#${s + 1}`}: ${t('poker.rebuy.bought')}`)
          .join(' · ')}
      </p>

      {onContinue
        ? (
          <button type="button" className="btn btn--primary poker-rebuy__continue" onClick={onContinue}>
            {t('poker.rebuy.continue')}
          </button>
        )
        : <p className="poker-rebuy__waiting">{t('poker.rebuy.waiting')}</p>}
    </section>
  );
}
