// Variant key → engine (S1). One place the UI, the replay check and the tests use.

import type { Engine, Move, VariantKey } from './engine';
import { makeKlondike } from './klondike';
import { makeSpider } from './spider';
import { freecell } from './freecell';
import { yukon } from './yukon';
import { fortyThieves } from './fortyThieves';
import { pyramid } from './pyramid';
import { triPeaks } from './triPeaks';
import { hearts } from './hearts';

const ENGINES: Record<VariantKey, Engine<unknown, Move>> = {
  'klondike-1': makeKlondike(1) as Engine<unknown, Move>,
  'klondike-3': makeKlondike(3) as Engine<unknown, Move>,
  'spider-1': makeSpider(1) as Engine<unknown, Move>,
  'spider-2': makeSpider(2) as Engine<unknown, Move>,
  'spider-4': makeSpider(4) as Engine<unknown, Move>,
  freecell: freecell as Engine<unknown, Move>,
  pyramid: pyramid as Engine<unknown, Move>,
  tripeaks: triPeaks as Engine<unknown, Move>,
  yukon: yukon as Engine<unknown, Move>,
  'forty-thieves': fortyThieves as Engine<unknown, Move>,
  hearts: hearts as Engine<unknown, Move>,
};

export function engineFor(key: VariantKey): Engine<unknown, Move> {
  return ENGINES[key];
}
