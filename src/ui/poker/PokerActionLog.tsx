// ---------------------------------------------------------------------------
// Poker action history as a COMPACT control (Stage 38.0.2, §16 I). Replaces the
// old inline log block under the table.
//
//   • Online — handed to `RoomSocial`'s generic `utilitySlot`, so the button sits
//     inside the bottom-right control cluster next to timer/voice/emoji/chat.
//     RoomSocial stays poker-agnostic: it renders whatever node it is given.
//   • Local — there is no RoomSocial, so `PokerLocalGame` places this same
//     component in a matching bottom-end cluster.
//
// Default CLOSED; an unread dot appears when actions arrive while closed and is
// cleared by opening. At most the last 30 entries are listed. Every field shown
// is public (seat name + action + amount) — see `actionLog.ts`.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { PokerActionKind, PokerState } from '../../games/poker/types';
import { recentLogRows, firstShownIndex, hasUnreadActions } from './actionLog';

/** i18n label per action-log kind (reuses the action labels; blind/raise are log-only). */
const LOG_KIND_KEY: Record<PokerActionKind, string> = {
  blind: 'poker.log.blind', fold: 'poker.fold', check: 'poker.check', call: 'poker.call',
  bet: 'poker.bet', raise: 'poker.log.raise', allin: 'poker.allIn',
};

interface Props {
  state: PokerState;
  /** `social` rides inside RoomSocial's cluster (online); `standalone` is the local table's own cluster. */
  variant?: 'social' | 'standalone';
}

export default function PokerActionLog({ state, variant = 'social' }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const log = state.actionLog ?? [];
  const seenRef = useRef(0);
  const unread = hasUnreadActions(log.length, seenRef.current, open);
  useEffect(() => { if (open) seenRef.current = log.length; }, [open, log.length]);

  const rows = recentLogRows(log);
  const base = firstShownIndex(log.length, rows.length);

  return (
    <div className={`poker-logbox poker-logbox--${variant}`}>
      {open && (
        <div className="poker-log-panel" role="dialog" aria-label={t('poker.log.title')}>
          <div className="poker-log-panel__head">
            <span>🧾 {t('poker.log.title')}</span>
            <button type="button" className="btn btn--ghost btn--small"
              onClick={() => setOpen(false)} aria-label={t('btn.back')}>✕</button>
          </div>
          {rows.length === 0
            ? <p className="poker-log__empty">—</p>
            : (
              <ol className="poker-log__list">
                {rows.map((e, i) => (
                  <li key={base + i} className="poker-log__row">
                    <span className="poker-log__name">{state.players[e.seat]?.name ?? `#${e.seat + 1}`}</span>
                    <span className="poker-log__act">{t(LOG_KIND_KEY[e.kind])}{e.amount > 0 ? ` ${e.amount}` : ''}</span>
                  </li>
                ))}
              </ol>
            )}
        </div>
      )}
      <button
        type="button"
        className={`social-fab poker-log-fab ${unread ? 'has-unread' : ''}`}
        aria-expanded={open}
        aria-label={t('poker.log.title')}
        title={t('poker.log.title')}
        onClick={() => setOpen((o) => !o)}
      >
        🧾
        {unread && <span className="poker-log-dot" aria-label={t('poker.log.new')} />}
      </button>
    </div>
  );
}
