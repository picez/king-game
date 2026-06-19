import { useGame } from '../hooks/useGame';
import GameScreen from './GameScreen';
import SelectTrumpScreen from './SelectTrumpScreen';
import KittyExchangeScreen from './KittyExchangeScreen';
import TrickCompleteScreen from './TrickCompleteScreen';
import RoundScoringScreen from './RoundScoringScreen';
import GameFinishedScreen from './GameFinishedScreen';
import ModeSelectionScreen from './ModeSelectionScreen';

/**
 * Maps the current game status to its screen. Shared by local pass-and-play
 * and online play so the screens never need to know which transport is active
 * — they only read `state` and call `dispatch` from GameContext.
 */
export default function GameRouter() {
  const { state } = useGame();
  if (!state) return null;
  switch (state.status) {
    case 'playing':        return <GameScreen />;
    case 'trick_complete': return <TrickCompleteScreen />;
    case 'round_scoring':  return <RoundScoringScreen />;
    case 'select_trump':   return <SelectTrumpScreen />;
    case 'kitty_exchange': return <KittyExchangeScreen />;
    case 'mode_selection': return <ModeSelectionScreen />;
    case 'game_finished':  return <GameFinishedScreen />;
  }
}
