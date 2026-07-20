// ---------------------------------------------------------------------------
// Tutorial framework — pure data model (Stage 31.1). Scripted, deterministic
// tutorials for each game: a list of steps, each holding a static SCENE snapshot
// (seats, table cards, melds, hand) + short captions (i18n keys) + highlights.
//
// PURE DATA ONLY. No engine/reducer/server/db/net imports — a tutorial never runs
// a real game (see TUTORIALS_PLAN.md, Option 1 = scripted snapshots). Only the
// GameType id and the Rank/Suit primitives are referenced. The renderer
// (src/ui/tutorials/*) turns a scene into presentational CardViews.
// ---------------------------------------------------------------------------

import type { GameType } from '../games/catalog';
import type { Rank, Suit } from '../models/types';

/** One tutorial per game — the catalog key IS the GameType. */
export type TutorialId = GameType;

/**
 * A single face to render in a scene. Exactly one visual kind:
 *  - a normal card (`suit` + `rank`);
 *  - a joker (`joker: true`), optionally showing what it represents;
 *  - a face-down back (`back: true`).
 * `id` is a stable slot id so a step's highlight can target it.
 */
export interface TutorialCardFace {
  id: string;
  suit?: Suit;
  rank?: Rank;
  joker?: boolean;
  /** For a joker laid in a meld: the card it stands in for (shown as a chip). */
  represents?: { suit: Suit; rank: Rank };
  back?: boolean;
}

/** A seat around the felt (opponent or the learner). Names/roles are i18n keys. */
export interface TutorialSeat {
  id: string;
  pos: 'top' | 'left' | 'right' | 'bottom';
  nameKey: string;
  /** Face-down count shown for an opponent. */
  handCount?: number;
  /** Optional role label (e.g. attacker/defender) — an i18n key. */
  roleKey?: string;
  isMe?: boolean;
}

/** A laid meld (51) — a row of faces. */
export interface TutorialMeld {
  id: string;
  cards: TutorialCardFace[];
}

/** A Durak attack/defense pair on the table. */
export interface TutorialPair {
  id: string;
  attack: TutorialCardFace;
  defense?: TutorialCardFace;
  /** True once the defense beats the attack (for the "defended" visual). */
  beaten?: boolean;
}

/** A small info chip (score, elimination target, a note). `text` is literal
 *  (symbols/numbers, language-neutral); prose lives in the step captions. */
export interface TutorialChip {
  id: string;
  text: string;
  tone?: 'default' | 'good' | 'bad' | 'gold';
}

/** A deterministic snapshot the renderer draws. No rng, no reducer. */
export interface TutorialScene {
  /** Which generic board arrangement to render. */
  layout: 'trick' | 'meld' | 'hand-only';
  /** Shows a trump badge when set (Durak). */
  trump?: Suit;
  seats?: TutorialSeat[];
  /** Durak: attack/defense pairs on the table. */
  pairs?: TutorialPair[];
  /** 51: public melds on the table. */
  melds?: TutorialMeld[];
  /** Top of the discard pile (51 / Durak). */
  discardTop?: TutorialCardFace;
  /** Draw-pile size chip. */
  drawCount?: number;
  /** Score / elimination / info chips. */
  chips?: TutorialChip[];
  /** The learner's own hand (real faces). */
  hand?: TutorialCardFace[];
}

/**
 * A thing a step points at — a flat id that matches a card-face `id`, a meld
 * `id`, a pair `id`, a seat `id`, or a reserved zone id (`zone.trump`,
 * `zone.discard`, `zone.draw`). The renderer rings/glows the matching element.
 */
export interface TutorialHighlight {
  targetId: string;
  pulse?: boolean;
}

export interface TutorialStep {
  id: string;
  titleKey: string;
  bodyKey: string;
  scene: TutorialScene;
  highlight?: TutorialHighlight[];
  /** Optional "tap the glowing card" hint — an i18n key. Cosmetic only. */
  actionHintKey?: string;
  /** Pacing estimate; the catalog sums these to enforce the ≤120 s budget. */
  estimatedSeconds?: number;
}

export interface Tutorial {
  id: TutorialId;
  /** Enabled = a full scripted tutorial; false = a "coming next" hub placeholder. */
  enabled: boolean;
  /** The hub one-liner ("what you'll learn") — an i18n key. */
  learnKey: string;
  steps: TutorialStep[];
}

export type TutorialCatalog = Record<GameType, Tutorial>;

/** Default per-step seconds when a step omits its own estimate. */
export const DEFAULT_STEP_SECONDS = 16;
