import { useState } from 'react';
import type { GameType } from '../../games/catalog';
import { gameIconSrc } from '../../visual/visualAssets';

/**
 * Emoji fallback per game (Stage 12.3). These were the pre-redesign glyphs; they
 * still stand in if a PNG emblem 404s, so the UI never shows a broken image.
 */
export const GAME_EMOJI: Record<GameType, string> = {
  king: '👑', durak: '🃏', deberc: '🎴', tarneeb: '♠️',
};

interface Props {
  game: GameType;
  /** `sm` for list/table rows (~24px), `md` for pickers/tiles (~44px). */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A game's emblem in a small circular "coin" frame. Renders the transparent PNG
 * from {@link gameIconSrc}; if it fails to load, it swaps to the emoji glyph in
 * the same frame (graceful fallback — Stage 12.3). Always decorative
 * (`aria-hidden`): the surrounding label carries the accessible name.
 */
export default function GameIcon({ game, size = 'sm', className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const cls = `game-icon game-icon--${size} ${className}`.trim();

  if (failed) {
    return (
      <span className={`${cls} game-icon--emoji`} aria-hidden="true">
        {GAME_EMOJI[game]}
      </span>
    );
  }
  return (
    <img
      className={cls}
      src={gameIconSrc(game)}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
