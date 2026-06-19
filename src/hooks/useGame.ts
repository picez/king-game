import { createContext, useContext } from 'react';
import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';

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
}

export const GameContext = createContext<GameContextType>({
  state: null,
  dispatch: () => {},
});

export function useGame(): GameContextType {
  return useContext(GameContext);
}
