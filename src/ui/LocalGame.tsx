import { useReducer, useRef, useState, useLayoutEffect, useEffect, useMemo } from 'react';
import { GameContext } from '../hooks/useGame';
import { gameReducer, getCurrentPlayer, getActingPlayerId } from '../core/gameEngine';
import { aiChooseCard, aiChooseKittyDiscards, aiChooseTrump, aiChooseMode } from '../core/ai';
import SetupScreen from './SetupScreen';
import GameRouter from './GameRouter';
import PassScreen from './PassScreen';

const AI_DELAY_MS = 900;
// Hold a completed trick on the table long enough to actually read the cards
// (post-playtest fix #2). Mirrors the server's TRICK_ADVANCE_MS default so the
// local and online pacing feel the same.
const TRICK_VIEW_MS = 2000;

/** The human player we must hand the device to before revealing their view. */
type PassInfo = { playerId: string; name: string; seatIndex: number };

/**
 * Local pass-and-play game. Owns the reducer state, drives the AI, and shows a
 * PassScreen before revealing each human's private view. Unchanged by online
 * play — online runs through OnlineGame with its own transport.
 */
export default function LocalGame() {
  const [state, dispatch] = useReducer(gameReducer, null);
  const [passScreen, setPassScreen] = useState<PassInfo | null>(null);

  /**
   * The id of the human player whose private view is currently revealed.
   * While this matches the acting player, no PassScreen is needed.
   * Reset to null on every public screen so the next actor always confirms.
   */
  const revealedPlayerRef = useRef<string | null>(null);

  // ── Centralised pass-and-play handover ──────────────────────────────────
  useLayoutEffect(() => {
    if (state === null) {
      revealedPlayerRef.current = null;
      setPassScreen(null);
      return;
    }

    const actorId = getActingPlayerId(state);

    if (actorId === null) {
      revealedPlayerRef.current = null;
      setPassScreen(null);
      return;
    }

    const actor = state.players.find((p) => p.id === actorId);
    if (!actor) return;

    if (actor.type === 'ai') {
      setPassScreen(null);
      return;
    }

    if (revealedPlayerRef.current !== actorId) {
      setPassScreen({ playerId: actorId, name: actor.name, seatIndex: actor.seatIndex });
    }
  }, [state]);

  // ── AI auto-play ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state || passScreen) return;

    const actorId = getActingPlayerId(state);

    if (state.status === 'playing') {
      const currentPlayer = getCurrentPlayer(state);
      if (currentPlayer.type !== 'ai') return;
      const card = aiChooseCard(state);
      const timer = setTimeout(() => {
        dispatch({ type: 'PLAY_CARD', playerId: currentPlayer.id, card });
      }, AI_DELAY_MS);
      return () => clearTimeout(timer);
    }

    if (state.status === 'trick_complete') {
      // Auto-advance after a short look at the completed trick — no blocking
      // modal. The centralised pass logic then shows a PassScreen for the next
      // human leader, so hand privacy is preserved.
      if (!state.currentTrick?.winnerId) return;
      const timer = setTimeout(() => {
        dispatch({ type: 'NEXT_TRICK' });
      }, TRICK_VIEW_MS);
      return () => clearTimeout(timer);
    }

    if (actorId === null) return;
    const dealer = state.players.find((p) => p.id === actorId);
    if (dealer?.type !== 'ai') return;

    if (state.status === 'mode_selection') {
      const modeId = aiChooseMode(state.dealerModes[dealer.id]);
      const timer = setTimeout(() => dispatch({ type: 'CHOOSE_MODE', modeId }), AI_DELAY_MS);
      return () => clearTimeout(timer);
    }

    if (state.status === 'select_trump') {
      const suit = aiChooseTrump(dealer.hand);
      const timer = setTimeout(() => dispatch({ type: 'SELECT_TRUMP', suit }), AI_DELAY_MS);
      return () => clearTimeout(timer);
    }

    if (state.status === 'kitty_exchange') {
      const discards = aiChooseKittyDiscards(
        dealer.hand,
        state.config.kittySize,
        state.currentRound.mode.id,
      );
      const timer = setTimeout(() => dispatch({ type: 'EXCHANGE_KITTY', discards }), AI_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [state, passScreen]);

  function handlePassReady() {
    if (!passScreen) return;
    revealedPlayerRef.current = passScreen.playerId;
    setPassScreen(null);
  }

  // Memoize so a pass-screen re-render doesn't force every game consumer to
  // re-render; dispatch is stable across renders (useReducer).
  const gameValue = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <GameContext.Provider value={gameValue}>
      {!state ? (
        <SetupScreen />
      ) : passScreen ? (
        <PassScreen name={passScreen.name} seatIndex={passScreen.seatIndex} onReady={handlePassReady} />
      ) : (
        <GameRouter />
      )}
    </GameContext.Provider>
  );
}
