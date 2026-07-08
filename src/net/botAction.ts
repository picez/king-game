// ---------------------------------------------------------------------------
// botAction — the AI's chosen GameAction for the current state (Stage 8.5).
//
// Moved verbatim out of serverCore.ts so the King GameDefinition can reference it
// WITHOUT creating an import cycle (serverCore → registry → king/definition →
// serverCore). Pure: reads the unredacted server state (the server legally sees
// every hand) and returns a legal action via the shared core heuristics, or null
// on screens a bot does not drive. No logic changed.
// ---------------------------------------------------------------------------

import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import { getCurrentPlayer } from '../core/gameEngine';
import { aiChooseMode, aiChooseTrump, aiChooseKittyDiscards } from '../core/ai';
import { aiChooseCardLookahead } from '../core/lookahead';

export function botAction(state: GameState): GameAction | null {
  switch (state.status) {
    case 'mode_selection': {
      const dealer = state.players[state.dealerIndex];
      return { type: 'CHOOSE_MODE', modeId: aiChooseMode(state.dealerModes[dealer.id]) };
    }
    case 'select_trump': {
      const dealer = state.players[state.dealerIndex];
      return { type: 'SELECT_TRUMP', suit: aiChooseTrump(dealer.hand) };
    }
    case 'kitty_exchange': {
      const dealer = state.players[state.dealerIndex];
      return {
        type: 'EXCHANGE_KITTY',
        discards: aiChooseKittyDiscards(dealer.hand, state.config.kittySize, state.currentRound.mode.id),
      };
    }
    case 'playing': {
      const p = getCurrentPlayer(state);
      // Endgame lookahead when the position is small enough to solve exactly;
      // otherwise this falls back to the shipped greedy heuristic internally.
      return { type: 'PLAY_CARD', playerId: p.id, card: aiChooseCardLookahead(state) };
    }
    default:
      return null;
  }
}
