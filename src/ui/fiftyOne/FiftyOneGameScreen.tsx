import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import CardView, { SUIT_SYMBOL } from '../components/CardView';
import GameHelpModal from '../components/GameHelpModal';
import type { Card, Rank, Suit } from '../../models/types';
import type { FiftyOneAction, FiftyOneCard, FiftyOneMeld, FiftyOneState } from '../../games/fiftyOne/types';
import { resolveMeld, legalLayoffPlacements, type LayoffOption } from '../../games/fiftyOne/melds';
import { calcSelection, calcHandTotal } from '../../games/fiftyOne/calculator';
import { OPENING_MINIMUM } from '../../games/fiftyOne/rules';
import HandReorderTray from '../components/HandReorderTray';
import FiftyOneLayoffDialog from './FiftyOneLayoffDialog';
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
  /**
   * ONE compact, game-agnostic launcher rendered in the TOP BAR (Stage 38.0.5.1).
   *
   * 38.0.4 docked the whole social toolbar in normal flow between the melds and the
   * prompt. That fixed the overlap but cost a full band of a phone screen and read as
   * clutter, so the toolbar is gone: online play now passes a single launcher (with its
   * unread badge) that opens a modal sheet. Collapsed, the gameplay column has NO social
   * row at all. LOCAL play passes nothing and is byte-identical to before.
   */
  menuSlot?: ReactNode;
  /** Optional compact turn timer, also a top-bar element. Null/undefined = timer off. */
  timerSlot?: ReactNode;
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

/** One card as it appears INSIDE a public meld. EVERY variant — normal card, bare
 *  joker, and a joker showing the card it represents (§8) — is wrapped in the SAME
 *  `.fiftyone-meldcard` slot span (Stage 36.0) so ONE CSS rule governs the fixed
 *  slot size for all of them; the card can never disagree with its slot and overlap
 *  a neighbour. A represented joker adds a small 🃏 badge — never a flat "25". */
function MeldCard({ card, represents }: { card: FiftyOneCard; represents?: { suit: Suit; rank: Rank } }) {
  const jokerRep = card.joker && !!represents;
  const inner = jokerRep
    ? <CardView card={{ suit: represents!.suit, rank: represents!.rank, value: 0 }} size="mini" disabled />
    : card.joker
      ? <JokerCard size="mini" disabled />
      : <CardView card={toCard(card)} size="mini" disabled />;
  return (
    <span className={`fiftyone-meldcard${jokerRep ? ' fiftyone-meldcard--joker' : ''}`}>
      {inner}
      {jokerRep && <span className="fiftyone-meldcard__jbadge" aria-hidden="true">🃏</span>}
    </span>
  );
}

