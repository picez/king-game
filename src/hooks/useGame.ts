import { createContext, useContext } from 'react';
import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import type { RematchUi } from '../ui/online/RematchControls';
import type { ClientTimer } from './useNetworkGame';

interface GameContextType {
  state: GameState | null;
  dispatch: (action: GameAction) => void;
  /**
   * True when the screens are driven by the online (server-authoritative)
   * flow. Screens use it to hide pass-and-play-only controls (e.g. the
   * "Pass device" / "Next round" / "Play again" buttons) that the server
   * advances automatically online.
   */
  online?: boolean;
  /** Online only: leave the room and return to the start menu. */
  onExit?: () => void;
  /** Online only: per-turn timer in seconds (0/undefined = off). */
  turnTimerSec?: number;
  /** Online only (Stage 37.5): the authoritative turn-timer deadline/identity, or null. */
  timer?: ClientTimer | null;
  /** Online only: this client's player id (used to detect "it's my turn"). */
  myPlayerId?: string | null;
  /** Online only: seat indices of human players currently disconnected. */
  disconnectedSeats?: number[];
  /**
   * Online only (Stage 17.3): seat index → a seated member's SAME-ORIGIN uploaded
   * avatar URL. Built from the room snapshot; seats render the image (with an emoji
   * fallback) for members present here. Absent seats / offline flow → emoji.
   */
  seatAvatarImages?: Record<number, string>;
  /** Online only (Stage 25.9): rematch controls for the King finish screen. */
  rematch?: RematchUi | null;
}

export const GameContext = createContext<GameContextType>({
  state: null,
  dispatch: () => {},
});

export function useGame(): GameContextType {
  return useContext(GameContext);
}
