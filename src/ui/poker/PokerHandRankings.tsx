// ---------------------------------------------------------------------------
// Poker hand-rankings help (Stage 37.7 §16 H). A scrollable modal listing the ten
// categories strongest→weakest with a localized name, description and a compact card
// example, plus the key rules (best 5 of 7, the A-2-3-4-5 wheel, suits never break
// ties, split pots). EN/UK/DE/AR (no fallback drift). Opening it never pauses the
// authoritative timer and reveals no private cards. Reused by the table Help button.
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { useI18n } from '../../i18n';
import type { HandCategory } from '../../games/poker/types';

/** The ten categories, strongest→weakest, each with a compact suited example. */
const RANKS: Array<{ cat: HandCategory; example: string }> = [
  { cat: 'royal_flush', example: 'A♠ K♠ Q♠ J♠ 10♠' },
  { cat: 'straight_flush', example: '9♥ 8♥ 7♥ 6♥ 5♥' },
  { cat: 'four_of_a_kind', example: 'Q♠ Q♥ Q♦ Q♣ 7♠' },
  { cat: 'full_house', example: 'K♠ K♥ K♦ 4♣ 4♠' },
  { cat: 'flush', example: 'A♦ J♦ 8♦ 6♦ 2♦' },
  { cat: 'straight', example: '8♠ 7♥ 6♦ 5♣ 4♠' },
  { cat: 'three_of_a_kind', example: '5♠ 5♥ 5♦ K♣ 2♠' },
  { cat: 'two_pair', example: 'A♠ A♥ 9♦ 9♣ 4♠' },
  { cat: 'one_pair', example: '10♠ 10♥ K♦ 7♣ 3♠' },
  { cat: 'high_card', example: 'A♠ Q♥ 9♦ 6♣ 2♠' },
];

const NAME_KEY: Record<HandCategory, string> = {
  high_card: 'poker.cat.highCard', one_pair: 'poker.cat.onePair', two_pair: 'poker.cat.twoPair',
  three_of_a_kind: 'poker.cat.trips', straight: 'poker.cat.straight', flush: 'poker.cat.flush',
  full_house: 'poker.cat.fullHouse', four_of_a_kind: 'poker.cat.quads',
  straight_flush: 'poker.cat.straightFlush', royal_flush: 'poker.cat.royalFlush',
};

export default function PokerHandRankings({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="poker-help-overlay" role="dialog" aria-modal="true" aria-label={t('poker.help.title')} onClick={onClose}>
      <div className="poker-help" onClick={(e) => e.stopPropagation()}>
        <header className="poker-help__head">
          <h3 className="poker-help__title">{t('poker.help.title')}</h3>
          <button type="button" className="poker-exit" onClick={onClose} aria-label={t('poker.help.close')}>✕</button>
        </header>
        <ol className="poker-help__list">
          {RANKS.map(({ cat, example }, i) => (
            <li key={cat} className="poker-help__rank">
              <span className="poker-help__no">{i + 1}</span>
              <div className="poker-help__body">
                <span className="poker-help__name">{t(NAME_KEY[cat])}</span>
                <span className="poker-help__desc">{t(`poker.rank.${cat}.desc`)}</span>
                <span className="poker-help__example">{example}</span>
              </div>
            </li>
          ))}
        </ol>
        <ul className="poker-help__notes">
          <li>{t('poker.help.note.bestFive')}</li>
          <li>{t('poker.help.note.aceLow')}</li>
          <li>{t('poker.help.note.suits')}</li>
          <li>{t('poker.help.note.split')}</li>
        </ul>
        <button type="button" className="btn btn--primary poker-help__done" onClick={onClose}>{t('poker.help.close')}</button>
      </div>
    </div>
  );
}
