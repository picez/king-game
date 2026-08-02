// ---------------------------------------------------------------------------
// Poker action history as a COMPACT control (Stage 38.0.2, §16 I; re-composed in
// Stage 38.0.3). Replaces the old inline log block under the table.
//
//   • Online — the BUTTON goes into `RoomSocial.utilitySlot` and the PANEL into
//     `RoomSocial.utilityPanelSlot`, so in the docked (mobile) toolbar the panel is a
//     normal-flow sibling under the toolbar row and can never sit on the betting
//     controls. Which social surface is open (history / chat / reactions) is owned by
//     the caller, so they are mutually exclusive.
//   • Local — the default export composes button + anchored panel by itself.
//
// Default CLOSED; an unread dot appears when actions arrive while closed and is
// cleared by opening. At most the last 30 entries are listed. Every field shown is
// public (seat name + action + amount) — see `actionLog.ts`.
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

/**
 * Tracks the unread dot: actions that arrived while the panel was closed. Opening the
 * panel is what clears it, so the caller only has to say whether it is open.
 */
export function useLogUnread(total: number, open: boolean): boolean {
  const seenRef = useRef(0);
  useEffect(() => { if (open) seenRef.current = total; }, [open, total]);
  return hasUnreadActions(total, seenRef.current, open);
}

/** The compact toggle. Sits in a social control row (44×44 tap target via `.social-fab`). */
export function PokerActionLogButton(
  { open, unread, onToggle }: { open: boolean; unread: boolean; onToggle: (next: boolean) => void },
) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`social-fab poker-log-fab ${unread ? 'has-unread' : ''}`}
      aria-expanded={open}
      aria-label={t('poker.log.title')}
      title={t('poker.log.title')}
      onClick={() => onToggle(!open)}
    >
      🧾
      {unread && <span className="poker-log-dot" aria-label={t('poker.log.new')} />}
    </button>
  );
}

/** The list itself. `docked` renders it in normal flow (never over the action controls). */
export function PokerActionLogPanel(
  { state, onClose, docked = false }: { state: PokerState; onClose: () => void; docked?: boolean },
) {
  const { t } = useI18n();
  const log = state.actionLog ?? [];
  const rows = recentLogRows(log);
  const base = firstShownIndex(log.length, rows.length);
  return (
    <div className={`poker-log-panel ${docked ? 'poker-log-panel--docked' : ''}`}
      role="dialog" aria-label={t('poker.log.title')}>
      <div className="poker-log-panel__head">
        <span>🧾 {t('poker.log.title')}</span>
        <button type="button" className="btn btn--ghost btn--small"
          onClick={onClose} aria-label={t('btn.back')}>✕</button>
      </div>
      {rows.length === 0
        ? <p className="poker-log__empty">—</p>
        : (
          <ol className="poker-log__list" aria-live="polite">
            {rows.map((e, i) => (
              <li key={base + i} className="poker-log__row">
                <span className="poker-log__name">{state.players[e.seat]?.name ?? `#${e.seat + 1}`}</span>
                <span className="poker-log__act">{t(LOG_KIND_KEY[e.kind])}{e.amount > 0 ? ` ${e.amount}` : ''}</span>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}

interface Props {
  state: PokerState;
  /** `social` rides inside a social control row; `standalone` is the local table's own row. */
  variant?: 'social' | 'standalone';
  /** Optional CONTROLLED open state (the online composition owns it). */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  /** Render the panel in normal flow rather than anchored to the button. */
  docked?: boolean;
}

/** Self-contained button + panel (used by the LOCAL table). */
export default function PokerActionLog({ state, variant = 'social', open: openProp, onToggle, docked = false }: Props) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => { if (onToggle) onToggle(next); else setOwnOpen(next); };
  const unread = useLogUnread((state.actionLog ?? []).length, open);

  return (
    <div className={`poker-logbox poker-logbox--${variant}`}>
      {open && <PokerActionLogPanel state={state} onClose={() => setOpen(false)} docked={docked} />}
      <PokerActionLogButton open={open} unread={unread} onToggle={setOpen} />
    </div>
  );
}
