import type { GameState, GameModeId, RoundRecord } from '../models/types';

/**
 * Score-tracker model (KING_RULES.md → Score Tracker).
 *
 * The board is grouped PER DEALER: each dealer has a section with the 9 columns
 * of their personal game set (6 negatives + Trump 1/2/3). Within a section the
 * rows are ALL players and each cell holds that player's own score in the round
 * where this dealer chose that mode — so every player's score for a round is
 * recorded, not just the dealer's. A grand-total per player (sum across every
 * round) is provided separately.
 *
 * Pure: derived entirely from `state.roundHistory` + `state.players`, so it is
 * identical locally and online and after a server restore.
 */

export type TrackerColumnId =
  | 'no_tricks' | 'no_hearts' | 'no_jacks' | 'no_queens'
  | 'king_of_hearts' | 'last_two_tricks'
  | 'trump1' | 'trump2' | 'trump3';

export interface TrackerColumn {
  id: TrackerColumnId;
  /** i18n key for the column header. */
  labelKey: string;
  /** 1..3 for the three Trump columns (rendered as "Trump 1/2/3"). */
  trumpNo?: 1 | 2 | 3;
}

/** Column order per KING_RULES.md (Jacks before Queens; Trump 1/2/3 last). */
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

/** Which tracker column a round record belongs to (Trump → trump1/2/3). */
export function columnForRecord(rec: Pick<RoundRecord, 'modeId' | 'trumpOccurrence'>): TrackerColumnId {
  if (rec.modeId === 'trump') {
    const n = Math.min(3, Math.max(1, rec.trumpOccurrence || 1));
    return (`trump${n}`) as TrackerColumnId;
  }
  return rec.modeId as TrackerColumnId;
}

export interface TrackerCell {
  column: TrackerColumnId;
  /** This player's score in that game, or null if the round was not played. */
  score: number | null;
  roundNumber: number | null;
}

export interface TrackerRow {
  playerId: string;
  name: string;
  cells: TrackerCell[]; // aligned to TRACKER_COLUMNS (9)
  /** This player's total within THIS dealer's rounds. */
  subtotal: number;
}

export interface DealerSection {
  dealerId: string;
  dealerName: string;
  rows: TrackerRow[]; // one per player (all players, not just the dealer)
  /** True once this dealer has played at least one round. */
  hasPlayed: boolean;
}

export interface GrandTotal {
  playerId: string;
  name: string;
  /** Sum of this player's score across ALL rounds (== scores[playerId].total). */
  total: number;
}

export interface ScoreTrackerModel {
  sections: DealerSection[];
  grandTotals: GrandTotal[];
  /** Most recent completed round number (for highlighting), or null. */
  lastRoundNumber: number | null;
}

export function buildScoreTracker(state: GameState): ScoreTrackerModel {
  const history: RoundRecord[] = state.roundHistory ?? [];
  const lastRoundNumber = history.length ? history[history.length - 1].roundNumber : null;

  const sections: DealerSection[] = state.players.map((dealer) => {
    const dealerRounds = history.filter((r) => r.dealerId === dealer.id);
    const byColumn = new Map<TrackerColumnId, RoundRecord>();
    for (const r of dealerRounds) byColumn.set(columnForRecord(r), r);

    const rows: TrackerRow[] = state.players.map((p) => {
      const cells: TrackerCell[] = TRACKER_COLUMNS.map((c) => {
        const r = byColumn.get(c.id);
        return r
          ? { column: c.id, score: r.scoreByPlayer[p.id] ?? 0, roundNumber: r.roundNumber }
          : { column: c.id, score: null, roundNumber: null };
      });
      const subtotal = dealerRounds.reduce((s, r) => s + (r.scoreByPlayer[p.id] ?? 0), 0);
      return { playerId: p.id, name: p.name, cells, subtotal };
    });

    return { dealerId: dealer.id, dealerName: dealer.name, rows, hasPlayed: dealerRounds.length > 0 };
  });

  const grandTotals: GrandTotal[] = state.players.map((p) => ({
    playerId: p.id,
    name: p.name,
    total: history.reduce((s, r) => s + (r.scoreByPlayer[p.id] ?? 0), 0),
  }));

  return { sections, grandTotals, lastRoundNumber };
}

/** Mode ids in column order (non-trump first). */
export const TRACKER_MODE_ORDER: GameModeId[] = [
  'no_tricks', 'no_hearts', 'no_jacks', 'no_queens', 'king_of_hearts', 'last_two_tricks', 'trump',
];
