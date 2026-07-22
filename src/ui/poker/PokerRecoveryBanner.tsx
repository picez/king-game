// ---------------------------------------------------------------------------
// Poker recovery banner (Stage 37.7.5). Shows the PUBLIC recovery status from the room
// snapshot — `cancelled` (the previous match was cancelled and buy-ins were refunded; a
// new match can be started) or `frozen` (the economy needs recovery; play is temporarily
// unavailable). NEVER shows a userId/matchId/escrow or any private economy field. Omitted
// once a fresh match starts (the server clears the snapshot flag). EN/UK/DE/AR; the text
// wraps so it never overflows on 360/390 or under Arabic RTL.
// ---------------------------------------------------------------------------

import { useI18n } from '../../i18n';

export default function PokerRecoveryBanner({ status }: { status?: 'cancelled' | 'frozen' }) {
  const { t } = useI18n();
  if (status !== 'cancelled' && status !== 'frozen') return null;
  return (
    <p className={`poker-recovery-banner poker-recovery-banner--${status}`} role="status">
      {status === 'cancelled' ? '♻️' : '⏸️'} {t(status === 'cancelled' ? 'poker.recovery.cancelled' : 'poker.recovery.frozen')}
    </p>
  );
}
