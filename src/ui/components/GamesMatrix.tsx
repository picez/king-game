import { useI18n } from '../../i18n';
import type { GameState } from '../../models/types';
import { gamesMatrix } from '../../core/games';

interface Props {
  state: GameState;
  /** Which player to highlight as the current dealer (defaults to state's dealer). */
  dealerId?: string;
}

/**
 * Per-player "games" progress board: one row per player, a chip per game mode
 * showing played/total (Trump 0/3 … 3/3, others 0/1 → 1/1 ✓). Chips wrap, so it
 * never overflows horizontally on a phone. Uses only public per-dealer counts —
 * no hands or collected cards. Works for 3- and 4-player tables.
 */
export default function GamesMatrix({ state, dealerId }: Props) {
  const { t } = useI18n();
  const rows = gamesMatrix(state, { dealerId });

  return (
    <div className="games-matrix">
      {rows.map((r) => (
        <div key={r.playerId} className={`games-matrix__row ${r.isDealer ? 'games-matrix__row--dealer' : ''}`}>
          <div className="games-matrix__name">
            {r.isDealer && <span className="dealer-crown" title="Dealer">👑</span>}
            {r.name}
          </div>
          <div className="games-matrix__chips">
            {r.cells.map((c) => (
              <span key={c.modeId} className={`game-chip ${c.done ? 'game-chip--done' : ''}`}>
                {t(`mode.${c.modeId}`)} {c.played}/{c.total}{c.done ? ' ✓' : ''}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
