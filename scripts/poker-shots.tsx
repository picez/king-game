// Visual-QA harness (Stage 37.7 §16 F): server-renders the REAL PokerGameScreen to
// static HTML with the actual poker.css so headless Chromium can screenshot the oval
// table at 2/4/6 seats + a showdown, across breakpoints + RTL. Not shipped; dev only.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import PokerGameScreen from '../src/ui/poker/PokerGameScreen';
import { pokerReducer } from '../src/games/poker/engine';
import { pokerRedactStateFor } from '../src/games/poker/redact';
import type { PokerState, PokerCard, Rank, Suit } from '../src/games/poker/types';

const card = (suit: Suit, rank: Rank): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });

function started(n: number): PokerState {
  const names = Array.from({ length: n }, (_, i) => `Player ${i + 1}`);
  return pokerReducer(null, {
    type: 'START_GAME', playerNames: names, playerTypes: names.map(() => 'human' as const),
    playerCount: n, options: { startingStack: 5000, smallBlind: 25, bigBlind: 50, blindGrowthEveryHands: 3 },
  })!;
}

/** A crafted 6-max river showdown: seat 0 royal flush beats seat 3's pair of aces. */
function showdown(): PokerState {
  const s = started(6);
  s.phase = 'hand_complete';
  s.street = 'river';
  s.board = [card('spades', 'A'), card('spades', 'K'), card('spades', 'Q'), card('hearts', '2'), card('clubs', '7')];
  s.holeCardsBySeat[0] = [card('spades', 'J'), card('spades', '10')];
  s.holeCardsBySeat[3] = [card('diamonds', 'A'), card('clubs', 'A')];
  s.revealedBySeat[0] = true; s.revealedBySeat[3] = true;
  s.foldedBySeat = s.foldedBySeat.map((_, i) => i !== 0 && i !== 3);
  s.contributedBySeat = [400, 50, 0, 400, 0, 0];
  s.lastHand = {
    handNumber: 1, wonBySeat: [800, 0, 0, 0, 0, 0], showdown: true, revealedSeats: [0, 3],
    categoryBySeat: { 0: 'royal_flush', 3: 'one_pair' },
    winningFiveBySeat: {
      0: ['spades-A', 'spades-K', 'spades-Q', 'spades-J', 'spades-10'],
      3: ['diamonds-A', 'clubs-A', 'spades-A', 'spades-K', 'clubs-7'],
    },
    pots: [{ amount: 800, eligibleSeats: [0, 3], winners: [0], returned: false }],
    newlyEliminated: [],
  };
  return s;
}

const css = ['base.css', 'game.css', 'lobby.css', 'poker.css']
  .map((f) => readFileSync(join('src/styles', f), 'utf8')).join('\n');

function page(state: PokerState, dir: 'ltr' | 'rtl'): string {
  const view = pokerRedactStateFor(state, 0);
  const html = renderToStaticMarkup(
    React.createElement(PokerGameScreen, { state: view, mySeat: 0, apply: () => {}, onExit: () => {}, online: true }),
  );
  return `<!doctype html><html lang="${dir === 'rtl' ? 'ar' : 'en'}" dir="${dir}" data-theme="dark"><head><meta charset="utf-8"><style>${css}
    html,body{margin:0;background:#0c141b;color:#e9edf1;font-family:system-ui,sans-serif;} .app{min-height:100vh;}
    ${process.env.PKR_DEBUG ? '.poker-screen{outline:2px solid red!important} .poker-table{outline:2px solid cyan!important} .poker-table-wrap{outline:2px solid magenta!important}' : ''}</style></head>
    <body><div class="app">${html}</div></body></html>`;
}

export function run(): void {
  mkdirSync('.shots', { recursive: true });
  const shots: Array<[string, PokerState, 'ltr' | 'rtl']> = [
    ['2seat', started(2), 'ltr'],
    ['4seat', started(4), 'ltr'],
    ['6seat', started(6), 'ltr'],
    ['showdown', showdown(), 'ltr'],
    ['6seat-rtl', started(6), 'rtl'],
  ];
  for (const [name, state, dir] of shots) {
    writeFileSync(join('.shots', `${name}.html`), page(state, dir));
    console.log('wrote', name);
  }
}
