// ---------------------------------------------------------------------------
// Generate the Card Majlis PWA / app icons with ZERO external dependencies
// (built-in zlib only). Regenerate with:
//
//   node scripts/generate-icons.mjs   (or: npm run icons)
//
// Motif — "Card Majlis" multi-game brand, NOT King-only:
//   • an emerald circular felt "coin" (radial lit centre → dark rim) with a thin
//     gold rim, so it reads as a card-lounge medallion, not a single game;
//   • a bold gold 8-point Levantine / majlis star in the centre (bevelled) with a
//     small emerald inner ring + gold boss;
//   • four subtle gold suit pips (♠ ♥ ♦ ♣) in the diagonal gaps — the "four games".
// No text, no crown. Reads at 32 / 64 / 192 / 512 px on light or dark backgrounds.
//
// Emits (all opaque, full-bleed square so Apple/Android masks crop cleanly):
//   public/icons/icon-192.png        (manifest "any")
//   public/icons/icon-512.png        (manifest "any")
//   public/icons/maskable-512.png    (manifest "maskable" — motif in the safe zone)
//   public/icons/apple-touch-icon.png (180×180, iOS home screen)
//   public/icons/favicon-32.png      (legacy tab favicon fallback)
//   public/icons/icon.svg            (crisp vector favicon — same motif)
//
// Same procedural PNG technique as scripts/gen-visual-assets.mjs (supersampled
// for smooth edges). Palette matches src/styles/base.css.
// ---------------------------------------------------------------------------

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// ── palette (from src/styles/base.css) ──────────────────────────────────────
const FELT_LIT = [31, 122, 69], FELT_MID = [21, 95, 54], FELT_EDGE = [12, 67, 36], FELT_DEEP = [8, 43, 24];
const ACCENT = [245, 197, 24], ACCENT_LIGHT = [255, 226, 115], ACCENT_DARK = [184, 135, 10];

// ── math helpers ─────────────────────────────────────────────────────────────
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const gold = (t) => lerp3(ACCENT_DARK, ACCENT_LIGHT, clamp(t));
// triangle point-in-test (returns >0 inside, <0 outside) via edge signs
function tri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos) ? 0.06 : -1;
}
const cir = (x, y, cx, cy, r) => r - Math.hypot(x - cx, y - cy); // >0 inside

// ── suit pips (local coords ~[-1,1], y-down); return >0 inside ───────────────
const suitDiamond = (x, y) => 0.92 - (Math.abs(x) / 0.72 + Math.abs(y));
const suitHeart = (x, y) => Math.max(
  cir(x, y, -0.42, -0.22, 0.56), cir(x, y, 0.42, -0.22, 0.56),
  tri(x, y, -0.92, -0.05, 0.92, -0.05, 0, 0.98),
);
const suitSpade = (x, y) => Math.max(
  // heart flipped → point up
  cir(x, y, -0.42, 0.22, 0.56), cir(x, y, 0.42, 0.22, 0.56),
  tri(x, y, -0.92, 0.05, 0.92, 0.05, 0, -0.98),
  // stem
  (Math.abs(x) < 0.14 + Math.max(0, y) * 0.42 && y > 0.05 && y < 0.9) ? 0.06 : -1,
);
const suitClub = (x, y) => Math.max(
  cir(x, y, 0, -0.42, 0.42), cir(x, y, -0.44, 0.2, 0.42), cir(x, y, 0.44, 0.2, 0.42),
  (Math.abs(x) < 0.13 + Math.max(0, y) * 0.4 && y > -0.1 && y < 0.9) ? 0.06 : -1,
);
const SUITS = [suitSpade, suitHeart, suitDiamond, suitClub]; // one per diagonal corner

// ── the Card Majlis medallion ────────────────────────────────────────────────
// `S` scales the motif so the maskable variant lives inside the ~80% safe zone.
function majlis(nx, ny, S) {
  const dx = nx - 0.5, dy = ny - 0.5;
  const r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);

  // 1) felt ground — full-bleed opaque, radial lit centre → deep rim.
  let col = lerp3(FELT_LIT, FELT_EDGE, smooth(0.0, 0.6, r));
  col = lerp3(col, FELT_DEEP, smooth(0.62, 0.78, r)); // corner vignette

  // 2) coin: brighten inside a disc + a thin gold rim ring around the medallion.
  const coinR = 0.455 * S;
  col = lerp3(col, lerp3(col, FELT_LIT, 0.35), smooth(coinR + 0.02, coinR - 0.06, r)); // lit disc
  const rim = smooth(0.011 * S, 0.004 * S, Math.abs(r - coinR));
  col = lerp3(col, gold(0.55 + 0.35 * Math.sin(ang * 2)), clamp(rim) * 0.9);

  // 3) four suit pips in the diagonal gaps (between star tips and the rim).
  const pipR = 0.362 * S, pipScale = 0.072 * S;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2; // 45°, 135°, 225°, 315°
    const cx = 0.5 + Math.cos(a) * pipR, cy = 0.5 + Math.sin(a) * pipR;
    const lx = (nx - cx) / pipScale, ly = (ny - cy) / pipScale;
    if (Math.abs(lx) > 1.3 || Math.abs(ly) > 1.3) continue;
    const inside = SUITS[k](lx, ly);
    const fill = smooth(-0.05, 0.05, inside);
    if (fill > 0.001) col = lerp3(col, gold(0.62 - ly * 0.18), fill * 0.92);
  }

  // 4) central 8-point majlis star (Rub el Hizb) — union of two overlapping
  // squares (axis-aligned + 45°), giving straight-edged khatam points, gold + bevel.
  const sq = 0.222 * S - Math.max(Math.abs(dx), Math.abs(dy));   // axis square
  const di = 0.313 * S - (Math.abs(dx) + Math.abs(dy));          // rotated square (diamond)
  const field = Math.max(sq, di);
  const starFill = smooth(-0.004 * S, 0.004 * S, field);
  if (starFill > 0.001) {
    const bevel = clamp(0.44 + (-dy / S) * 1.0); // lighter toward top
    let g = gold(bevel);
    const edgeDark = 1 - smooth(0.006 * S, 0.03 * S, field); // dark near the outline
    g = lerp3(g, ACCENT_DARK, clamp(edgeDark) * 0.45);
    col = lerp3(col, g, starFill);
  }
  // inner emerald ring + gold centre boss (medallion filigree)
  const innerRing = smooth(0.006 * S, 0.0, Math.abs(r - 0.072 * S));
  col = lerp3(col, FELT_EDGE, clamp(innerRing) * 0.85);
  const boss = smooth(0.05 * S, 0.036 * S, r);
  col = lerp3(col, gold(0.85), clamp(boss));

  return [col[0], col[1], col[2], 255];
}

