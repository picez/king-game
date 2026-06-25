// ---------------------------------------------------------------------------
// Room social: reaction whitelist + chat sanitisation / profanity filter (pure).
//
// NO React, NO DB, NO Node — plain data + functions, so the security-critical
// bits run identically on the SERVER (authoritative) and can be unit-tested
// without a network. The server NEVER trusts the client: it re-runs this filter
// and the cooldown/rate checks before broadcasting.
//
// HONEST SCOPE: a small blocklist cannot perfectly cover "all languages" or every
// obfuscation. This is a layered MVP: (1) normalise (NFKC, strip control chars,
// collapse repeats, de-leet) -> (2) blocklist (EN/UK/RU/DE/AR base roots) ->
// (3) censor matches with "***" -> (4) cap length -> (5) strip URLs -> "[link]".
// Rate limiting + cooldown live as pure timestamp helpers used by the server.
//
// Regexes touching control/combining/script ranges are built from \u-escaped
// strings (pure ASCII source) so the module never embeds raw control bytes.
// ---------------------------------------------------------------------------

/** Max length of a chat message after sanitisation. */
export const MAX_CHAT_LEN = 160;

/** Reaction cooldown / chat rate-limit windows (ms) -- enforced SERVER-side. */
export const REACTION_COOLDOWN_MS = 30_000;
export const CHAT_RATE_MS = 3_000;

/** The only emojis a client may send as a reaction (anti-abuse: no free text). */
export const REACTIONS = ['\u{1F44D}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F621}', '\u{1F44F}', '❤️'] as const;
export type Reaction = (typeof REACTIONS)[number];

export function isValidReaction(e: unknown): e is Reaction {
  return typeof e === 'string' && (REACTIONS as readonly string[]).includes(e);
}

/**
 * Remaining cooldown in ms for an action (0 = allowed now). Pure: the server
 * passes the last action time + now + the window. Used for both the 30s reaction
 * cooldown and the 3s chat rate limit.
 */
export function cooldownRemainingMs(lastMs: number | undefined | null, nowMs: number, windowMs: number): number {
  if (lastMs == null) return 0;
  const elapsed = nowMs - lastMs;
  return elapsed >= windowMs ? 0 : windowMs - elapsed;
}

// -- profanity / sanitisation -----------------------------------------------

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const CONTROL_RE = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');
const DIACRITIC_RE = new RegExp('[\\u0300-\\u036F]', 'g');
// Keep latin + cyrillic + arabic letters for matching; drop everything else.
const NON_LETTER_RE = new RegExp('[^a-z\\u0400-\\u04FF\\u0600-\\u06FF]', 'g');
const REPEAT_RE = /(.)\1{1,}/g;
const LEET_RE = /[0-9@$!|]/g;

/** Leetspeak -> letter, for MATCHING only (never shown to users). */
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '|': 'i',
};

/**
 * Base profanity roots (substring match on a normalised token). NON-EXHAUSTIVE
 * and intentionally small -- clearly-profane roots across EN/UK/RU/DE/AR. Kept
 * short to limit false positives; the layered normaliser catches simple
 * obfuscation (repeats, leetspeak, diacritics).
 */
const BLOCKLIST: string[] = [
  // English
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy', 'bastard', 'nigger', 'faggot', 'whore', 'slut',
  // German
  'scheisse', 'arschloch', 'fotze', 'wichser', 'hurensohn',
  // Ukrainian / Russian (translit + cyrillic roots)
  'suka', 'blyad', 'blyat', 'pizda', 'mudak', 'gandon',
  'сука', 'бля', 'пизд', 'хуй', 'ебан',
  // Arabic
  'عاهرة', 'كلب', 'خرا',
];

/** Strips diacritics, lowercases, de-leets, removes non-letters, collapses runs. */
function normalizeForMatch(token: string): string {
  let s = token.normalize('NFKD').replace(DIACRITIC_RE, '').toLowerCase();
  s = s.replace(LEET_RE, (c) => LEET[c] ?? '');
  s = s.replace(NON_LETTER_RE, '');
  s = s.replace(REPEAT_RE, '$1'); // collapse repeated chars: "fuuuck" -> "fuk"
  return s;
}

// The roots normalised the SAME way (so collapsing repeats on input — e.g.
// "asshole" -> "ashole" — still matches; the blocklist root is collapsed too).
const BLOCKLIST_NORM = BLOCKLIST.map(normalizeForMatch).filter((w) => w.length >= 3);

function isBadToken(normalized: string): boolean {
  if (normalized.length < 3) return false;
  return BLOCKLIST_NORM.some((bad) => normalized.includes(bad));
}

export interface ChatFilterResult {
  /** The sanitised text to broadcast (censored). Empty when nothing remains. */
  text: string;
  /** True when there is something safe to send. */
  ok: boolean;
  /** True when any URL/profanity was replaced (do NOT log the raw input then). */
  censored: boolean;
}

/**
 * Sanitises a raw chat string for broadcast: trims/collapses whitespace, strips
 * control chars, caps length, replaces URLs with "[link]", and censors blocked
 * words with "***". Returns `ok:false` when nothing safe remains (server rejects
 * with MESSAGE_BLOCKED). Never throws.
 */
export function filterChat(raw: unknown): ChatFilterResult {
  let s = typeof raw === 'string' ? raw : '';
  s = s.normalize('NFKC').replace(CONTROL_RE, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > MAX_CHAT_LEN) s = s.slice(0, MAX_CHAT_LEN).trim();
  if (!s) return { text: '', ok: false, censored: false };

  let censored = false;
  s = s.replace(URL_RE, () => { censored = true; return '[link]'; });

  const out = s.split(' ').map((tok) => {
    if (tok === '[link]') return tok;
    if (isBadToken(normalizeForMatch(tok))) { censored = true; return '***'; }
    return tok;
  });
  s = out.join(' ').replace(/\s+/g, ' ').trim();

  if (!s) return { text: '', ok: false, censored };
  return { text: s, ok: true, censored };
}
