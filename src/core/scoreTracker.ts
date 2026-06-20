import type { GameState, GameModeId, RoundRecord } from '../models/types';

/**
 * Score-tracker table model (KING_RULES.md → Score Tracker).
 *
 * Rows are players; columns are the 9 games of a dealer's personal set plus a
 * Total. A cell `[player p][game g]` holds p's own score in the round where p
 * was the DEALER and the chosen mode was g (Trump split into 1/2/3 by the order
 * that dealer played them). Total is p's overall standing across all rounds.
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
  /** i18n key for the short header label. */
  labelKey: string;
  /** 1..3 for the three Trump columns (used to render "Trump 1/2/3"). */
  trumpNo?: 1 | 2 | 3;
}

/** Column order matches KING_RULES.md (Jacks before Queens; Trump 1/2/3 last). */
export const TRACKER_COLUMNS: TrackerColumn[] = [
  { id: 'no_tricks',       labelKey: 'track.tricks' },
  { id: 'no_hearts',       labelKey: 'track.hearts' },
  { id: 'no_jacks',        labelKey: 'track.jacks' },
  { id: 'no_queens',       labelKey: 'track.queens' },
  { id: 'king_of_hearts',  labelKey: 'track.king' },
  { id: 'last_two_tricks', labelKey: 'track.lastTwo' },
  { id: 'trump1',          labelKey: 'track.trump', trumpNo: 1 },
  { id: 'trump2',          labelKey: 'track.trump', trumpNo: 2 },
  { id: 'trump3',          labelKey: 'track.trump', trumpNo: 3 },
];

export interface TrackerCell {
  column: TrackerColumnId;
  /** Dealer's score in that game, or null if not played yet. */
  score: number | null;
  /** Round number that filled this cell (for highlighting), or null. */
  roundNumber: number | null;
}

export interface TrackerRow {
  playerId: string;
  name: string;
  cells: TrackerCell[]; // aligned to TRACKER_COLUMNS
  /** Player's overall total (sum of their score across ALL rounds). */
  total: number;
}

export interface ScoreTrackerModel {
  rows: TrackerRow[];
  /** The most recent round number (for highlighting), or null if none yet. */
  lastRoundNumber: number | null;
}

/** Which tracker column a round record belongs to (Trump → trump1/2/3). */
export function columnForRecord(rec: Pick<RoundRecord, 'modeId' | 'trumpOccurrence'>): TrackerColumnId {
  if (rec.modeId === 'trump') {
    const n = Math.min(3, Math.max(1, rec.trumpOccurrence || 1));
    return (`trump${n}`) as TrackerColumnId;
  }
  return rec.modeId as TrackerColumnId;
}

export function buildScoreTracker(state: GameState): ScoreTrackerModel {
  const history: RoundRecord[] = state.roundHistory ?? [];
  const lastRoundNumber = history.length ? history[history.length - 1].roundNumber : null;

  const rows: TrackerRow[] = state.players.map((p) => {
    // Cells filled only for rounds this player DEALT.
    const filled = new Map<TrackerColumnId, TrackerCell>();
    let total = 0;
    for (const rec of history) {
      const score = rec.scoreByPlayer[p.id] ?? 0;
      total += score; // overall standing (every round counts)
      if (rec.dealerId === p.id) {
        const col = columnForRecord(rec);
        filled.set(col, { column: col, score, roundNumber: rec.roundNumber });
      }
    }
    const cells = TRACKER_COLUMNS.map(
      (c) => filled.get(c.id) ?? { column: c.id, score: null, roundNumber: null },
    );
    return { playerId: p.id, name: p.name, cells, total };
  });

  return { rows, lastRoundNumber };
}

/** Convenience re-export of the mode ids in column order (non-trump first). */
export const TRACKER_MODE_ORDER: GameModeId[] = [
  'no_tricks', 'no_hearts', 'no_jacks', 'no_queens', 'king_of_hearts', 'last_two_tricks', 'trump',
];
