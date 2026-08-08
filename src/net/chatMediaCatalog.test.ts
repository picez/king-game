// Generated chat-media whitelist catalog (Stage 11.0). Guards the security-
// relevant invariants: supported extensions only, unique ids, same-origin src,
// no path traversal, safe labels. If scripts/gen-chat-media.mjs regenerates the
// catalog these must still hold.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CHAT_MEDIA, getChatMedia } from './chatMediaCatalog';

const ALLOWED_EXT = ['.gif', '.png', '.jpg', '.jpeg', '.webp'];
// Built from \u escapes so this source file embeds no raw control bytes.
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F]');

const MEDIA_DIR = join(process.cwd(), 'public', 'chat-media');
/** Kept in sync with scripts/gen-chat-media.mjs — the importer never copies more. */
const MAX_FILE_BYTES = 100 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const fileOf = (m: { src: string }) => join(MEDIA_DIR, m.src.replace('/chat-media/', ''));

// The catalog the picker shipped with before Stage 38.0.11, in order. New media
// is APPENDED, so these ids and their positions must never move or disappear —
// a room's chat history references a sticker by id alone.
const LEGACY_IDS = `
  burn bit eat heart nyabeach nyabeanie nyabee nyablush nyablushing nyaboba3 nyaboba-1
  nyabored nyabored2 nyabreakfast nyabrush nyabully nyaburger nyabutt nyacake nyacheer
  nyachick nyachicks nyachill nyachill1 nyachill2 nyachips nyachips-1 nyachonk nyachonk1
  nyachonk2 nyaclover nyacold nyacomfy nyacook2 nyacool nyacozy nyacozy1 nyacry nyacry1
  nyacryinpain nyacute1 nyacute2 nyacute3 nyacute4 nyacuteaww nyacutebunny nyacutecat
  nyacutepaws nyadance nyaded nyadevil nyadonut nyadonut2 nyadonut3 nyadraw nyadrool nyaeat
  nyaeeh nyaeggtoast nyaevilqueen nyaexercise nyafan nyafan2 nyaflick nyaflick2 nyaflowers
  nyafries nyaghost1 nyaghost2 nyagingerbread nyaglasses nyaglasses-1 nyagraduation nyahappy
  nyaheart nyahearts nyahehe nyahelp nyahmph1 nyahmph2 nyahungry nyahype nyahype2 nyahyperspin
  nyahyperyay nyaily nyaicecream nyaicecream1 nyaicecream2 nyaignorework nyajam nyakfc yay
`.trim().split(/\s+/);

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

  it('keeps every legacy id, in its original order, at the head of the catalog', () => {
    expect(CHAT_MEDIA.length).toBeGreaterThanOrEqual(LEGACY_IDS.length);
    expect(CHAT_MEDIA.slice(0, LEGACY_IDS.length).map((m) => m.id)).toEqual(LEGACY_IDS);
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

// The files behind the catalog (Stage 38.0.11 — incremental GIF import). These
// guard what the importer promises: one entry per real file, no picture twice,
// no runaway asset weight, and animation preserved (the assets are copied byte
// for byte, never re-encoded).
describe('chat-media assets on disk', () => {
  const files = readdirSync(MEDIA_DIR).sort();

  it('every catalog entry points at a real file, and every file is catalogued', () => {
    for (const m of CHAT_MEDIA) expect(existsSync(fileOf(m)), m.src).toBe(true);
    const referenced = CHAT_MEDIA.map((m) => m.src.replace('/chat-media/', ''));
    expect(new Set(referenced).size, 'two entries share one file').toBe(referenced.length);
    expect([...referenced].sort()).toEqual(files);
  });

  it('the filename is the id plus its extension', () => {
    for (const m of CHAT_MEDIA) {
      expect(m.src.replace('/chat-media/', '').replace(/\.[a-z0-9]+$/, ''), m.src).toBe(m.id);
    }
  });

  it('holds no duplicate picture under two ids (content hash)', () => {
    const byHash = new Map<string, string>();
    for (const m of CHAT_MEDIA) {
      const hash = createHash('sha256').update(readFileSync(fileOf(m))).digest('hex');
      expect(byHash.has(hash), `${m.id} duplicates ${byHash.get(hash)}`).toBe(false);
      byHash.set(hash, m.id);
    }
  });

  it('stays inside the per-file and total asset budget', () => {
    let total = 0;
    for (const m of CHAT_MEDIA) {
      const size = statSync(fileOf(m)).size;
      expect(size, `${m.src} is empty`).toBeGreaterThan(0);
      expect(size, `${m.src} = ${size}B over ${MAX_FILE_BYTES}B`).toBeLessThanOrEqual(MAX_FILE_BYTES);
      total += size;
    }
    expect(total, `total ${total}B over ${MAX_TOTAL_BYTES}B`).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('every gif is a real, still-animated GIF (never flattened to one frame)', () => {
    for (const m of CHAT_MEDIA.filter((x) => x.type === 'gif')) {
      const bytes = readFileSync(fileOf(m));
      expect(['GIF87a', 'GIF89a'], m.src).toContain(bytes.subarray(0, 6).toString('latin1'));
      // One Graphic Control Extension (21 F9 04) per frame — 2+ means animated.
      let frames = 0;
      for (let i = 0; i < bytes.length - 2; i++) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
      }
      expect(frames, `${m.src} has ${frames} frame(s)`).toBeGreaterThanOrEqual(2);
    }
  });

  it('every image entry is a real PNG', () => {
    for (const m of CHAT_MEDIA.filter((x) => x.src.endsWith('.png'))) {
      expect(readFileSync(fileOf(m)).subarray(0, 8).toString('hex'), m.src).toBe('89504e470d0a1a0a');
    }
  });
});
