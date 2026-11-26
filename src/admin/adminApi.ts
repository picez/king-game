// Admin client fetch layer (Stage 44.0). Same origin as the game API: in production
// the server serves /admin itself; in dev the Vite client reaches the server through
// the same VITE_WS_URL / custom-server rule the menu uses.

import { apiBaseFromWsUrl } from '../net/profileApi';
import { loadCustomServer, resolveServerUrl } from '../net/connection';

const ENV_WS_URL = (import.meta.env as Record<string, string | undefined>).VITE_WS_URL;

export function adminBase(): string {
  return apiBaseFromWsUrl(resolveServerUrl(loadCustomServer(), ENV_WS_URL));
}

export class AdminApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${adminBase()}/api/admin${path}`, {
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new AdminApiError(0, 'network');
  }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new AdminApiError(res.status, (data as { error?: string } | null)?.error ?? `http_${res.status}`);
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'DELETE', body: JSON.stringify(body) });

/** Human Ukrainian text for a server error code. */
export function errorText(e: unknown): string {
  const code = e instanceof AdminApiError ? e.code : 'unknown';
  const map: Record<string, string> = {
    network: 'Немає зв’язку з сервером.',
    rate_limited: 'Забагато дій за хвилину — зачекайте трохи.',
    cannot_target_self: 'Цю дію не можна застосувати до себе.',
    cannot_target_admin: 'Цю дію не можна застосувати до іншого адміністратора.',
    already_banned: 'Гравця вже забанено.',
    not_banned: 'Гравця не забанено.',
    confirm_mismatch: 'Підтвердження не збігається з ніком.',
    insufficient_chips: 'Недостатньо фішок для списання.',
    invalid_amount: 'Некоректна сума.',
    guest_has_no_wallet: 'У гостя немає гаманця фішок.',
    reason_required: 'Вкажіть причину.',
    cannot_reply: 'Відповісти не можна (гість без акаунта або відповідь вже є).',
    too_soon: 'Розсилки — не частіше ніж раз на 10 хвилин.',
    daily_limit: 'Досягнуто ліміту розсилок за добу (10).',
    no_recipients: 'Немає отримувачів.',
    empty_text: 'Порожній текст.',
    room_not_found: 'Кімнату вже закрито.',
    nothing_to_clear: 'Активного оголошення немає.',
    nothing_to_reset: 'Немає статистики для скидання.',
    not_found: 'Не знайдено.',
    db_disabled: 'База даних не налаштована (DATABASE_URL).',
    db_error: 'База даних тимчасово недоступна.',
    migration_required: 'Потрібно застосувати міграції бази даних.',
  };
  return map[code] ?? `Помилка: ${code}`;
}

export const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export const fmtDay = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('uk-UA', { dateStyle: 'medium' }) : '—';

export const GAME_LABEL: Record<string, string> = {
  king: 'Кінг', durak: 'Дурак', deberc: 'Деберц', tarneeb: 'Тарніб', 'tarneeb-solo': 'Тарніб соло',
  preferans: 'Преферанс', 'fifty-one': '51', poker: 'Покер',
};
