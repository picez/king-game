// ---------------------------------------------------------------------------
// Poker online bankroll host picker (Stage 37.7 §16 J). Lets the host choose one of
// the 8 approved stakes + a blind-growth interval, and shows their wallet balance, the
// derived 100-BB buy-in, and an insufficient-balance / sign-in-required warning. The
// buy-in is display-only here (the server re-derives it authoritatively). Reports the
// selection + whether the host can afford the buy-in so the create button can gate.
//
// Stage 38.0.2: it no longer fetches the wallet itself. The menu owns ONE shared
// `PokerWalletStore` (see `usePokerWallet`) and passes it here and to the wallet card,
// so a daily claim refreshes the balance AND this affordability check together —
// there is never a second, stale copy of the balance.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { STAKES_PRESETS, BLIND_GROWTH_PRESETS } from '../../games/poker/stakes';
import type { PokerWalletStore } from './usePokerWallet';

export interface PokerStakesSelection {
  smallBlind: number;
  bigBlind: number;
  blindGrowth: number;
  buyIn: number;
  affordable: boolean;
}

interface Props {
  /** The SHARED wallet store owned by the menu (single source of truth). */
  wallet: PokerWalletStore;
  onChange: (sel: PokerStakesSelection) => void;
}

export default function PokerStakesPicker({ wallet: store, onChange }: Props) {
  const { t, lang } = useI18n();
  const [presetIdx, setPresetIdx] = useState(0);
  const [growth, setGrowth] = useState(0);

  const fmt = (n: number) => { try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); } };
  const preset = STAKES_PRESETS[presetIdx];
  const balance = store.phase === 'ready' ? (store.wallet?.balance ?? null) : null;
  const affordable = balance != null && balance >= preset.buyIn;

  // Report the current selection upward whenever it (or affordability) changes.
  const sel = useMemo<PokerStakesSelection>(() => ({
    smallBlind: preset.smallBlind, bigBlind: preset.bigBlind, blindGrowth: growth, buyIn: preset.buyIn, affordable,
  }), [preset, growth, affordable]);
  useEffect(() => { onChange(sel); }, [sel, onChange]);

  return (
    <div className="field poker-stakes">
      <label className="field__label">🪙 {t('poker.stakes.title')}</label>
      <div className="segmented segmented--inline poker-stakes__grid" role="group" aria-label={t('poker.stakes.title')}>
        {STAKES_PRESETS.map((p, i) => (
          <button key={i} type="button"
            className={`segmented__tab ${i === presetIdx ? 'segmented__tab--active' : ''}`}
            aria-pressed={i === presetIdx}
            onClick={() => setPresetIdx(i)}>
            {p.smallBlind}/{p.bigBlind}
          </button>
        ))}
      </div>

      <label className="field__label">📈 {t('poker.stakes.growth')}</label>
      <div className="segmented segmented--inline" role="group" aria-label={t('poker.stakes.growth')}>
        {BLIND_GROWTH_PRESETS.map((g) => (
          <button key={g} type="button"
            className={`segmented__tab ${g === growth ? 'segmented__tab--active' : ''}`}
            aria-pressed={g === growth}
            onClick={() => setGrowth(g)}>
            {g === 0 ? t('poker.stakes.growthOff') : g}
          </button>
        ))}
      </div>

      <p className="poker-stakes__buyin">
        {t('poker.stakes.buyIn')}: <strong>🪙 {fmt(preset.buyIn)}</strong>
        {growth > 0 && <span className="poker-stakes__growth-note"> · {t('poker.stakes.growthEvery').replace('{n}', String(growth))}</span>}
      </p>

      {balance != null && (
        <p className={`poker-stakes__balance ${affordable ? '' : 'is-short'}`}>
          {t('wallet.balance')}: 🪙 {fmt(balance)}
          {!affordable && <span className="poker-stakes__warn"> · ⚠️ {t('poker.stakes.insufficient')}</span>}
        </p>
      )}
      {store.phase === 'signed_out' && <p className="poker-stakes__warn">🔒 {t('wallet.signInRequired')}</p>}
      {/* Only a REAL 503 from the wallet API produces `no_economy`. */}
      {store.phase === 'no_economy' && <p className="poker-stakes__warn">{t('wallet.unavailable')}</p>}
    </div>
  );
}
