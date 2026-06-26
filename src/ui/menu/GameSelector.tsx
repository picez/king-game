import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { fetchGameCatalog } from '../../net/gamesApi';
import { publicGameCatalog, type GameType, type PublicGameEntry } from '../../games/catalog';

/** Per-game emoji (no icon field in the catalog yet). */
const GAME_ICON: Record<string, string> = { king: '👑', durak: '🃏' };

interface Props {
  /** Currently selected game (default 'king'). */
  selected: GameType;
  onSelect: (id: GameType) => void;
  /** API origin for the catalog fetch; on any failure the bundled catalog is used. */
  apiBase?: string;
}

/**
 * Stage 8.3 skeleton: a compact game picker in the start menu. Today the catalog
 * holds only King, so this renders a single "King — available" chip plus a
 * "more games coming soon" note. It is UI-only: the selection does not change the
 * create/join protocol (King is the sole game). The catalog is fetched from
 * `GET /api/games` but always falls back to the bundled static catalog.
 */
export default function GameSelector({ selected, onSelect, apiBase }: Props) {
  const { t } = useI18n();
  const [games, setGames] = useState<PublicGameEntry[]>(() => publicGameCatalog());

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    fetchGameCatalog({ baseUrl: apiBase, signal: ctrl.signal }).then((list) => {
      if (alive && list.length) setGames(list);
    });
    return () => { alive = false; ctrl.abort(); };
  }, [apiBase]);

  return (
    <section className="game-selector" aria-label={t('menu.chooseGame')}>
      <span className="game-selector__label">{t('menu.game')}</span>
      <div className="game-selector__list">
        {games.map((g) => {
          // Selectable when fully available OR an experimental (local-only) preview;
          // 'coming_soon' games stay disabled. Picking an experimental game still
          // leaves Host/Join gated (handled in the StartMenu).
          const selectable = g.status === 'available' || g.status === 'experimental';
          const active = selectable && g.id === selected;
          const badgeKey = g.status === 'available' ? 'menu.gameAvailable'
            : g.status === 'experimental' ? 'menu.localOnly'
            : 'menu.comingSoon';
          return (
            <button
              key={g.id}
              type="button"
              className={`game-chip ${active ? 'game-chip--active' : ''} ${selectable ? '' : 'game-chip--disabled'}`}
              aria-pressed={active}
              disabled={!selectable}
              onClick={selectable ? () => onSelect(g.id) : undefined}
            >
              <span className="game-chip__icon" aria-hidden="true">{GAME_ICON[g.id] ?? '🎴'}</span>
              <span className="game-chip__name">{t(g.title)}</span>
              <span className="game-chip__badge">{t(badgeKey)}</span>
            </button>
          );
        })}
      </div>
      <p className="game-selector__soon">{t('menu.moreGamesSoon')}</p>
    </section>
  );
}
