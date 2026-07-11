import { useCallback, useEffect, useState } from 'react';
import {
  apiBaseFromWsUrl, fetchMe, ensureGuestSession,
  updateProfile, updateSettings, fetchKingSettings, updateKingSettings,
  logout as logoutApi, googleStartUrl, type MeResponse, type MeProbe,
} from '../net/profileApi';
import { uploadAvatar, deleteServerAvatar, type AvatarUploadResult } from '../net/avatarApi';
import type { AccountDiagnostics } from '../net/accountDiagnostics';
import { loadGuestKey, saveGuestKey } from '../net/prefs';
import type { Lang } from '../i18n';
import type { CardStyle, AnimationPreference, FavoriteGame, CardFaceTheme } from '../net/userSettings';

export interface SaveProgressInput {
  name: string; avatar: string; lang: Lang; defaultTimer: number;
  cardStyle: CardStyle; animationPreference: AnimationPreference; favoriteGame: FavoriteGame;
  cardFaceTheme: CardFaceTheme;
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
  /** Sign-in / account service is available here (a 200 from /api/me — DB on).
   *  Back-compat alias of `authAvailable`; gates the sync-profile / push helpers. */
  apiReachable: boolean;
  /** The origin answered at all (even a 503) — distinguishes "server down" from
   *  "server up but sign-in disabled". False = network/CORS failure / wrong URL. */
  serverReachable: boolean;
  /** Sign-in is possible here (a 200 from /api/me). */
  authAvailable: boolean;
  /** True until the first /api/me settles — so the UI shows a neutral "checking"
   *  state instead of flashing "Guest" (and hiding sign-in) before it is known. */
  loading: boolean;
  /** Re-probe /api/me (recovery action after a transient failure). */
  retry: () => void;
  /** Debug-safe connection diagnostics (mode / origin / status / code) — no secrets. */
  diagnostics: AccountDiagnostics;
  hasSession: boolean;
  isGuest: boolean;
  signedIn: boolean;
  displayName: string | null;
  email: string | null;
  /** Server's King default timer (cross-device), or null. */
  serverTimer: number | null;
  /**
   * Uploaded synced-avatar URL (Stage 17.2): same-origin `/api/avatar/<id>.webp?v=n`,
   * or null. DISTINCT from the OAuth provider picture. Shown only on "me" surfaces.
   */
  avatarImageUrl: string | null;
  banner: 'success' | 'error' | null;
  clearBanner: () => void;
  syncing: boolean;
  googleUrl: string;
  hydrate: () => Promise<void>;
  saveProgress: (input: SaveProgressInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Upload a synced avatar (signed-in only); re-hydrates on success. */
  uploadAvatarImage: (file: File) => Promise<AvatarUploadResult>;
  /** Remove the synced avatar; re-hydrates on success. */
  removeAvatarImage: () => Promise<boolean>;
  // Push a single field to the server when there is a session (else a no-op).
  pushName: (v: string) => void;
  pushAvatar: (v: string) => void;
  pushLang: (v: Lang) => void;
  pushTimer: (v: number) => void;
  pushCardStyle: (v: CardStyle) => void;
  pushAnimation: (v: AnimationPreference) => void;
  pushFavoriteGame: (v: FavoriteGame) => void;
  pushCardFaceTheme: (v: CardFaceTheme) => void;
}

export function useAccount(serverUrl: string, customServer: string | null = null): Account {
  const base = apiBaseFromWsUrl(serverUrl);
  // The whole classified /api/me probe (identity + reachability), so the UI can tell
  // "not signed in" apart from "server unreachable" vs "sign-in disabled here".
  const [probe, setProbe] = useState<MeProbe | null>(null);
  const [serverTimer, setServerTimer] = useState<number | null>(null);
  const [banner, setBanner] = useState<'success' | 'error' | null>(null);
  const [syncing, setSyncing] = useState(false);
  // False until the first /api/me settles (reachable or not). Prevents a premature
  // "Guest" flash + a hidden sign-in button while the identity is still unknown.
  const [loaded, setLoaded] = useState(false);

  const hydrate = useCallback(async () => {
    try {
      const p = await fetchMe(base);
      setProbe(p); // classified: me / serverReachable / authAvailable / status
      if (p.me?.authenticated) {
        const king = await fetchKingSettings(base);
        if (king) setServerTimer(king.defaultTimer);
      }
    } finally {
      setLoaded(true);
    }
  }, [base]);

  // Recovery action: show the neutral "checking" state, then re-probe /api/me. Used
  // by the Retry button when the server was unreachable (or after a server switch).
  const retry = useCallback(() => { setLoaded(false); void hydrate(); }, [hydrate]);

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

  const me = probe?.me ?? null;
  const serverReachable = probe?.serverReachable ?? false;
  const authAvailable = probe?.authAvailable ?? false;
  const apiReachable = authAvailable; // back-compat alias (== a 200 from /api/me)
  const hasSession = !!me?.authenticated && !!me?.user;
  const isGuest = hasSession && me?.user?.isGuest === true;
  const signedIn = hasSession && !!me?.provider;

  // Debug-safe connection diagnostics: WHERE the API is called + WHAT it answered.
  // Only metadata (mode / origin / status / code) — never cookies/tokens/email.
  const pageOrigin = typeof window !== 'undefined' ? window.location.origin : null;
  const diagnostics: AccountDiagnostics = {
    connectionMode: customServer ? 'custom' : 'default',
    apiBase: base,
    pageOrigin,
    sameOrigin: !!pageOrigin && base === pageOrigin,
    endpoint: probe?.endpoint ?? '/api/me',
    status: probe ? probe.status : null,
    networkError: probe ? probe.status === 0 : false,
    code: probe?.code ?? null,
    serverReachable,
    authAvailable,
  };

  const logout = useCallback(async () => {
    await logoutApi(base);
    setBanner(null);
    // Stay on the reachable+auth-available server; just clear the identity.
    setProbe({ me: { authenticated: false, user: null }, serverReachable: true, authAvailable: true, status: 200, code: null, endpoint: '/api/me' });
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
        favoriteGame: input.favoriteGame, cardFaceTheme: input.cardFaceTheme,
      });
      await updateKingSettings(base, { defaultTimer: input.defaultTimer });
      await hydrate();
    } finally {
      setSyncing(false);
    }
  }, [base, hydrate]);

  // Synced avatar (Stage 17.2): upload/remove go through the DEDICATED multipart /
  // DELETE endpoints (never PATCH /api/settings), then re-hydrate so `me.avatarImageUrl`
  // (and the "me" surfaces) refresh. The emoji `avatar` + OAuth `avatarUrl` are untouched.
  const uploadAvatarImage = useCallback(async (file: File): Promise<AvatarUploadResult> => {
    const res = await uploadAvatar(base, file);
    if (res.ok) await hydrate();
    return res;
  }, [base, hydrate]);
  const removeAvatarImage = useCallback(async (): Promise<boolean> => {
    const ok = await deleteServerAvatar(base);
    if (ok) await hydrate();
    return ok;
  }, [base, hydrate]);

  const pushName = useCallback((v: string) => { if (hasSession) void updateProfile(base, v); }, [base, hasSession]);
  const pushAvatar = useCallback((v: string) => { if (hasSession) void updateSettings(base, { avatar: v }); }, [base, hasSession]);
  const pushLang = useCallback((v: Lang) => { if (hasSession) void updateSettings(base, { lang: v }); }, [base, hasSession]);
  const pushTimer = useCallback((v: number) => { if (hasSession) void updateKingSettings(base, { defaultTimer: v }); }, [base, hasSession]);
  const pushCardStyle = useCallback((v: CardStyle) => { if (hasSession) void updateSettings(base, { cardStyle: v }); }, [base, hasSession]);
  const pushAnimation = useCallback((v: AnimationPreference) => { if (hasSession) void updateSettings(base, { animationPreference: v }); }, [base, hasSession]);
  const pushFavoriteGame = useCallback((v: FavoriteGame) => { if (hasSession) void updateSettings(base, { favoriteGame: v }); }, [base, hasSession]);
  const pushCardFaceTheme = useCallback((v: CardFaceTheme) => { if (hasSession) void updateSettings(base, { cardFaceTheme: v }); }, [base, hasSession]);

  return {
    base, me, apiReachable, serverReachable, authAvailable, loading: !loaded, retry, diagnostics,
    hasSession, isGuest, signedIn,
    displayName: me?.user?.displayName ?? null, email: me?.email ?? null, serverTimer,
    avatarImageUrl: me?.avatarImageUrl ?? null,
    banner, clearBanner: () => setBanner(null), syncing, googleUrl: googleStartUrl(base),
    hydrate, saveProgress, logout, uploadAvatarImage, removeAvatarImage,
    pushName, pushAvatar, pushLang, pushTimer, pushCardStyle, pushAnimation, pushFavoriteGame, pushCardFaceTheme,
  };
}
