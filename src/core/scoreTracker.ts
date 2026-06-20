import type { GameState, GameModeId, RoundRecord } from '../models/types';
import { seatMarker } from './avatars';

/**
 * Score-tracker model — ONE compact table (KING_RULES.md → Score Tracker).
 *
 * Rows = players; columns = the 9 game slots + Total. Because every dealer plays
 * every game once (Trump split into 1/2/3), a cell can hold several entries —
 * one per dealer who chose that mode — each being THIS row-player's own score in
 * that dealer's round, tagged with the dealer's avatar + seat colour. A "played"
 * dot marks the cell when the ROW player is the one who dealt that game (so you
 * can see which games each player still owes). A legend maps marker → player.
 *
 * Pure: derived from `state.roundHistory` + `state.players`; identical locally,
 * online, and after a server restore. Uses only public scores.
 */

export type TrackerColumnId =
  | 'no_tricks' | 'no_hearts' | 'no_jacks' | 'no_queens'
  | 'king_of_hearts' | 'last_two_tricks'
  | 'trump1' | 'trump2' | 'trump3';

export interface TrackerColumn {
  id: TrackerColumnId;
  labelKey: string;
  trumpNo?: 1 | 2 | 3;
}

export const TRACKER_COLUMNS: TrackerColumn[] = [
  { id: 'no_tricks',       labelKey: 'track.no_tricks' },
  { id: 'no_hearts',       labelKey: 'track.no_hearts' },
  { id: 'no_jacks',        labelKey: 'track.no_jacks' },
  { id: 'no_queens',       labelKey: 'track.no_queens' },
  { id: 'king_of_hearts',  labelKey: 'track.king_of_hearts' },
  { id: 'last_two_tricks', labelKey: 'track.last_two_tricks' },
  { id: 'trump1',          labelKey: 'track.trump', trumpNo: 1 },
  { id: 'trump2',          labelKey: 'track.trump', trumpNo: 2 },
  { id: 'trump3',          labelKey: 'track.trump', trumpNo: 3 },
];

export function columnForRecord(rec: Pick<RoundRecord, 'modeId' | 'trumpOccurrence'>): TrackerColumnId {
  if (rec.modeId === 'trump') {
    const n = Math.min(3, Math.max(1, rec.trumpOccurrence || 1));
    return (`trump${n}`) as TrackerColumnId;
  }
  return rec.modeId as TrackerColumnId;
}

export interface TrackerEntry {
  dealerId: string;
  /** Semantic marker id (①..④) — kept for stable identity; UI shows avatar+colour. */
  dealerMarker: string;
  /** Dealer's seat index → drives the player colour (see avatars.seatColor). */
  dealerSeat: number;
  dealerAvatar?: string;
  dealerName: string;
  score: number;
  roundNumber: number;
}

export interface TrackerCell {
  column: TrackerColumnId;
  /** This row-player's score in each dealer's round of this mode (marker-tagged). */
  entries: TrackerEntry[];
  /** True if THIS row's player has dealt this game (small dot). */
  playedByRow: boolean;
  /** True if any entry is from the most recent round (highlight). */
  isLast: boolean;
}

export interface TrackerRow {
  playerId: string;
  name: string;
  avatar?: string;
  marker: string;
  /** Seat index → drives the player colour (see avatars.seatColor). */
  seat: number;
  cells: TrackerCell[]; // aligned to TRACKER_COLUMNS (9)
  total: number;
}

export interface LegendEntry {
  playerId: string;
  name: string;
  avatar?: string;
  marker: string;
  /** Seat index → drives the player colour (see avatars.seatColor). */
  seat: number;
}

export interface ScoreTrackerModel {
  legend: LegendEntry[];
  rows: TrackerRow[];
  columns: TrackerColumn[];
  lastRoundNumber: number | null;
}

export function buildScoreTracker(state: GameState): ScoreTrackerModel {
  const history: RoundRecord[] = state.roundHistory ?? [];
  const lastRoundNumber = history.length ? history[history.length - 1].roundNumber : null;

  // Stable marker + seat (colour) per player by seat order.
  const markerOf = new Map<string, string>();
  const seatOf = new Map<string, number>();
  state.players.forEach((p, i) => { markerOf.set(p.id, seatMarker(i)); seatOf.set(p.id, i); });
  const nameOf = new Map(state.players.map((p) => [p.id, p.name]));
  const avatarOf = new Map(state.players.map((p) => [p.id, p.avatar]));

  const legend: LegendEntry[] = state.players.map((p, i) => ({
    playerId: p.id, name: p.name, avatar: p.avatar, marker: markerOf.get(p.id)!, seat: i,
  }));

  // Index rounds by column.
  const byColumn = new Map<TrackerColumnId, RoundRecord[]>();
  for (const r of history) {
    const col = columnForRecord(r);
    (byColumn.get(col) ?? byColumn.set(col, []).get(col)!).push(r);
  }

  const rows: TrackerRow[] = state.players.map((p) => {
    const cells: TrackerCell[] = TRACKER_COLUMNS.map((c) => {
      const recs = byColumn.get(c.id) ?? [];
      const entries: TrackerEntry[] = recs
        .map((r) => ({
          dealerId: r.dealerId,
          dealerMarker: markerOf.get(r.dealerId) ?? '?',
          dealerSeat: seatOf.get(r.dealerId) ?? -1,
          dealerAvatar: avatarOf.get(r.dealerId),
          dealerName: nameOf.get(r.dealerId) ?? '—',
          score: r.scoreByPlayer[p.id] ?? 0,
          roundNumber: r.roundNumber,
        }))
        // Stable order by dealer seat (marker).
        .sort((a, b) => a.dealerMarker.localeCompare(b.dealerMarker));
      const playedByRow = recs.some((r) => r.dealerId === p.id);
      const isLast = recs.some((r) => r.roundNumber === lastRoundNumber);
      return { column: c.id, entries, playedByRow, isLast };
    });
    const total = history.reduce((s, r) => s + (r.scoreByPlayer[p.id] ?? 0), 0);
    return { playerId: p.id, name: p.name, avatar: p.avatar, marker: markerOf.get(p.id)!, seat: seatOf.get(p.id)!, cells, total };
  });

  return { legend, rows, columns: TRACKER_COLUMNS, lastRoundNumber };
}

/** Mode ids in column order (non-trump first). */
export const TRACKER_MODE_ORDER: GameModeId[] = [
  'no_tricks', 'no_hearts', 'no_jacks', 'no_queens', 'king_of_hearts', 'last_two_tricks', 'trump',
];
