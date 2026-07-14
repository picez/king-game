import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import CardView, { SUIT_SYMBOL } from '../components/CardView';
import GameHelpModal from '../components/GameHelpModal';
import type { Card, Rank, Suit } from '../../models/types';
import type { FiftyOneAction, FiftyOneCard, FiftyOneMeld, FiftyOneState } from '../../games/fiftyOne/types';
import { resolveMeld } from '../../games/fiftyOne/melds';
import { OPENING_MINIMUM } from '../../games/fiftyOne/rules';
import HandOrderControls from '../components/HandOrderControls';
import { useManualHandOrder } from '../../hooks/useManualHandOrder';

/** 51 cards carry a real unique id (two decks + jokers), so use it directly. */
const fiftyOneCardId = (c: FiftyOneCard): string => c.id;

interface Props {
  state: FiftyOneState;
  humanSeat: number;
  apply: (a: FiftyOneAction) => void;
  onExit: () => void;
  /**
   * Online mode (Stage 30.5): actions go to the server via `apply` (ACTION_REQUEST)
   * and the between-rounds advance is SERVER-driven (seeded START_NEXT_ROUND via
   * autoAdvance), so the round-over overlay shows a waiting note instead of a
   * "Next round" button — the client never dispatches START_NEXT_ROUND (it would be
   * rejected as NOT_YOUR_TURN). Local play (default) keeps the manual button.
   */
  online?: boolean;
}

const RUN_POS: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/** A normal 51 card → the platform Card the shared CardView renders (value unused). */
function toCard(c: FiftyOneCard): Card {
  return { suit: c.suit as Suit, rank: c.rank as Rank, value: 0 };
}

/** Sort a hand by suit then rank; jokers last. Pure display helper. */
function sortHand(cards: FiftyOneCard[]): FiftyOneCard[] {
  const suitOrder: Record<string, number> = { spades: 0, clubs: 1, diamonds: 2, hearts: 3 };
  return cards.slice().sort((a, b) => {
    if (a.joker !== b.joker) return a.joker ? 1 : -1;
    if (a.joker) return 0;
    if (a.suit !== b.suit) return suitOrder[a.suit as string] - suitOrder[b.suit as string];
    return RUN_POS[a.rank as Rank] - RUN_POS[b.rank as Rank];
  });
}

