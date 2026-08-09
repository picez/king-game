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
  const { state, socialSlot } = useGame();
  if (!state) return null;
  // (38.0.14) The room-social node is rendered IN NORMAL FLOW. On the playing screen it
  // goes into that screen's own safe zone — between the table and the hand — so opening
  // the chat can never cover the cards. The other statuses are short review screens with
  // no hand to protect, so the cluster simply follows the screen in flow. Local play
  // passes no node and renders nothing.
  switch (state.status) {
    case 'playing':        return <GameScreen socialSlot={socialSlot} />;
    case 'trick_complete': return <><TrickCompleteScreen />{socialSlot}</>;
    case 'round_scoring':  return <><RoundScoringScreen />{socialSlot}</>;
    case 'select_trump':   return <><SelectTrumpScreen />{socialSlot}</>;
    case 'kitty_exchange': return <><KittyExchangeScreen />{socialSlot}</>;
    case 'mode_selection': return <><ModeSelectionScreen />{socialSlot}</>;
    case 'game_finished':  return <><GameFinishedScreen />{socialSlot}</>;
  }
}