export default function FiftyOneGameScreen({ state, humanSeat, apply, onExit, online = false, menuSlot, timerSlot }: Props) {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [staged, setStaged] = useState<string[][]>([]);
  // Which selected card is picked for reordering (index into `selected`). The
  // selection ORDER is meaningful — it fixes a joker's position in the meld (30.9)
  // — so we NEVER auto-sort it; the player nudges it with ← / → instead (30.12).
  const [selPicked, setSelPicked] = useState<number | null>(null);
  // Card calculator (Stage 36.0): a LOCAL, display-only mode available at ANY time
  // (even on someone else's turn). It never dispatches, never removes cards from the
  // hand, and never touches the meld selection/staging or the manual hand order — it
  // only previews what a picked combination is worth + the hand's total penalty.
  const [calcMode, setCalcMode] = useState(false);
  const [calcSel, setCalcSel] = useState<string[]>([]);
  // (38.0.9) An AMBIGUOUS lay-off waiting for the player to choose a side. Null until the
  // shared helper reports TWO legal ends; cancelling dispatches nothing.
  const [pendingLayoff, setPendingLayoff] = useState<{ meld: FiftyOneMeld; options: LayoffOption[] } | null>(null);

  const { phase, turnStep, currentSeat, roundNumber } = state;
  const opened = state.openedBySeat[humanSeat];
  const hand = state.handsBySeat[humanSeat];
  const isMyTurn = phase === 'playing' && currentSeat === humanSeat;
  const drawStep = isMyTurn && turnStep === 'draw';
  const meldStep = isMyTurn && turnStep === 'meld_discard';
  const topDiscard = state.discardPile.length > 0 ? state.discardPile[state.discardPile.length - 1] : null;
  // Discard-to-open (30.13): an UNOPENED seat at the draw step may build its opening
  // melds using the top discard card — but ONLY if it opens with it in one action;
  // it may never take the discard "just into hand" before opening.
  const discardOpenAvailable = drawStep && !opened && !!topDiscard;
  // The pool you can build melds from now = your hand, plus the discard top when it's
  // available to open with. `byId` resolves the selected/staged cards from this pool.
  const pool = discardOpenAvailable && topDiscard ? [...hand, topDiscard] : hand;
  // The meld-building UI (select / stage) is live at the meld step, or at the draw
  // step for an unopened seat that can open using the discard top.
  const meldContext = meldStep || discardOpenAvailable;

  // (38.0.9 owner FAIL) The selection used to be reset ONLY on a length change, so a
  // SAME-LENGTH mutation — most obviously `REPLACE_JOKER`, which swaps one card for the
  // joker — left STALE ids behind. `selectedCards` then silently dropped them and the
  // player was stuck with three cards picked and "select three cards" on screen, with no
  // way out but a reload. That is the intermittent `6♠ + Joker + 8♠` report.
  //
  // A real turn change still clears everything; an ordinary state update instead
  // RECONCILES the selection against the authoritative ids, so an equivalent re-render
  // (an online snapshot, a reconnect, a rejected action) can never destroy a valid pick.
  useEffect(() => {
    setSelected([]);
    setStaged([]);
    setSelPicked(null);
  }, [currentSeat, turnStep, phase, roundNumber]);

  // The ids that really exist in the pool right now (hand + the openable discard top).
  const poolIds = useMemo(() => new Set(pool.map((c) => c.id)), [pool]);
  const poolKey = useMemo(() => [...poolIds].sort().join('|'), [poolIds]);

  useEffect(() => {
    // Drop only the ids that are genuinely gone. A staged meld that lost a card is no
    // longer a meld, so the whole group is released (its remaining cards return to the
    // hand display automatically — staging is a client-side view, never reducer state).
    setSelected((cur) => {
      const next = cur.filter((id) => poolIds.has(id));
      return next.length === cur.length ? cur : next;
    });
    setStaged((cur) => {
      const next = cur.filter((group) => group.every((id) => poolIds.has(id)));
      return next.length === cur.length ? cur : next;
    });
    setSelPicked((p) => (p == null ? p : null));
    // `poolKey` is the CONTENT identity of the pool — not its length — so a same-length
    // mutation is seen, and an identical re-render is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey]);

  /**
   * Public melds grouped by owner seat (Stage 38.0.5.1) — a pure display regrouping.
   * Groups appear in FIRST-APPEARANCE order and every group keeps `publicMelds` order,
   * so nothing about the authoritative sequence (which fixes a joker's slot) moves.
   */
  const meldGroups = useMemo(() => {
    const order: number[] = [];
    const bySeat = new Map<number, FiftyOneMeld[]>();
    for (const m of state.publicMelds) {
      let list = bySeat.get(m.ownerSeat);
      if (!list) { list = []; bySeat.set(m.ownerSeat, list); order.push(m.ownerSeat); }
      list.push(m);
    }
    return order.map((seat) => ({ seat, melds: bySeat.get(seat)! }));
  }, [state.publicMelds]);

  const stagedIds = useMemo(() => new Set(staged.flat()), [staged]);
  const byId = useMemo(() => new Map(pool.map((c) => [c.id, c])), [hand, topDiscard, discardOpenAvailable]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const remainingAfterStage = pool.length - stagedIds.size;

  function toggle(id: string) {
    if (stagedIds.has(id)) return; // staged cards are locked until "Open" or "Clear"
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setSelPicked(null);
  }

  // --- Calculator (local, display-only) --------------------------------------
  // Selection order is honoured (it fixes a joker's slot), and stale ids simply drop
  // when the hand mutates. Nothing here dispatches or mutates the reducer/hand.
  const calcCards = useMemo(
    () => calcSel.map((id) => hand.find((c) => c.id === id)).filter((c): c is FiftyOneCard => !!c),
    [calcSel, hand],
  );
  const calcResult = calcSelection(calcCards);
  const calcTotal = calcHandTotal(hand);
  function toggleCalc(id: string) {
    setCalcSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function setCalc(on: boolean) {
    setCalcMode(on);
    if (!on) setCalcSel([]); // leaving calc mode clears its local picks
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
  const canTakeDiscard = drawStep && opened && state.discardPile.length > 0; // opened: take into hand
  // Staging works in the meld context (meld step, or draw-step discard-open).
  const canStage = meldContext && !!selResolved && remainingAfterStage - selected.length >= 1;
  const meetsOpening = opened || stagedTotal >= OPENING_MINIMUM;
  // Lay/open at the meld step (after drawing). The 51 minimum is the opening gate only.
  const canLay = meldStep && staged.length > 0 && meetsOpening && remainingAfterStage >= 1;
  // Take-and-open at the draw step: the staged opening must total ≥ 51 AND include the
  // discard top (else you'd be taking it "into hand", which is forbidden, 30.13).
  const canTakeAndOpen = discardOpenAvailable && staged.length > 0 && stagedTotal >= OPENING_MINIMUM
    && !!topDiscard && stagedIds.has(topDiscard.id) && remainingAfterStage >= 1;
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
  function takeAndOpen() {
    if (!canTakeAndOpen) return;
    apply({ type: 'TAKE_DISCARD_AND_OPEN', melds: stagedMelds });
  }
  function discard() {
    if (!canDiscard) return;
    const card = byId.get(selected[0]);
    if (card) apply({ type: 'DISCARD', card });
  }
  /**
   * (38.0.9) Which sides of `meld` this selection may legally join. The SAME shared helper
   * the reducer and the bot use — the UI never decides legality on its own, it only asks
   * the player when the rules genuinely allow both ends.
   */
  function layoffOptions(meld: FiftyOneMeld): LayoffOption[] {
    if (!meldStep || !opened) return [];
    if (selectedCards.length < 1) return [];
    if (hand.length - selectedCards.length < 1) return [];   // keep a card to discard
    return legalLayoffPlacements(meld.cards, selectedCards);
  }
  /** Dispatch one lay-off with an explicit, server-validated side. */
  function layoff(meld: FiftyOneMeld, option: LayoffOption) {
    apply({ type: 'ADD_TO_MELD', meldId: meld.id, cards: selectedCards, placement: option.placement });
    setPendingLayoff(null);
  }
  /** 0 legal sides → no control; 1 → act now; 2 → ask which end (the joker case). */
  function addToMeld(meld: FiftyOneMeld) {
    const options = layoffOptions(meld);
    if (options.length === 0) return;
    if (options.length === 1) { layoff(meld, options[0]); return; }
    setPendingLayoff({ meld, options });
  }
  function canAddTo(meld: FiftyOneMeld): boolean {
    return layoffOptions(meld).length > 0;
  }

  /**
   * A joker in `meld` this player can buy back right now (30.14): opened, on their
   * own meld step, holding the EXACT card the joker represents. The rank+suit must
   * match exactly, so there is never a choice to offer — the swap is unambiguous
   * and the button just does it. Returns the joker + the matching hand card.
   */
  function jokerSwap(meld: FiftyOneMeld): { jokerCardId: string; card: FiftyOneCard } | null {
    if (!meldStep || !opened) return null;
    for (let i = 0; i < meld.cards.length; i++) {
      const jc = meld.cards[i];
      const rep = meld.jokerRepresents[i];
      if (!jc.joker || !rep) continue;
      const match = hand.find((h) => !h.joker && h.suit === rep.suit && h.rank === rep.rank);
      if (match) return { jokerCardId: jc.id, card: match };
    }
    return null;
  }
  function replaceJoker(meld: FiftyOneMeld) {
    const swap = jokerSwap(meld);
    if (swap) apply({ type: 'REPLACE_JOKER', meldId: meld.id, jokerCardId: swap.jokerCardId, card: swap.card });
  }

  // --- Prompt / validation text ---------------------------------------------
  const actor = state.players[currentSeat];
  let prompt = '';
  if (phase === 'round_complete') prompt = t('fiftyOne.roundOver');
  else if (isMyTurn) prompt = turnStep === 'draw' ? t('fiftyOne.drawPrompt') : t('fiftyOne.meldPrompt');
  else prompt = actor.type === 'ai' ? t('fiftyOne.botThinking').replace('{name}', actor.name) : t('fiftyOne.waiting').replace('{name}', actor.name);

  let validation = '';
  if (meldContext && selectedCards.length > 0) {
    if (selectedCards.length < 3) validation = t('fiftyOne.selectThree');
    else if (selResolved) {
      validation = t(selResolved.type === 'run' ? 'fiftyOne.validRun' : 'fiftyOne.validSet')
        .replace('{n}', String(selResolved.value));
    } else validation = t('fiftyOne.invalidMeld');
  } else if (discardOpenAvailable && selectedCards.length === 0 && staged.length === 0) {
    // Draw step, unopened: explain the discard is takeable only as part of opening.
    validation = t('fiftyOne.discardOpenOnly');
  } else if (meldContext && staged.length > 0 && !opened && stagedTotal < OPENING_MINIMUM) {
    // Staged something but not enough to OPEN yet — the opening 51 gate (unopened only).
    validation = t('fiftyOne.openingNeeds51');
  } else if (meldStep && opened && selectedCards.length === 0 && staged.length === 0) {
    // Reassure an opened player: the 51 minimum is gone; any valid meld is layable.
    validation = t('fiftyOne.openAnyMeld');
  }

  return (
    <div className="screen fiftyone-screen">
      {showHelp && <GameHelpModal game="fifty-one" onClose={() => setShowHelp(false)} />}
      {pendingLayoff && (
        <FiftyOneLayoffDialog
          options={pendingLayoff.options}
          onPick={(o) => layoff(pendingLayoff.meld, o)}
          onCancel={() => setPendingLayoff(null)}
        />
      )}

      <div className="fiftyone-topbar">
        <button type="button" className="btn btn--ghost fiftyone-exit" onClick={onExit} aria-label={t('btn.backToMenu')}>✕</button>
        <span className="fiftyone-round">{t('fiftyOne.round').replace('{n}', String(roundNumber))}</span>
        <button
          type="button"
          className={`btn btn--ghost fiftyone-calc-btn ${calcMode ? 'fiftyone-calc-btn--on' : ''}`}
          aria-pressed={calcMode}
          onClick={() => setCalc(!calcMode)}
          aria-label={t('fiftyOne.calcToggle')}
          title={t('fiftyOne.calcToggle')}
        >🧮</button>
        <button type="button" className="btn btn--ghost fiftyone-help-btn" onClick={() => setShowHelp(true)} aria-label={t('help.howToPlay')}>❓</button>
        {/* (38.0.5.1) Compact timer + the single social launcher live HERE, so the
            gameplay column below stays free of any social row while collapsed. */}
        {timerSlot && <span className="fiftyone-topbar__timer">{timerSlot}</span>}
        {menuSlot && <span className="fiftyone-topbar__menu">{menuSlot}</span>}
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
            ? (() => {
                // An unopened seat may SELECT the top only to open with it (30.13).
                const isSel = selected.includes(topDiscard.id);
                const isStaged = stagedIds.has(topDiscard.id);
                const onPick = discardOpenAvailable && !isStaged ? () => toggle(topDiscard.id) : undefined;
                const wrap = `fiftyone-discard-top ${discardOpenAvailable ? 'fiftyone-discard-top--usable' : ''} ${isStaged ? 'fiftyone-discard-top--staged' : ''}`.trim();
                return (
                  <span className={wrap}>
                    {topDiscard.joker
                      ? <JokerCard size="table" onClick={onPick} selected={isSel} disabled={!discardOpenAvailable} />
                      : <CardView card={toCard(topDiscard)} size="table" onClick={onPick} selected={isSel} disabled={!discardOpenAvailable} />}
                  </span>
                );
              })()
            : <div className="card card--table fiftyone-discard-empty" aria-hidden="true" />}
          {discardOpenAvailable && <span className="fiftyone-pile__hint">{t('fiftyOne.useDiscardToOpen')}</span>}
        </div>
      </div>

      {/* Public melds, GROUPED BY OWNER (Stage 38.0.5.1). The owner's name is printed
          ONCE per group with that owner's total value; each combination inside is a
          compact row (Run/Set + value, then the cards). Meld order and card order are
          untouched — the sequence is the rule (51_RULES §5/§8), never a display choice. */}
      <div className="fiftyone-melds" aria-label={t('fiftyOne.meldTable')}>
        {state.publicMelds.length === 0 && <p className="fiftyone-melds__empty">{t('fiftyOne.noMelds')}</p>}
        {meldGroups.map((group) => {
          const owner = group.seat === humanSeat ? t('fiftyOne.you') : state.players[group.seat].name;
          const total = group.melds.reduce((sum, m) => sum + m.value, 0);
          return (
            <section
              key={group.seat}
              className={`fiftyone-meldgroup${state.eliminatedSeats[group.seat] ? ' fiftyone-meldgroup--out' : ''}`}
              aria-label={owner}
            >
              <header className="fiftyone-meldgroup__head">
                <span className="fiftyone-meldgroup__owner">{owner}</span>
                <span className="fiftyone-meldgroup__total">{total}</span>
              </header>
              {group.melds.map((meld) => {
                const addable = canAddTo(meld);
                // Only an OPENED player on their own meld step ever sees table controls.
                const swap = jokerSwap(meld);
                return (
                  <div key={meld.id} className="fiftyone-meld">
                    <div className="fiftyone-meld__bar">
                      <span className="fiftyone-meld__label">
                        {t(meld.type === 'run' ? 'fiftyOne.typeRun' : 'fiftyOne.typeSet')} · {meld.value}
                      </span>
                      {/* Compact icon actions in the LABEL row — never a full-width button
                          repeated under every meld, and never rendered when the action is
                          impossible right now (they would only take space). Still 44×44. */}
                      {(addable || swap) && (
                        <span className="fiftyone-meld__ctrls">
                          {addable && (
                            <button type="button" className="btn btn--small fiftyone-meld__add"
                              onClick={() => addToMeld(meld)}
                              aria-label={t('fiftyOne.addToMeld')} title={t('fiftyOne.addToMeld')}>＋</button>
                          )}
                          {swap && (
                            <button type="button" className="btn btn--small fiftyone-meld__swap"
                              onClick={() => replaceJoker(meld)}
                              aria-label={t('fiftyOne.replaceJoker')} title={t('fiftyOne.replaceJoker')}>🃏</button>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="fiftyone-meld__cards" dir="ltr">
                      {meld.cards.map((c, i) => (
                        <MeldCard key={c.id + i} card={c} represents={meld.jokerRepresents[i]} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
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
      {meldContext && selectedCards.length >= 2 && (
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

      {/* Card calculator (Stage 36.0): available ANY time — tap your cards to preview
          what a combination is worth, whether it's a valid meld, and your hand's total
          penalty. Purely local: it dispatches nothing and never removes cards. */}
      {calcMode && (
        <div className="fiftyone-calc" role="region" aria-label={t('fiftyOne.calcToggle')}>
          <div className="fiftyone-calc__row">
            <span className="fiftyone-calc__hand">{t('fiftyOne.calcHandTotal').replace('{n}', String(calcTotal))}</span>
            <span className="fiftyone-calc__hint">{t('fiftyOne.calcHint')}</span>
          </div>
          <div className="fiftyone-calc__row fiftyone-calc__sel">
            {calcCards.length === 0
              ? <span className="fiftyone-calc__empty">{t('fiftyOne.calcPickCards')}</span>
              : (
                <span className={`fiftyone-calc__result ${calcResult.valid ? 'fiftyone-calc__result--ok' : 'fiftyone-calc__result--no'}`}>
                  {calcResult.valid
                    ? t(calcResult.type === 'run' ? 'fiftyOne.validRun' : 'fiftyOne.validSet').replace('{n}', String(calcResult.value))
                      + (calcResult.jokerRepresents
                        ? Object.values(calcResult.jokerRepresents).map((r) => ` · 🃏=${r.rank}${SUIT_SYMBOL[r.suit]}`).join('')
                        : '')
                    : t('fiftyOne.calcNotMeld').replace('{n}', String(calcResult.value))}
                </span>
              )}
            {calcCards.length > 0 && (
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setCalcSel([])}>{t('fiftyOne.clear')}</button>
            )}
          </div>
        </div>
      )}

      {/* The human's hand (staged cards are hidden here until Open/Clear). Drag to
          reorder; tap to select for a meld — the tap order fixes a joker's spot. In
          calc mode a tap picks the card for the calculator instead (any time). */}
      <HandReorderTray
        items={handOrder.ordered}
        cardId={fiftyOneCardId}
        order={handOrder}
        onTap={(c) => (calcMode ? toggleCalc(c.id) : toggle(c.id))}
        canTap={() => calcMode || meldContext}
        renderCard={(c) => {
          const sel = calcMode ? calcSel.includes(c.id) : selected.includes(c.id);
          const dis = calcMode ? false : !meldContext;
          return c.joker
            ? <JokerCard selected={sel} disabled={dis} />
            : <CardView card={toCard(c)} size="hand" selected={sel} disabled={dis} />;
        }}
      />

      {/* Action bar — context-sensitive per step. */}
      <div className="fiftyone-actions">
        {drawStep && (
          <>
            <button type="button" className="btn btn--primary" onClick={() => apply({ type: 'DRAW_FROM_DECK' })}>{t('fiftyOne.drawFromDeck')}</button>
            {opened
              ? <button type="button" className="btn btn--ghost" disabled={!canTakeDiscard} onClick={() => canTakeDiscard && apply({ type: 'TAKE_DISCARD' })}>{t('fiftyOne.takeDiscard')}</button>
              : discardOpenAvailable && (
                <>
                  <button type="button" className="btn btn--ghost" disabled={!canStage} onClick={stageMeld}>{t('fiftyOne.stageMeld')}</button>
                  <button type="button" className="btn btn--primary" disabled={!canTakeAndOpen} onClick={takeAndOpen}>
                    {t('fiftyOne.takeAndOpen')} ({stagedTotal}/{OPENING_MINIMUM})
                  </button>
                </>
              )}
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
