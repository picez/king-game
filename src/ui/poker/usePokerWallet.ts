// ---------------------------------------------------------------------------
// ONE shared poker-wallet store (Stage 38.0.2). Before this, the Profile panel and
// the stakes picker each fetched `/api/me/poker-wallet` independently, so two copies
// of the balance could disagree (a claim in one did not refresh the other).
//
// The menu now owns a SINGLE instance of this hook and hands the same store to the
// wallet card and to `PokerStakesPicker`, so a successful claim updates the balance
// AND the buy-in affordability in the same render — no manual reload.
//
// The economy stays SERVER-authoritative: this hook never computes a balance and
// never decides eligibility; it only mirrors what the server returned. `no_economy`
// is reported ONLY for a real 503 (see `pokerWalletApi.reasonFor`).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPokerWallet, claimDailyChips } from '../../net/pokerWalletApi';
import type { PokerWalletView } from '../../net/pokerWallet';

export type PokerWalletPhase = 'idle' | 'loading' | 'ready' | 'signed_out' | 'no_economy' | 'error';

export interface PokerWalletStore {
  phase: PokerWalletPhase;
  /** The server's wallet view — non-null only while `phase === 'ready'`. */
  wallet: PokerWalletView | null;
  /** True right after a claim that the SERVER reported as granted. */
  justClaimed: boolean;
  claiming: boolean;
  reload: () => void;
  claim: () => void;
}

/**
 * @param enabled gate the network call to the screens that actually show the wallet
 *                (the Poker host flow), so opening the menu never hits the API.
 */
export function usePokerWallet(base: string, signedIn: boolean, enabled = true): PokerWalletStore {
  const [phase, setPhase] = useState<PokerWalletPhase>('idle');
  const [wallet, setWallet] = useState<PokerWalletView | null>(null);
  const [justClaimed, setJustClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!enabled) { setPhase('idle'); setWallet(null); return; }
    if (!signedIn) { setPhase('signed_out'); setWallet(null); return; }
    setPhase('loading');
    setJustClaimed(false);
    const r = await fetchPokerWallet(base);
    if (!alive.current) return;
    if (r.ok) { setWallet(r.wallet); setPhase('ready'); }
    else { setWallet(null); setPhase(r.reason === 'signed_out' ? 'signed_out' : r.reason === 'no_economy' ? 'no_economy' : 'error'); }
  }, [base, signedIn, enabled]);

  useEffect(() => { void load(); }, [load]);

  const claim = useCallback(async () => {
    setClaiming(true);
    const r = await claimDailyChips(base);
    if (!alive.current) return;
    setClaiming(false);
    if (r.ok) {
      // The server is the authority on BOTH the new balance and whether it granted.
      setWallet(r.claim);
      setJustClaimed(r.claim.granted);
      setPhase('ready');
    } else {
      setWallet(null);
      setJustClaimed(false);
      setPhase(r.reason === 'signed_out' ? 'signed_out' : r.reason === 'no_economy' ? 'no_economy' : 'error');
    }
  }, [base]);

  return {
    phase, wallet, justClaimed, claiming,
    reload: () => { void load(); },
    claim: () => { void claim(); },
  };
}
