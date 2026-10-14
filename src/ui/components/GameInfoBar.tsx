import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { GAME_CATALOG, type GameType } from '../../games/catalog';
import GameIcon from './GameIcon';

/** The game's emblem + its display name — the first thing in every game's top bar. */
export function GameTitle({ game }: { game: GameType }) {
  const { t } = useI18n();
  return (
    <span className="game-info__title">
      <GameIcon game={game} size="sm" />
      <span className="game-info__name">{t(GAME_CATALOG[game].titleKey)}</span>
    </span>
  );
}

/**
 * The one-line "what are we playing" strip in every game's top bar: which game, then the
 * game's own facts (round, target, trump, deck…) passed as children. It takes the top
 * bar's flexible slot, so it costs no extra height — on a narrow phone it scrolls
 * sideways inside itself instead of wrapping into a second row.
 */
export default function GameInfoBar({ game, children }: { game: GameType; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="game-info" role="group" aria-label={t(GAME_CATALOG[game].titleKey)}>
      <GameTitle game={game} />
      {children}
    </div>
  );
}

/** A small labelled fact inside {@link GameInfoBar}. */
export function GameInfoChip({ children, title, className = '' }: { children: ReactNode; title?: string; className?: string }) {
  return <span className={`game-info__chip ${className}`.trim()} title={title}>{children}</span>;
}
