// ---------------------------------------------------------------------------
// TutorialBoard (Stage 31.1) — renders a deterministic TutorialScene with the
// shared CardView. Presentational only: no engine/reducer/net/server imports, no
// state, no rng. Highlighted elements (by id) get a ring. Card runs use dir="ltr"
// so a sequence reads low→high even under Arabic RTL (TUTORIALS_PLAN.md §4).
// ---------------------------------------------------------------------------

import { useI18n } from '../../i18n';
import CardView, { SUIT_SYMBOL } from '../components/CardView';
import type { Card, Rank } from '../../models/types';
import type { TutorialCardFace, TutorialScene, TutorialSeat } from '../../tutorials/types';

interface Props {
  scene: TutorialScene;
  /** Element ids to ring. */
  highlightIds: Set<string>;
  pulseIds: Set<string>;
}

/** A face-down placeholder card (CardView renders the ornamental back for rank '?'). */
const BACK: Card = { suit: 'spades', rank: '?' as Rank, value: 0 };

/** A tutorial face as a renderable Card (jokers/backs are handled separately). */
function toCard(face: TutorialCardFace): Card {
  return { suit: face.suit!, rank: face.rank!, value: 0 };
}

export default function TutorialBoard({ scene, highlightIds, pulseIds }: Props) {
  const { t } = useI18n();
  const hl = (id: string) =>
    (highlightIds.has(id) ? ' tutorial-hl' : '') + (pulseIds.has(id) ? ' tutorial-hl--pulse' : '');

  const SceneCard = ({ face }: { face: TutorialCardFace }) => {
    const ringed = hl(face.id);
    if (face.joker) {
      return (
        <span className={`tutorial-card tutorial-card--joker${ringed}`} aria-label={t('tutorial.joker')}>
          <span className="tutorial-joker__glyph" aria-hidden="true">🃏</span>
          {face.represents && (
            <span className="tutorial-joker__rep">
              {face.represents.rank}{SUIT_SYMBOL[face.represents.suit]}
            </span>
          )}
        </span>
      );
    }
    if (face.back) {
      return <span className={`tutorial-card${ringed}`}><CardView card={BACK} size="mini" disabled /></span>;
    }
    return <span className={`tutorial-card${ringed}`}><CardView card={toCard(face)} size="mini" disabled /></span>;
  };

  const opponents = (scene.seats ?? []).filter((s) => !s.isMe);
  const seatChip = (s: TutorialSeat) => (
    <span key={s.id} className={`tutorial-seat${hl(s.id)}`}>
      <span className="tutorial-seat__name">{t(s.nameKey)}</span>
      {s.roleKey && <span className="tutorial-seat__role">{t(s.roleKey)}</span>}
      {typeof s.handCount === 'number' && <span className="tutorial-seat__count">🂠 {s.handCount}</span>}
    </span>
  );

  return (
    <div className="tutorial-board">
      {/* Top row: opponents + trump + draw pile. */}
      <div className="tutorial-board__top">
        <div className="tutorial-seats">{opponents.map(seatChip)}</div>
        <div className="tutorial-topinfo">
          {scene.trump && (
            <span className={`tutorial-trump${hl('zone.trump')}`}>
              {t('tutorial.trump')} <strong>{SUIT_SYMBOL[scene.trump]}</strong>
            </span>
          )}
          {typeof scene.drawCount === 'number' && (
            <span className={`tutorial-pile${hl('zone.draw')}`}>🂠 {scene.drawCount}</span>
          )}
          {scene.discardTop && (
            <span className={`tutorial-pile tutorial-pile--discard${hl('zone.discard')}`}>
              <SceneCard face={scene.discardTop} />
            </span>
          )}
        </div>
      </div>

      {/* Centre: Durak attack/defense pairs, or 51 public melds. */}
      {scene.pairs && scene.pairs.length > 0 && (
        <div className="tutorial-pairs" dir="ltr">
          {scene.pairs.map((p) => (
            <span key={p.id} className={`tutorial-pair${p.beaten ? ' tutorial-pair--beaten' : ''}${hl(p.id)}`}>
              <SceneCard face={p.attack} />
              {p.defense && <span className="tutorial-pair__def"><SceneCard face={p.defense} /></span>}
            </span>
          ))}
        </div>
      )}
      {scene.trick && scene.trick.length > 0 && (
        <div className="tutorial-trick" dir="ltr">
          {scene.trick.map((tc) => (
            <span key={tc.id} className={`tutorial-trickcard${tc.winner ? ' tutorial-trickcard--win' : ''}`}>
              <SceneCard face={tc.card} />
              {tc.lead && <span className="tutorial-trickcard__lead" aria-hidden="true">①</span>}
            </span>
          ))}
        </div>
      )}
      {scene.melds && scene.melds.length > 0 && (
        <div className="tutorial-melds">
          {scene.melds.map((m) => (
            <span key={m.id} className={`tutorial-meld${hl(m.id)}`} dir="ltr">
              {m.cards.map((card) => <SceneCard key={card.id} face={card} />)}
            </span>
          ))}
        </div>
      )}

      {/* Info chips (score / elimination / notes). */}
      {scene.chips && scene.chips.length > 0 && (
        <div className="tutorial-chips">
          {scene.chips.map((chip) => (
            <span key={chip.id} className={`tutorial-chip tutorial-chip--${chip.tone ?? 'default'}${hl(chip.id)}`}>
              {chip.text}
            </span>
          ))}
        </div>
      )}

      {/* The learner's hand. */}
      {scene.hand && scene.hand.length > 0 && (
        <div className="tutorial-hand" dir="ltr">
          {scene.hand.map((card) => <SceneCard key={card.id} face={card} />)}
        </div>
      )}
    </div>
  );
}