// ── PNG writer (RGBA, supersampled) ──────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function png(size, ss, fn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0; const inv = 1 / (ss * ss);
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = fn((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
        r += c[0]; g += c[1]; b += c[2]; a += c[3];
      }
      raw[p++] = clamp(r * inv, 0, 255) | 0; raw[p++] = clamp(g * inv, 0, 255) | 0;
      raw[p++] = clamp(b * inv, 0, 255) | 0; raw[p++] = clamp(a * inv, 0, 255) | 0;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ── vector favicon (same motif, computed so it matches the raster) ───────────
function buildSvg() {
  const C = 256, N = 8;               // centre, star points
  // 16-vertex star polygon matching the raster's two-squares khatam (outer 0.313,
  // inner notch 0.240 of 512; outer points on the axes/diagonals at every 45°).
  const RO = 0.313 * 512, RI = 0.240 * 512;
  const pt = [];
  for (let i = 0; i < N * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / N;
    const rr = i % 2 === 0 ? RO : RI;
    pt.push(`${(C + Math.cos(a) * rr).toFixed(1)} ${(C + Math.sin(a) * rr).toFixed(1)}`);
  }
  const star = `M${pt.join(' L')} Z`;
  // four diamond pips in the diagonal gaps
  const pipR = 0.362 * 512, ps = 0.072 * 512 * 0.95;
  const pips = [0, 1, 2, 3].map((k) => {
    const a = Math.PI / 4 + k * Math.PI / 2;
    const cx = C + Math.cos(a) * pipR, cy = C + Math.sin(a) * pipR;
    return `M${cx} ${cy - ps} L${cx + ps * 0.72} ${cy} L${cx} ${cy + ps} L${cx - ps * 0.72} ${cy} Z`;
  }).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><radialGradient id="felt" cx="50%" cy="46%" r="62%">
    <stop offset="0%" stop-color="rgb(${FELT_LIT.join(',')})"/>
    <stop offset="100%" stop-color="rgb(${FELT_EDGE.join(',')})"/>
  </radialGradient>
  <radialGradient id="star" cx="50%" cy="38%" r="70%">
    <stop offset="0%" stop-color="rgb(${ACCENT_LIGHT.join(',')})"/>
    <stop offset="100%" stop-color="rgb(${ACCENT.join(',')})"/>
  </radialGradient></defs>
  <rect width="512" height="512" rx="96" fill="url(#felt)"/>
  <circle cx="256" cy="256" r="233" fill="none" stroke="rgb(${ACCENT_DARK.join(',')})" stroke-width="10" opacity="0.85"/>
  <path d="${pips}" fill="rgb(${ACCENT.join(',')})" opacity="0.9"/>
  <path d="${star}" fill="url(#star)" stroke="rgb(${ACCENT_DARK.join(',')})" stroke-width="8" stroke-linejoin="round"/>
  <circle cx="256" cy="256" r="22" fill="rgb(${ACCENT_LIGHT.join(',')})"/>
</svg>`;
}

// ── write everything ──────────────────────────────────────────────────────────
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
function emit(name, buf) { const abs = join(OUT, name); writeFileSync(abs, buf); console.log(`  icons/${name}  ${kb(statSync(abs).size)}`); }

const full = (nx, ny) => majlis(nx, ny, 1.0);
const safe = (nx, ny) => majlis(nx, ny, 0.78); // maskable safe-zone motif

console.log('Generating Card Majlis app icons…');
emit('icon-192.png', png(192, 4, full));
emit('icon-512.png', png(512, 4, full));
emit('maskable-512.png', png(512, 4, safe));
emit('apple-touch-icon.png', png(180, 4, full));
emit('favicon-32.png', png(32, 4, full));
writeFileSync(join(OUT, 'icon.svg'), buildSvg());
console.log('  icons/icon.svg');