/** A joker tile (in hand / discard). Wild — shows a 🃏 face; clickable like a card. */
function JokerCard({ onClick, selected, disabled, size = 'hand' }: {
  onClick?: () => void; selected?: boolean; disabled?: boolean; size?: 'hand' | 'table' | 'mini';
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`card card--${size} card--joker ${selected ? 'card--selected' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled && !onClick}
      aria-label={t('fiftyOne.joker')}
    >
      <span className="card__corner card__corner--tl"><span className="card__rank">🃏</span></span>
      <span className="card__center">🃏</span>
      <span className="card__corner card__corner--br"><span className="card__rank">🃏</span></span>
    </button>
  );
}

/** One card as it appears INSIDE a public meld: a joker shows the card it
 *  represents (§8) with a small 🃏 badge — never a flat "25". */
function MeldCard({ card, represents }: { card: FiftyOneCard; represents?: { suit: Suit; rank: Rank } }) {
  if (card.joker && represents) {
    return (
      <span className="fiftyone-meldcard fiftyone-meldcard--joker">
        <CardView card={{ suit: represents.suit, rank: represents.rank, value: 0 }} size="mini" disabled />
        <span className="fiftyone-meldcard__jbadge" aria-hidden="true">🃏</span>
      </span>
    );
  }
  if (card.joker) return <JokerCard size="mini" disabled />;
  return <CardView card={toCard(card)} size="mini" disabled />;
}

export default function FiftyOneGameScreen({ state, humanSeat, apply, onExit, online = false }: Props) {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [staged, setStaged] = useState<string[][]>([]);
  // Which selected card is picked for reordering (index into `selected`). The
  // selection ORDER is meaningful — it fixes a joker's position in the meld (30.9)
  // — so we NEVER auto-sort it; the player nudges it with ← / → instead (30.12).
  const [selPicked, setSelPicked] = useState<number | null>(null);

  const { phase, turnStep, currentSeat, roundNumber } = state;
  const opened = state.openedBySeat[humanSeat];
  const hand = state.handsBySeat[humanSeat];
  const isMyTurn = phase === 'playing' && currentSeat === humanSeat;

  // Clear any in-progress selection/staging whenever the turn/step/phase/round
  // changes, OR the hand or table melds mutate (a draw, open, lay-off or discard
  // invalidates ids the selection/staging referenced).
  useEffect(() => {
    setSelected([]);
    setStaged([]);
    setSelPicked(null);
  }, [currentSeat, turnStep, phase, roundNumber, hand.length, state.publicMelds.length]);

  const stagedIds = useMemo(() => new Set(staged.flat()), [staged]);
  const byId = useMemo(() => new Map(hand.map((c) => [c.id, c])), [hand]);
  // Client-only display order for the (non-staged) hand — default sort, or manual
  // once the player arranges it. Never touches the reducer hand (Stage 30.12).
  const visibleHand = useMemo(() => sortHand(hand.filter((c) => !stagedIds.has(c.id))), [hand, stagedIds]);
  const handOrder = useManualHandOrder(visibleHand, fiftyOneCardId);
  const selectedCards = useMemo(
    () => selected.map((id) => byId.get(id)).filter((c): c is FiftyOneCard => !!c),
    [selected, byId],
  );
  const selResolved = selectedCards.length >= 3 ? resolveMeld(selectedCards) : null;
  const stagedMelds = useMemo(
    () => staged.map((ids) => ids.map((id) => byId.get(id)).filter((c): c is FiftyOneCard => !!c)),
    [staged, byId],
  );
  const stagedTotal = stagedMelds.reduce((sum, cards) => sum + (resolveMeld(cards)?.value ?? 0), 0);
  const remainingAfterStage = hand.length - stagedIds.size;

  function toggle(id: string) {
    if (stagedIds.has(id)) return; // staged cards are locked until "Open" or "Clear"
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setSelPicked(null);
  }

  /** Nudge the picked selected card left/right — reorders the meld sequence (and
   *  hence a joker's position) WITHOUT auto-sorting the selection (30.12). */
  function moveSelected(dir: -1 | 1) {
    setSelected((s) => {
      if (selPicked == null) return s;
      const j = selPicked + dir;
      if (j < 0 || j >= s.length) return s;
      const n = s.slice();
      [n[selPicked], n[j]] = [n[j], n[selPicked]];
      setSelPicked(j);
      return n;
    });
  }

  // --- Actions ---------------------------------------------------------------
  const drawStep = isMyTurn && turnStep === 'draw';
  const meldStep = isMyTurn && turnStep === 'meld_discard';
  const canTakeDiscard = drawStep && opened && state.discardPile.length > 0;
  // Staging + laying works BEFORE and AFTER opening (30.9). The 51 minimum is the
  // opening gate only — once opened, any valid staged meld can be laid.
  const canStage = meldStep && !!selResolved && remainingAfterStage - selected.length >= 1;
  const meetsOpening = opened || stagedTotal >= OPENING_MINIMUM;
  const canLay = meldStep && staged.length > 0 && meetsOpening && remainingAfterStage >= 1;
  const canDiscard = meldStep && selected.length === 1;

  function stageMeld() {
    if (!canStage) return;
    setStaged((m) => [...m, [...selected]]);
    setSelected([]);
  }
  function layMelds() {
    if (!canLay) return;
    apply({ type: 'OPEN_MELDS', melds: stagedMelds });
  }
  function discard() {
    if (!canDiscard) return;
    const card = byId.get(selected[0]);
    if (card) apply({ type: 'DISCARD', card });
  }
  function addToMeld(meld: FiftyOneMeld) {
    apply({ type: 'ADD_TO_MELD', meldId: meld.id, cards: selectedCards });
  }
  function canAddTo(meld: FiftyOneMeld): boolean {
    return meldStep && opened && selectedCards.length >= 1
      && hand.length - selectedCards.length >= 1
      && !!resolveMeld([...meld.cards, ...selectedCards]);
  }

  // --- Prompt / validation text ---------------------------------------------
  const actor = state.players[currentSeat];
  let prompt = '';
  if (phase === 'round_complete') prompt = t('fiftyOne.roundOver');
  else if (isMyTurn) prompt = turnStep === 'draw' ? t('fiftyOne.drawPrompt') : t('fiftyOne.meldPrompt');
  else prompt = actor.type === 'ai' ? t('fiftyOne.botThinking').replace('{name}', actor.name) : t('fiftyOne.waiting').replace('{name}', actor.name);

  let validation = '';
  if (meldStep && selectedCards.length > 0) {
    if (selectedCards.length < 3) validation = t('fiftyOne.selectThree');
    else if (selResolved) {
      validation = t(selResolved.type === 'run' ? 'fiftyOne.validRun' : 'fiftyOne.validSet')
        .replace('{n}', String(selResolved.value));
    } else validation = t('fiftyOne.invalidMeld');
  } else if (meldStep && staged.length > 0 && !opened && stagedTotal < OPENING_MINIMUM) {
    // Staged something but not enough to OPEN yet — the opening 51 gate (unopened only).
    validation = t('fiftyOne.openingNeeds51');
  } else if (meldStep && opened && selectedCards.length === 0 && staged.length === 0) {
    // Reassure an opened player: the 51 minimum is gone; any valid meld is layable.
    validation = t('fiftyOne.openAnyMeld');
  }

  const topDiscard = state.discardPile.length > 0 ? state.discardPile[state.discardPile.length - 1] : null;

  return (
    <div className="screen fiftyone-screen">
      {showHelp && <GameHelpModal game="fifty-one" onClose={() => setShowHelp(false)} />}

      <div className="fiftyone-topbar">
        <button type="button" className="btn btn--ghost fiftyone-exit" onClick={onExit} aria-label={t('btn.backToMenu')}>✕</button>
        <span className="fiftyone-round">{t('fiftyOne.round').replace('{n}', String(roundNumber))}</span>
        <button type="button" className="btn btn--ghost fiftyone-help-btn" onClick={() => setShowHelp(true)} aria-label={t('help.howToPlay')}>❓</button>
      </div>

      {/* Scoreboard: per-seat running penalty + state badges. */}
      <div className="fiftyone-scoreboard">
        {state.players.map((p) => {
          const seat = p.seatIndex;
          const me = seat === humanSeat;
          const acting = phase === 'playing' && seat === currentSeat;
          return (
            <div
              key={p.id}
              className={`fiftyone-score ${me ? 'fiftyone-score--me' : ''} ${acting ? 'fiftyone-score--acting' : ''} ${state.eliminatedSeats[seat] ? 'fiftyone-score--out' : ''}`}
            >
              <span className="fiftyone-score__name">
                {acting && <span className="fiftyone-score__turn" aria-hidden="true">▶ </span>}
                {me ? t('fiftyOne.you') : p.name}
              </span>
              <span className="fiftyone-score__value">{state.scoresBySeat[seat]}</span>
              <span className="fiftyone-score__badges">
                {state.eliminatedSeats[seat] && <span title={t('fiftyOne.eliminated')}>☠</span>}
                {state.openedBySeat[seat] && <span className="fiftyone-badge--open" title={t('fiftyOne.opened')}>✓</span>}
                {!me && <span className="fiftyone-score__count">🂠{state.handsBySeat[seat].length}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* Piles: face-down draw + face-up discard top. */}
      <div className="fiftyone-piles">
        <div className="fiftyone-pile">
          <span className="fiftyone-pile__label">{t('fiftyOne.drawPile')} · {state.drawPile.length}</span>
          <div className={`card card--table card--back fiftyone-drawpile ${drawStep ? 'fiftyone-drawpile--live' : ''}`} aria-hidden="true" />
        </div>
        <div className="fiftyone-pile">
          <span className="fiftyone-pile__label">{t('fiftyOne.discardPile')} · {state.discardPile.length}</span>
          {topDiscard
            ? (topDiscard.joker ? <JokerCard size="table" disabled /> : <CardView card={toCard(topDiscard)} size="table" disabled />)
            : <div className="card card--table fiftyone-discard-empty" aria-hidden="true" />}
        </div>
      </div>

      {/* Public melds (all seats). Jokers show the card they represent, not 25. */}
      <div className="fiftyone-melds">
        {state.publicMelds.length === 0 && <p className="fiftyone-melds__empty">{t('fiftyOne.noMelds')}</p>}
        {state.publicMelds.map((meld) => {
          const owner = meld.ownerSeat === humanSeat ? t('fiftyOne.you') : state.players[meld.ownerSeat].name;
          const addable = canAddTo(meld);
          return (
            <div key={meld.id} className="fiftyone-meld">
              <span className="fiftyone-meld__owner">{owner} · {meld.value}</span>
              <div className="fiftyone-meld__cards">
                {meld.cards.map((c, i) => (
                  <MeldCard key={c.id + i} card={c} represents={meld.jokerRepresents[i]} />
                ))}
              </div>
              {opened && (
                <button type="button" className="btn btn--small fiftyone-meld__add" disabled={!addable} onClick={() => addToMeld(meld)}>
                  ＋ {t('fiftyOne.addToMeld')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className={`fiftyone-prompt ${isMyTurn ? 'fiftyone-prompt--me' : ''}`}>
        <span>{prompt}</span>
        {validation && <span className="fiftyone-prompt__val">{validation}</span>}
      </div>

      {/* Meld builder: the SELECTED cards in their chosen order (left→right = the run
          order, which fixes a joker's position). Tap one, then ← / → to reorder — the
          selection is never auto-sorted (30.9/30.12). Shows what a joker becomes. */}
      {meldStep && selectedCards.length >= 2 && (
        <div className="fiftyone-selbuilder">
          <div className="fiftyone-selbuilder__strip" dir="ltr">
            {selectedCards.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={`fiftyone-selbuilder__card ${selPicked === i ? 'fiftyone-selbuilder__card--picked' : ''}`}
                aria-pressed={selPicked === i}
                onClick={() => setSelPicked((p) => (p === i ? null : i))}
              >
                {c.joker ? <JokerCard size="mini" disabled /> : <CardView card={toCard(c)} size="mini" disabled />}
              </button>
            ))}
          </div>
          <div className="fiftyone-selbuilder__ctrl">
            <button type="button" className="btn btn--outline btn--small" disabled={selPicked == null || selPicked === 0}
              onClick={() => moveSelected(-1)} aria-label={t('hand.moveLeft')}>←</button>
            <span className="fiftyone-selbuilder__info">
              {selResolved
                ? `${t(selResolved.type === 'run' ? 'fiftyOne.validRun' : 'fiftyOne.validSet').replace('{n}', String(selResolved.value))}`
                  + Object.values(selResolved.jokerRepresents).map((r) => ` · 🃏=${r.rank}${SUIT_SYMBOL[r.suit]}`).join('')
                : t('fiftyOne.selOrderHint')}
            </span>
            <button type="button" className="btn btn--outline btn--small" disabled={selPicked == null || selPicked === selectedCards.length - 1}
              onClick={() => moveSelected(1)} aria-label={t('hand.moveRight')}>→</button>
          </div>
        </div>
      )}

      {/* Staged melds. Before opening they must total ≥ 51; after opening any value. */}
      {staged.length > 0 && (
        <div className="fiftyone-staged">
          <span className="fiftyone-staged__label">
            {opened
              ? t('fiftyOne.meldTotal').replace('{n}', String(stagedTotal))
              : t('fiftyOne.openTotal').replace('{n}', String(stagedTotal))}
          </span>
          <div className="fiftyone-staged__rows">
            {stagedMelds.map((cards, i) => (
              <div key={i} className="fiftyone-staged__meld">
                {cards.map((c) => (c.joker ? <JokerCard key={c.id} size="mini" disabled /> : <CardView key={c.id} card={toCard(c)} size="mini" disabled />))}
                <span className="fiftyone-staged__pts">{resolveMeld(cards)?.value ?? 0}</span>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setStaged([])}>{t('fiftyOne.clear')}</button>
        </div>
      )}

      {/* The human's hand (staged cards are hidden here until Open/Clear). */}
      <div className="fiftyone-hand">
        {handOrder.ordered.map((c) =>
          c.joker
            ? <JokerCard key={c.id} onClick={() => toggle(c.id)} selected={selected.includes(c.id)} disabled={!meldStep} />
            : <CardView key={c.id} card={toCard(c)} size="hand" onClick={() => toggle(c.id)} selected={selected.includes(c.id)} disabled={!meldStep} />,
        )}
      </div>
      <div className="fiftyone-hand-tools">
        <HandOrderControls order={handOrder} cardId={fiftyOneCardId}
          renderMini={(c) => (c.joker ? <JokerCard size="mini" disabled /> : <CardView card={toCard(c)} size="mini" disabled />)} />
      </div>

      {/* Action bar — context-sensitive per step. */}
      <div className="fiftyone-actions">
        {drawStep && (
          <>
            <button type="button" className="btn btn--primary" onClick={() => apply({ type: 'DRAW_FROM_DECK' })}>{t('fiftyOne.drawFromDeck')}</button>
            <button type="button" className="btn btn--ghost" disabled={!canTakeDiscard} onClick={() => canTakeDiscard && apply({ type: 'TAKE_DISCARD' })}>{t('fiftyOne.takeDiscard')}</button>
          </>
        )}
        {meldStep && (
          <>
            <button type="button" className="btn btn--ghost" disabled={!canStage} onClick={stageMeld}>{t('fiftyOne.stageMeld')}</button>
            <button type="button" className="btn btn--primary" disabled={!canLay} onClick={layMelds}>
              {opened
                ? t('fiftyOne.layMeld')
                : `${t('fiftyOne.open')} (${stagedTotal}/${OPENING_MINIMUM})`}
            </button>
          </>
        )}
        {meldStep && (
          <button type="button" className="btn btn--primary fiftyone-discard-btn" disabled={!canDiscard} onClick={discard}>{t('fiftyOne.discard')}</button>
        )}
      </div>

      {phase === 'round_complete' && state.lastRound && (
        <RoundComplete
          state={state}
          humanSeat={humanSeat}
          // Online: the server auto-advances (seeded START_NEXT_ROUND) — no client button.
          onNext={online ? undefined : () => apply({ type: 'START_NEXT_ROUND' })}
        />
      )}
    </div>
  );
}

/** Between-rounds summary: winner, per-seat penalty delta + totals + eliminations.
 *  `onNext` undefined = online (the server advances the round; show a waiting note). */
function RoundComplete({ state, humanSeat, onNext }: { state: FiftyOneState; humanSeat: number; onNext?: () => void }) {
  const { t } = useI18n();
  const r = state.lastRound!;
  const name = (seat: number) => (seat === humanSeat ? t('fiftyOne.you') : state.players[seat].name);
  return (
    <div className="fiftyone-roundover-overlay" role="dialog" aria-modal="true">
      <div className="fiftyone-roundover">
        <h2 className="fiftyone-roundover__title">🏁 {t('fiftyOne.wins').replace('{name}', name(r.winnerSeat))}</h2>
        <table className="fiftyone-roundover__table">
          <thead>
            <tr><th></th><th>+{t('fiftyOne.penalty')}</th><th>{t('fiftyOne.total')}</th></tr>
          </thead>
          <tbody>
            {state.players.map((p) => (
              <tr key={p.id} className={state.eliminatedSeats[p.seatIndex] ? 'fiftyone-roundover__out' : ''}>
                <td>
                  {name(p.seatIndex)}
                  {r.neverOpenedBySeat[p.seatIndex] && <span className="fiftyone-roundover__flag"> ·100</span>}
                  {r.newlyEliminated.includes(p.seatIndex) && <span> ☠</span>}
                </td>
                <td>{r.penaltyBySeat[p.seatIndex] > 0 ? `+${r.penaltyBySeat[p.seatIndex]}` : '—'}</td>
                <td><strong>{state.scoresBySeat[p.seatIndex]}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        {onNext
          ? <button type="button" className="btn btn--primary" onClick={onNext} autoFocus>{t('fiftyOne.nextRound')}</button>
          : <p className="fiftyone-roundover__waiting" role="status">{t('fiftyOne.nextRoundSoon')}</p>}
      </div>
    </div>
  );
}
