// ---------------------------------------------------------------------------
// Quick-rules help catalog (Stage 22.0). A tiny, PURE structure that says which
// short sections each game's "How to play" sheet shows — the actual text lives in
// the i18n dictionaries under `help.<id>.<section>` (5–6 short lines per game, NOT
// a copy of the full *_RULES.md). No gameplay/engine imports; only the GameType id.
// The sheet (GameHelpModal) resolves labels + content with t().
// ---------------------------------------------------------------------------

import { GAME_TYPES, type GameType } from './catalog';

/** The compact sections a quick-rules sheet can show, in display order. */
export type HelpSection = 'goal' | 'players' | 'deck' | 'turns' | 'scoring' | 'notes';

/** Sections every game MUST cover (notes is optional flavour). */
export const REQUIRED_HELP_SECTIONS: readonly HelpSection[] = ['goal', 'players', 'deck', 'turns', 'scoring'];

export interface GameHelpEntry {
  id: GameType;
  /** Ordered sections this game's sheet renders (each maps to an i18n content key). */
  sections: HelpSection[];
}

const ALL: HelpSection[] = ['goal', 'players', 'deck', 'turns', 'scoring', 'notes'];

/** Every game has a quick-rules entry (all show the full section set). 51 is a
 *  coming_soon game but still ships help content so its sheet works from the
 *  disabled picker option (Stage 30.2). */
export const GAME_HELP: Record<GameType, GameHelpEntry> = {
  king: { id: 'king', sections: ALL },
  durak: { id: 'durak', sections: ALL },
  deberc: { id: 'deberc', sections: ALL },
  tarneeb: { id: 'tarneeb', sections: ALL },
  preferans: { id: 'preferans', sections: ALL },
  'fifty-one': { id: 'fifty-one', sections: ALL },
};

/** i18n key for a section's short label (e.g. "Goal", "Players"). */
export function helpLabelKey(section: HelpSection): string {
  return `help.label.${section}`;
}
/** i18n key for one game's content in a section (e.g. `help.king.goal`). */
export function helpContentKey(id: GameType, section: HelpSection): string {
  return `help.${id}.${section}`;
}

/** The help entry for a game (never null — every GameType has one). */
export function gameHelp(id: GameType): GameHelpEntry {
  return GAME_HELP[id];
}

/** All content keys across every game (for i18n parity checks). */
export function allHelpContentKeys(): string[] {
  return GAME_TYPES.flatMap((id) => GAME_HELP[id].sections.map((s) => helpContentKey(id, s)));
}
