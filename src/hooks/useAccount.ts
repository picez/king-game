import { useCallback, useEffect, useState } from 'react';
import {
  apiBaseFromWsUrl, fetchMe, ensureGuestSession,
  updateProfile, updateSettings, fetchKingSettings, updateKingSettings,
  logout as logoutApi, googleStartUrl, type MeResponse,
} from '../net/profileApi';
import { loadGuestKey, saveGuestKey } from '../net/prefs';
import type { Lang } from '../i18n';
import type { CardStyle, AnimationPreference } from '../net/userSettings';

export interface SaveProgressInput {
  name: string; avatar: string; lang: Lang; defaultTimer: number;
  cardStyle: CardStyle; animationPreference: AnimationPreference;
}

/**
 * Shared account/identity state for the menu (Stage 7.1). Lifted out of the old
 * AccountPanel so the top AccountBar (sign-in/out + status) and the Profile
 * settings sheet (nickname/avatar/language/timer) read ONE `me` and never drift.
 * SOFT: with no API/DB every value degrades to a guest/local view and nothing
 * blocks. Handles the OAuth `?login` redirect once, on mount.
 */
export interface Account {
  base: string;
  me: MeResponse | null;
  /** True when /api/me responded (DB on). False = no DB/offline → local only. */
  apiReachable: boolean;
  hasSession: boolean;
  isGuest: boolean;
  signedIn: boolean;
  displayName: string | null;
  email: string | null;
  /** Server's King default timer (cross-device), or null. */
  serverTimer: number | null;
  banner: 'success' | 'error' | null;
  clearBanner: () => void;
  syncing: boolean;
  googleUrl: string;
  hydrate: () => Promise<void>;
  saveProgress: (input: SaveProgressInput) => Promise<void>;
  logout: () => Promise<void>;
  // Push a single field to the server when there is a session (else a no-op).
  pushName: (v: string) => void;
  pushAvatar: (v: string) => void;
  pushLang: (v: Lang) => void;
  pushTimer: (v: number) => void;
  pushCardStyle: (v: CardStyle) => void;
  pushAnimation: (v: AnimationPreference) => void;
}

export function useAccount(serverUrl: string): Account {
  const base = apiBaseFromWsUrl(serverUrl);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [serverTimer, setServerTimer] = useState<number | null>(null);
  const [banner, setBanner] = useState<'success' | 'error' | null>(null);
  const [syncing, setSyncing] = useState(false);

  const hydrate = useCallback(async () => {
    const m = await fetchMe(base);
    setMe(m); // null when unreachable / DB disabled
    if (m?.authenticated) {
      const king = await fetchKingSettings(base);
      if (king) setServerTimer(king.defaultTimer);
    }
  }, [base]);

  // Mount: consume the OAuth ?login redirect (banner + strip), then hydrate.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const login = params.get('login');
      if (login === 'success' || login === 'error') {
        setBanner(login);
        params.delete('login');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
      }
    }
    void hydrate();
  }, [hydrate]);

  const apiReachable = me !== null;
  const hasSession = !!me?.authenticated && !!me?.user;
  const isGuest = hasSession && me?.user?.isGuest === true;
  const signedIn = hasSession && !!me?.provider;

  const logout = useCallback(async () => {
    await logoutApi(base);
    setBanner(null);
    setMe({ authenticated: false, user: null });
  }, [base]);

  const saveProgress = useCallback(async (input: SaveProgressInput) => {
    setSyncing(true);
    try {
      const res = await ensureGuestSession(base, loadGuestKey());
      if (!res) return; // API unavailable — stays local
      saveGuestKey(res.guestKey);
      await updateProfile(base, input.name);
      await updateSettings(base, {
        lang: input.lang, avatar: input.avatar,
        cardStyle: input.cardStyle, animationPreference: input.animationPreference,
      });
      await updateKingSettings(base, { defaultTimer: input.defaultTimer });
      await hydrate();
    } finally {
      setSyncing(false);
    }
  }, [base, hydrate]);

  const pushName = useCallback((v: string) => { if (hasSession) void updateProfile(base, v); }, [base, hasSession]);
  const pushAvatar = useCallback((v: string) => { if (hasSession) void updateSettings(base, { avatar: v }); }, [base, hasSession]);
  const pushLang = useCallback((v: Lang) => { if (hasSession) void updateSettings(base, { lang: v }); }, [base, hasSession]);
  const pushTimer = useCallback((v: number) => { if (hasSession) void updateKingSettings(base, { defaultTimer: v }); }, [base, hasSession]);
  const pushCardStyle = useCallback((v: CardStyle) => { if (hasSession) void updateSettings(base, { cardStyle: v }); }, [base, hasSession]);
  const pushAnimation = useCallback((v: AnimationPreference) => { if (hasSession) void updateSettings(base, { animationPreference: v }); }, [base, hasSession]);

  return {
    base, me, apiReachable, hasSession, isGuest, signedIn,
    displayName: me?.user?.displayName ?? null, email: me?.email ?? null, serverTimer,
    banner, clearBanner: () => setBanner(null), syncing, googleUrl: googleStartUrl(base),
    hydrate, saveProgress, logout, pushName, pushAvatar, pushLang, pushTimer, pushCardStyle, pushAnimation,
  };
}
