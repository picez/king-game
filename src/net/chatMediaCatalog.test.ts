// Generated chat-media whitelist catalog (Stage 11.0). Guards the security-
// relevant invariants: supported extensions only, unique ids, same-origin src,
// no path traversal, safe labels. If scripts/gen-chat-media.mjs regenerates the
// catalog these must still hold.
import { describe, it, expect } from 'vitest';
import { CHAT_MEDIA, getChatMedia } from './chatMediaCatalog';

const ALLOWED_EXT = ['.gif', '.png', '.jpg', '.jpeg', '.webp'];
// Built from \u escapes so this source file embeds no raw control bytes.
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F]');

describe('chatMediaCatalog', () => {
  it('is non-empty', () => {
    expect(CHAT_MEDIA.length).toBeGreaterThan(0);
  });

  it('every src is a same-origin /chat-media/ path with a supported extension', () => {
    for (const m of CHAT_MEDIA) {
      expect(m.src.startsWith('/chat-media/'), m.src).toBe(true);
      expect(ALLOWED_EXT.some((e) => m.src.toLowerCase().endsWith(e)), m.src).toBe(true);
    }
  });

  it('has no path traversal / absolute / scheme / backslash in any src', () => {
    for (const m of CHAT_MEDIA) {
      expect(m.src.includes('..'), m.src).toBe(false);
      expect(m.src.includes('\\'), m.src).toBe(false);
      expect(/^https?:|^data:|^\/\//i.test(m.src), m.src).toBe(false);
      // Exactly one path segment after the folder (no nested dirs).
      expect(m.src.split('/').length).toBe(3); // '', 'chat-media', 'file.ext'
    }
  });

  it('has unique ids', () => {
    const ids = CHAT_MEDIA.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ids are ascii slugs (lowercase, [a-z0-9-])', () => {
    for (const m of CHAT_MEDIA) {
      expect(/^[a-z0-9-]+$/.test(m.id), m.id).toBe(true);
    }
  });

  it('type is gif|image and matches the extension', () => {
    for (const m of CHAT_MEDIA) {
      expect(['gif', 'image']).toContain(m.type);
      const isGif = m.src.toLowerCase().endsWith('.gif');
      expect(m.type).toBe(isGif ? 'gif' : 'image');
    }
  });

  it('labels are safe (no HTML/control chars, non-empty)', () => {
    for (const m of CHAT_MEDIA) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(/[<>&"'`]/.test(m.label), m.label).toBe(false);
      expect(CONTROL.test(m.label), m.label).toBe(false);
    }
  });

  it('getChatMedia resolves a valid id and rejects anything else', () => {
    const first = CHAT_MEDIA[0];
    expect(getChatMedia(first.id)).toEqual(first);
    expect(getChatMedia('nope-unknown-id')).toBeNull();
    expect(getChatMedia('')).toBeNull();
    expect(getChatMedia(null)).toBeNull();
    expect(getChatMedia(123 as unknown)).toBeNull();
    expect(getChatMedia({ id: first.id } as unknown)).toBeNull();
  });
});
