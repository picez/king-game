import { useCallback, useEffect, useRef, useState } from 'react';
import { debercReducer, getActingDebercPlayerId } from '../../games/deberc/engine';
import { debercBotAction } from '../../games/deberc/ai';
import type { DebercAction, DebercMatchSize, DebercState } from '../../games/deberc/types';
import type { PlayerType } from '../../models/types';
import { localBotNames } from '../../games/botIdentities';
import DebercSetup from './DebercSetup';
import DebercGameScreen, { type DebercNotice } from './DebercGameScreen';
import DebercFinished from './DebercFinished';

const BOT_DELAY_MS = 850;
const ADVANCE_MS = 2000;
const NOTICE_MS = 1400;
/** Seconds the human has to declare melds before an automatic pass (§4, ~15 s). */
const DECLARE_SECONDS = 15;
/** The local human always occupies seat 0; the rest are bots. */
const HUMAN_ID = 'player-0';
const HUMAN_SEAT = 0;

/**
 * Local-only Deberc: one human (seat 0) + bots. Owns the Deberc state via the
 * pure reducer, drives bots in bidding/playing, and AUTO-ADVANCES the two public
 * screens (trick_complete → NEXT_TRICK, hand_scoring → NEXT_HAND) on a timer —
 * these are system-advanced (getActingDebercPlayerId → null), so no seat drives
 * them. Local re-deals use the reducer's default rng (server play uses a seed).
 */
export default function DebercLocalGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<DebercState | null>(null);
  const [notice, setNotice] = useState<DebercNotice | null>(null);
  // Apply an action; if the reducer REJECTS it (returns the SAME ref), React does
  // not re-render and the bot/advance effects — keyed on `state` — never re-run, so
  // the table silently FREEZES. That is the shape of the unreproduced "froze on the
  // 2nd move" report. The engine fuzz (freeze-fuzz.test.ts) shows this never happens
  // for a legal action, so a no-op here means a genuine bug slipped through — surface
  // it in dev instead of leaving a mystery hang.
  const apply = useCallback((action: DebercAction) => setState((s) => {
    const next = debercReducer(s, action);
    if (import.meta.env.DEV && s !== null && next === s) {
      console.warn('[Deberc] reducer rejected an action (no-op — would freeze):', action, s.phase);
    }
    return next;
  }), []);

  // Flash the trick winner when a trick resolves.
  const prevRef = useRef<DebercState | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state) return;
    if (prev.phase === 'playing' && state.phase === 'trick_complete' && state.currentTrick?.winnerSeat != null) {
      setNotice({ kind: 'trick', winner: state.players[state.currentTrick.winnerSeat].name });
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
    }
  }, [state]);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  // Bot auto-play in bidding / declaring / playing when the acting seat is a bot.
  useEffect(() => {
    if (!state || (state.phase !== 'bidding' && state.phase !== 'declaring' && state.phase !== 'playing')) return;
    const actingId = getActingDebercPlayerId(state);
    const actor = state.players.find((p) => p.id === actingId);
    if (!actor || actor.type !== 'ai') return;
    const action = debercBotAction(state); // BID / DECLARE_MELD / PLAY_CARD
    if (!action) return;
    const timer = setTimeout(() => apply(action), BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, apply]);

  // Human declaring turn: a ~15 s countdown that auto-passes if the player does
  // not declare, so the table never stalls (the engine ends declaring seat-by-seat).
  const [declareLeft, setDeclareLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!state || state.phase !== 'declaring' || state.meldTurnSeat !== HUMAN_SEAT) {
      setDeclareLeft(null);
      return;
    }
    setDeclareLeft(DECLARE_SECONDS);
    const tick = setInterval(() => setDeclareLeft((s) => (s == null ? s : Math.max(0, s - 1))), 1000);
    const pass = setTimeout(() => apply({ type: 'DECLARE_MELD', melds: [] }), DECLARE_SECONDS * 1000);
    return () => { clearInterval(tick); clearTimeout(pass); };
  }, [state, apply]);

  // Auto-advance the public screens for everyone (no single actor drives them).
  useEffect(() => {
    if (!state || (state.phase !== 'trick_complete' && state.phase !== 'hand_scoring')) return;
    const action = debercBotAction(state); // NEXT_TRICK / NEXT_HAND
    if (!action) return;
    const timer = setTimeout(() => apply(action), ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [state, apply]);

  function start(matchSize: DebercMatchSize, playerCount: number) {
    const playerNames = ['You', ...localBotNames('deberc', playerCount - 1, ['You'])];
    const playerTypes: PlayerType[] = ['human', ...Array.from({ length: playerCount - 1 }, () => 'ai' as const)];
    setNotice(null);
    apply({ type: 'START_DEBERC', playerNames, playerTypes, matchSize });
  }

  if (!state) return <DebercSetup onStart={start} onExit={onExit} />;
  if (state.phase === 'finished') {
    return <DebercFinished state={state} humanId={HUMAN_ID} onPlayAgain={() => { setNotice(null); setState(null); }} onExit={onExit} />;
  }
  return <DebercGameScreen state={state} humanId={HUMAN_ID} apply={apply} onExit={onExit} notice={notice} declareSecondsLeft={declareLeft} />;
}
