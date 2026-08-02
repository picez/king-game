import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import PokerWalletCard from './PokerWalletCard';
import PokerStakesPicker from './PokerStakesPicker';
import type { PokerWalletStore } from './usePokerWallet';

// Stage 38.0.2 item 1 — the chip balance + daily claim moved OUT of Profile into the
// Poker host flow, and BOTH the wallet card and the stakes picker now read ONE shared
// store, so a claim updates the balance and the buy-in affordability together.

const html = (el: ReactElement) => renderToStaticMarkup(el);

const store = (over: Partial<PokerWalletStore> = {}): PokerWalletStore => ({
  phase: 'ready',
  wallet: { balance: 1_000_000, canClaimToday: true, nextClaimAt: null } as PokerWalletStore['wallet'],
  justClaimed: false, claiming: false, reload: () => {}, claim: () => {}, ...over,
});

describe('PokerWalletCard — every required state', () => {
  it('shows the balance and the claim button when the SERVER says it is claimable', () => {
    const out = html(createElement(PokerWalletCard, { wallet: store() }));
    expect(out).toContain('wallet-card__balance-value');
    expect(out).toContain('wallet-card__claim');
  });

  it('shows "already claimed today" instead of the button when the server says so', () => {
    const w = store({ wallet: { balance: 2_000_000, canClaimToday: false, nextClaimAt: null } as PokerWalletStore['wallet'] });
    const out = html(createElement(PokerWalletCard, { wallet: w }));
    expect(out).not.toContain('wallet-card__claim');
    expect(out).toContain('wallet-card__muted--claimed');
  });

  it('loading, sign-in hint, error+retry and economy-unavailable each render', () => {
    expect(html(createElement(PokerWalletCard, { wallet: store({ phase: 'loading', wallet: null }) }))).toContain('wallet-card__muted');
    expect(html(createElement(PokerWalletCard, { wallet: store({ phase: 'signed_out', wallet: null }) }))).toContain('wallet-card__muted');
    const err = html(createElement(PokerWalletCard, { wallet: store({ phase: 'error', wallet: null }) }));
    expect(err).toContain('wallet-card__row');           // message + Retry button
    expect(err).toMatch(/<button[^>]*>/);
    expect(html(createElement(PokerWalletCard, { wallet: store({ phase: 'no_economy', wallet: null }) }))).toContain('wallet-card__muted');
  });

  it('a granted claim shows the confirmation and the NEW balance from the server', () => {
    const w = store({
      justClaimed: true,
      wallet: { balance: 2_000_000, canClaimToday: false, nextClaimAt: null } as PokerWalletStore['wallet'],
    });
    const out = html(createElement(PokerWalletCard, { wallet: w }));
    expect(out).toContain('wallet-card__granted');
    expect(out).toMatch(/2[\s ,.']?000[\s ,.']?000/);   // locale-formatted 2,000,000
  });
});

describe('affordability follows the SAME store (no second balance)', () => {
  const capture = () => {
    const seen: unknown[] = [];
    return { seen, onChange: (s: unknown) => { seen.push(s); } };
  };

  it('a balance below the buy-in reports NOT affordable', () => {
    const c = capture();
    html(createElement(PokerStakesPicker, {
      wallet: store({ wallet: { balance: 10, canClaimToday: false, nextClaimAt: null } as PokerWalletStore['wallet'] }),
      onChange: c.onChange,
    }));
    // The picker renders the shortfall warning from the shared balance.
    const out = html(createElement(PokerStakesPicker, {
      wallet: store({ wallet: { balance: 10, canClaimToday: false, nextClaimAt: null } as PokerWalletStore['wallet'] }),
      onChange: () => {},
    }));
    expect(out).toContain('is-short');
    expect(out).toContain('poker-stakes__warn');
  });

  it('a balance at/above the buy-in drops the shortfall warning', () => {
    const out = html(createElement(PokerStakesPicker, {
      wallet: store({ wallet: { balance: 10_000_000, canClaimToday: false, nextClaimAt: null } as PokerWalletStore['wallet'] }),
      onChange: () => {},
    }));
    expect(out).not.toContain('is-short');
  });

  it('signed-out and economy-unavailable are surfaced by the picker too', () => {
    const so = html(createElement(PokerStakesPicker, { wallet: store({ phase: 'signed_out', wallet: null }), onChange: () => {} }));
    const ne = html(createElement(PokerStakesPicker, { wallet: store({ phase: 'no_economy', wallet: null }), onChange: () => {} }));
    expect(so).toContain('poker-stakes__warn');
    expect(ne).toContain('poker-stakes__warn');
    // With no balance at all there is no balance line to disagree with the card.
    expect(so).not.toContain('poker-stakes__balance');
  });
});

describe('placement wiring', () => {
  const startMenu = readFileSync(join(process.cwd(), 'src/ui/StartMenu.tsx'), 'utf8');
  const profile = readFileSync(join(process.cwd(), 'src/ui/ProfileMenu.tsx'), 'utf8');
  const picker = readFileSync(join(process.cwd(), 'src/ui/poker/PokerStakesPicker.tsx'), 'utf8');

  it('Profile no longer renders (or imports) the wallet panel', () => {
    expect(profile).not.toContain('PokerWalletPanel');
    expect(profile).not.toContain('wallet-card');
    expect(existsSync(join(process.cwd(), 'src/ui/components/PokerWalletPanel.tsx'))).toBe(false);
  });

  it('the start menu shows the wallet in the Poker branch, above the stakes picker', () => {
    expect(startMenu).toContain('<PokerWalletCard wallet={pokerWallet} />');
    const cardAt = startMenu.indexOf('<PokerWalletCard');
    const pickerAt = startMenu.indexOf('<PokerStakesPicker');
    expect(cardAt).toBeGreaterThan(-1);
    expect(pickerAt).toBeGreaterThan(cardAt);
  });

  it('ONE shared store feeds both (no independent fetch in the picker)', () => {
    expect(startMenu).toContain('usePokerWallet(');
    expect(startMenu.match(/usePokerWallet\(/g) ?? []).toHaveLength(1);
    expect(startMenu).toContain('<PokerStakesPicker wallet={pokerWallet}');
    // The picker must not call the wallet API itself any more.
    expect(picker).not.toContain('fetchPokerWallet');
    expect(picker).not.toContain('pokerWalletApi');
  });

  it('the wallet is fetched only while the Poker host flow is open', () => {
    expect(startMenu).toMatch(/usePokerWallet\(account\.base, account\.signedIn, pane === 'host' && gameType === 'poker'\)/);
  });
});
