// ---------------------------------------------------------------------------
// Tarneeb ranked score table (Stage 29.7) — PURE, unit-testable.
//
// Builds the rows for the in-game standings table: one row per SEAT (solo) or per
// TEAM (pairs), carrying the running match score, this-hand trick count, and the
// bid/declarer marker. Rows are sorted by total score DESCENDING with a stable
// tie-break (seat/team order) so the table never jitters — the score only changes at
// hand end, so there is no mid-trick reordering.
//
// It NEVER recomputes scoring: score/tricks come straight from the reducer's public
// ledgers (`scoresBySeat`/`tricksBySeat` for solo, `scoresByTeam`/`tricksByTeam` for
// pairs). No hidden hand data is read. i18n/names stay in the component.
// ---------------------------------------------------------------------------

import type { TarneebState, Team } from '../../games/tarneeb/types';
import { teamOfSeat } from '../../games/tarneeb/rules';

export interface TarneebRankRow {
  /** Stable React key: 'seat-<n>' (solo) or 'team-<A|B>' (pairs). */
  key: string;
  /** Solo: the seat index. Pairs: null (a team row). */
  seat: number | null;
  /** Pairs: the team. Solo: null. */
  team: Team | null;
  /** Cumulative match score — read from the reducer ledger, never recomputed. */
  score: number;
  /** Tricks won THIS hand — read from the reducer ledger. */
  tricks: number;
  /** This row is the local viewer's seat (solo) or team (pairs). */
  isMe: boolean;
  /** The acting seat sits in this row right now (always false while blocked). */
  isTurn: boolean;
  /** This row holds the declarer / current highest bidder. */
  isBidder: boolean;
  /** The contract / current highest-bid amount (null before any bid); shown on the bidder row. */
  bidAmount: number | null;
  /** Shares the top score AND the top score is > 0 (so a 0–0 start marks no leader). */
  isLeader: boolean;
}

/**
 * The ranked standings rows for the current Tarneeb hand, sorted by total score desc.
 * `actingSeat` is the seat to act now (from `getActingTarneebSeat`); `blocked` suppresses
 * the turn highlight during a trick review / hand_complete.
 */
export function tarneebRankRows(
  state: TarneebState,
  humanSeat: number,
  actingSeat: number | null,
  blocked: boolean,
): TarneebRankRow[] {
  const solo = state.variant === 'solo';
  // Bidder marker: the declarer once the auction resolves, else the current highest bidder.
  // The amount is always the standing high bid (which becomes the contract).
  const bidSeat = state.declarerSeat ?? state.highestBid?.seat ?? null;
  const bidAmount = state.highestBid?.amount ?? null;
  const turnSeat = blocked ? null : actingSeat;

  let rows: TarneebRankRow[];
  if (solo) {
    const scores = state.scoresBySeat ?? [0, 0, 0, 0];
    const tricks = state.tricksBySeat ?? [0, 0, 0, 0];
    rows = state.players.map((p) => {
      const seat = p.seatIndex;
      const bidder = seat === bidSeat;
      return {
        key: `seat-${seat}`,
        seat,
        team: null,
        score: scores[seat] ?? 0,
        tricks: tricks[seat] ?? 0,
        isMe: seat === humanSeat,
        isTurn: seat === turnSeat,
        isBidder: bidder,
        bidAmount: bidder ? bidAmount : null,
        isLeader: false,
      };
    });
  } else {
    const myTeam = teamOfSeat(humanSeat);
    const bidTeam = state.declarerTeam ?? (state.highestBid ? teamOfSeat(state.highestBid.seat) : null);
    const turnTeam = turnSeat != null ? teamOfSeat(turnSeat) : null;
    rows = (['A', 'B'] as Team[]).map((team) => {
      const bidder = team === bidTeam;
      return {
        key: `team-${team}`,
        seat: null,
        team,
        score: state.scoresByTeam[team] ?? 0,
        tricks: state.tricksByTeam[team] ?? 0,
        isMe: team === myTeam,
        isTurn: team === turnTeam,
        isBidder: bidder,
        bidAmount: bidder ? bidAmount : null,
        isLeader: false,
      };
    });
  }

  // Sort by score DESC; stable tie-break by seat / team order (A before B).
  const order = (r: TarneebRankRow) => (r.seat ?? (r.team === 'A' ? 0 : 1));
  rows.sort((a, b) => (b.score - a.score) || (order(a) - order(b)));

  const top = rows.length ? rows[0].score : 0;
  for (const r of rows) r.isLeader = top > 0 && r.score === top;
  return rows;
}
