// ---------------------------------------------------------------------------
// Winner celebration (Stage 13.7) — a short, premium finish-screen flourish.
//
// PURE, decorative UI: it decides NOTHING about rules/state, only reacts to a
// `kind` handed down by each game's finished screen. It renders a gold radial
// shimmer + a soft frame glow + a few card-spark glints for the WINNER / winning
// team; draw / fool / loss get NO winner-only effects (a calm state — the screen
// keeps its own neutral title/emoji). Everything is CSS-only (see winner.css):
// pointer-events:none decorative layers, a ~1.5s one-shot intro that settles to a
// static hold (no infinite loops), and it respects the animation-intensity store
// via `<html data-motion-effective>` (reduced = opacity-only, off = static state).
//
// Winner NAMES / TEAM labels / scores are already rendered by the host screens, so
// this layer never duplicates that text — it is purely the visual celebration.
// (Stage 15.4 removed the finish SOUND that briefly lived here — sound is now
// alert-only, not a decorative finish flourish. See src/audio/useSoundAlerts.ts.)
// ---------------------------------------------------------------------------

/** Result kinds a finished screen can hand down (viewer-centric where relevant). */
export type CelebrationKind = 'win' | 'teamWin' | 'draw' | 'fool' | 'loss';

/** Only an outright winner / winning team triggers the gold celebration. */
export function isCelebratoryKind(kind: CelebrationKind): boolean {
  return kind === 'win' || kind === 'teamWin';
}

interface Props {
  /** The result from the (viewer's) perspective. */
  kind: CelebrationKind;
  /** Mount the effect (default true). Draw/fool/loss render nothing regardless. */
  visible?: boolean;
}

export default function WinnerCelebration({ kind, visible = true }: Props) {
  if (!visible || !isCelebratoryKind(kind)) return null;
  return (
    <div className={`winner-celebration winner-celebration--${kind}`} aria-hidden="true">
      <span className="winner-celebration__shimmer" />
      <span className="winner-celebration__glow" />
      <span className="winner-celebration__glint winner-celebration__glint--1">✦</span>
      <span className="winner-celebration__glint winner-celebration__glint--2">✦</span>
      <span className="winner-celebration__glint winner-celebration__glint--3">✧</span>
      <span className="winner-celebration__glint winner-celebration__glint--4">✧</span>
    </div>
  );
}
