/**
 * Per-seat FINAL outcome of a finished online match (Stage 38.0.5).
 *
 * The canonical `online_match_participants.outcome` needs one game-agnostic
 * `seat → win | loss | draw` map. Every game already owns a summarizer that
 * resolves its own winners (King's highest total, Durak's non-fools, Deberc's and
 * Tarneeb's winning TEAM, Preferans's sole winner or draw, 51's sole winner), so
 * this module only NORMALISES those existing results — it invents no rule and
 * changes none.
 *
 *   win  — the seat is among the summarizer's winners;
 *   draw — the match ended with NO winner at all (a tie / an explicit draw);
 *   loss — everyone else.
 *
 * Pure and side-effect free. It never looks at membership, so an AI that took a
 * seat over after a permanent leave is scored exactly like the seat it inherited;
 * the CALLER is what drops forfeited seats (they already own a technical loss).
 */

import type { GameType } from '../games/catalog';
import type { AnyGameState } from '../games/anyGame';
import type { GameState } from '../models/types';
import { summarizeFinishedGame, isFinishedGame } from './kingStats';
import { summarizeFinishedDurakGame } from './durakStats';
import { summarizeFinishedDebercGame } from './debercStats';
import { summarizeFinishedTarneebGame } from './tarneebStats';
import { summarizeFinishedPreferansGame } from './preferansStats';
import { summarizeFinishedFiftyOneGame } from './fiftyOneStats';
import type { DurakState } from '../games/durak/types';
import type { DebercState } from '../games/deberc/types';
import type { TarneebState } from '../games/tarneeb/types';
import type { PreferansState } from '../games/preferans/types';
import type { FiftyOneState } from '../games/fiftyOne/types';

export type SeatOutcome = 'win' | 'loss' | 'draw';

/** The single shape every game summarizer already produces for this purpose. */
interface SeatWinFlag { seatIndex: number; isWinner: boolean }

function normalize(players: SeatWinFlag[]): Map<number, SeatOutcome> {
  const out = new Map<number, SeatOutcome>();
  const anyWinner = players.some((p) => p.isWinner);
  for (const p of players) {
    out.set(p.seatIndex, p.isWinner ? 'win' : anyWinner ? 'loss' : 'draw');
  }
  return out;
}

/**
 * Resolve the per-seat outcomes of a FINISHED state, or null when this game type
 * has no summarizer here (Poker — out of scope for Stage 38.0.5) or the state is
 * not actually finished. Never throws: a malformed state yields null so the caller
 * simply records nothing rather than guessing a result.
 */
export function seatOutcomesFor(gameType: GameType, state: AnyGameState): Map<number, SeatOutcome> | null {
  try {
    switch (gameType) {
      case 'king': {
        const s = state as GameState;
        if (!isFinishedGame(s)) return null;
        return normalize(summarizeFinishedGame(s).players);
      }
      case 'durak':
        return normalize(summarizeFinishedDurakGame(state as DurakState).players);
      case 'deberc':
        return normalize(summarizeFinishedDebercGame(state as DebercState).players);
      case 'tarneeb':
        return normalize(summarizeFinishedTarneebGame(state as TarneebState).players);
      case 'preferans':
        return normalize(summarizeFinishedPreferansGame(state as PreferansState).players);
      case 'fifty-one':
        return normalize(summarizeFinishedFiftyOneGame(state as FiftyOneState).players);
      default:
        return null; // poker (and any future game) — not part of this model yet
    }
  } catch {
    return null;
  }
}
