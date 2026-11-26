// ---------------------------------------------------------------------------
// Player-side client for complaints & suggestions, the inbox and the site
// announcement (Stage 44.0). SOFT like profileApi: never throws; a missing DB /
// network failure resolves to an empty/null result and the menu simply hides
// the surface.
// ---------------------------------------------------------------------------

import type { Announcement, FeedbackKind, InboxResponse, MyFeedbackItem } from './admin';

async function call<T>(base: string, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(`${base}${path}`, {
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
    let data: T | null = null;
    try { data = (await res.json()) as T; } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export async function fetchAnnouncement(base: string): Promise<Announcement | null> {
  const r = await call<{ announcement: Announcement | null }>(base, '/api/announcement');
  return r.ok ? r.data?.announcement ?? null : null;
}

export interface FeedbackDraft {
  kind: FeedbackKind;
  text: string;
  aboutPlayer?: string;
  roomCode?: string;
  gameType?: string;
  context?: Record<string, string>;
}

export type SendFeedbackResult = 'ok' | 'too_many' | 'banned' | 'invalid' | 'no_session' | 'unavailable';

export async function sendFeedback(base: string, draft: FeedbackDraft): Promise<SendFeedbackResult> {
  const r = await call<{ error?: string }>(base, '/api/feedback', { method: 'POST', body: JSON.stringify(draft) });
  if (r.ok) return 'ok';
  if (r.status === 429) return 'too_many';
  if (r.status === 403) return 'banned';
  if (r.status === 400) return 'invalid';
  if (r.status === 401) return 'no_session';
  return 'unavailable';
}

export async function fetchMyFeedback(base: string): Promise<MyFeedbackItem[]> {
  const r = await call<{ items: MyFeedbackItem[] }>(base, '/api/me/feedback');
  return r.ok ? r.data?.items ?? [] : [];
}

export async function fetchInbox(base: string): Promise<InboxResponse> {
  const r = await call<InboxResponse>(base, '/api/me/inbox');
  return r.ok && r.data ? r.data : { items: [], unread: 0 };
}

export async function markInboxRead(base: string): Promise<void> {
  await call(base, '/api/me/inbox/read', { method: 'POST' });
}

/** The dismissed announcement id lives on the device: a NEW announcement shows again. */
const DISMISS_KEY = 'cm.announcementDismissed';
export function isAnnouncementDismissed(id: string): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === id; } catch { return false; }
}
export function dismissAnnouncement(id: string): void {
  try { localStorage.setItem(DISMISS_KEY, id); } catch { /* private mode */ }
}
