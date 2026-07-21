// ---------------------------------------------------------------------------
// Generate the "Levantine Card Lounge" P0 visual assets (Stage 12.1) with ZERO
// external dependencies — built-in zlib only, same technique as generate-icons.mjs.
//
//   node scripts/gen-visual-assets.mjs   (or: npm run visuals)
//
// Emits opaque backgrounds/texture/card-back + transparent game icons as valid
// PNGs (supersampled for smooth edges). These are v1 procedural assets on the
// VISUAL_DIRECTION.md palette; they may later be swapped for image-model art at
// the SAME paths. See VISUAL_DIRECTION.md §4–5 and public/visual/README.md.
// NOT wired into any UI here (integration = Stage 12.2+).
// ---------------------------------------------------------------------------

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIS = join(ROOT, 'public', 'visual');
const ICONS = join(VIS, 'icons');
const BADGES = join(VIS, 'badges');
const BACK = join(ROOT, 'public', 'cards', 'back');
mkdirSync(ICONS, { recursive: true });
mkdirSync(BADGES, { recursive: true });
mkdirSync(BACK, { recursive: true });

// ── palette (from src/styles/base.css) ──────────────────────────────────────
const FELT_LIT = [31, 122, 69], FELT_MID = [21, 95, 54], FELT_EDGE = [12, 67, 36], FELT_DEEP = [8, 43, 24];
const ACCENT = [245, 197, 24], ACCENT_LIGHT = [255, 226, 115], ACCENT_DARK = [184, 135, 10];
const WALNUT = [58, 36, 22], WALNUT_LIT = [96, 62, 36];
const WARM = [58, 140, 78]; // felt with a warm lamp tint
// Alternate card-back ground (Stage 13.0): dark red / burgundy enamel, lit centre.
const BURGUNDY_LIT = [150, 34, 38], BURGUNDY_EDGE = [74, 12, 16];
// Stage 13.5 card-back grounds: sapphire blue + dark charcoal (gold ornament pops).
const SAPPHIRE_LIT = [38, 84, 176], SAPPHIRE_EDGE = [14, 34, 82];
const CHARCOAL_LIT = [46, 42, 34], CHARCOAL_EDGE = [18, 16, 12];

// ── math helpers ────────────────────────────────────────────────────────────
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
/** Seamless value noise over a WxH cell using an integer lattice that wraps. */
function seamlessNoise(nx, ny, cells) {
  const x = nx * cells, y = ny * cells;
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const w = (v) => v * v * (3 - 2 * v);
  const g = (ax, ay) => hash((ax % cells + cells) % cells, (ay % cells + cells) % cells);
  const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
  const u = w(xf), v = w(yf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

// ── PNG writer (RGBA, zlib) ─────────────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
/** Render WxH by supersampling `ss`× and averaging; `fn(nx,ny)` → [r,g,b,a] 0..255. */
function png(W, H, ss, fn) {
  const raw = Buffer.alloc(H * (W * 4 + 1));
  let p = 0;
  const inv = 1 / (ss * ss);
  for (let y = 0; y < H; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const nx = (x + (sx + 0.5) / ss) / W, ny = (y + (sy + 0.5) / ss) / H;
        const c = fn(nx, ny); r += c[0]; g += c[1]; b += c[2]; a += c[3];
      }
      raw[p++] = clamp(r * inv, 0, 255) | 0; raw[p++] = clamp(g * inv, 0, 255) | 0;
      raw[p++] = clamp(b * inv, 0, 255) | 0; raw[p++] = clamp(a * inv, 0, 255) | 0;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ── asset: seamless felt texture ────────────────────────────────────────────
function feltTile(nx, ny) {
  // Woven nap: two seamless noise octaves + a fine periodic weave, low amplitude.
  const n = seamlessNoise(nx, ny, 24) * 0.6 + seamlessNoise(nx, ny, 96) * 0.4;
  const weave = Math.cos(nx * Math.PI * 2 * 64) * Math.cos(ny * Math.PI * 2 * 64);
  const shade = (n - 0.5) * 10 + weave * 3.5;   // ±~13 on green, subtle
  return [FELT_MID[0] + shade * 0.5, FELT_MID[1] + shade, FELT_MID[2] + shade * 0.6, 255];
}

// ── asset: menu hero (warm light pool on felt, UI-safe, vignette + wood band) ─
function hero(nx, ny, portrait) {
  const cx = 0.5, cy = portrait ? 0.30 : 0.42;
  const dx = (nx - cx) * (portrait ? 1 : 1.7), dy = ny - cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  // Warm light pool → felt → dark rim vignette.
  let col = lerp3(WARM, FELT_MID, smooth(0.0, 0.55, r));
  col = lerp3(col, FELT_EDGE, smooth(0.5, 0.95, r));
  col = lerp3(col, FELT_DEEP, smooth(0.85, 1.35, r));
  // Faint Levantine star lattice (very low opacity).
  const gx = Math.abs(Math.sin(nx * Math.PI * 10)) , gy = Math.abs(Math.sin(ny * Math.PI * 10 * (portrait ? 1 : 0.6)));
  const star = Math.pow(gx * gy, 8) * 8;
  col = lerp3(col, ACCENT_DARK, clamp(star) * 0.05);
  // Subtle nap.
  col = col.map((c, i) => c + (seamlessNoise(nx * 2, ny * 2, 40) - 0.5) * (i === 1 ? 7 : 4));
  // UI-safe: darken the top band and the vertical centre so text stays readable.
  const topDark = smooth(0.22, 0.0, ny) * 0.28;
  const midDark = portrait ? Math.exp(-Math.pow((ny - 0.5) / 0.16, 2)) * 0.14 : 0;
  col = col.map((c) => c * (1 - topDark - midDark));
  // Warm wood band + brass bead along the very bottom.
  const woodTop = portrait ? 0.9 : 0.86;
  if (ny > woodTop) {
    const wt = smooth(woodTop, 1.0, ny);
    let wood = lerp3(WALNUT_LIT, WALNUT, wt);
    if (ny > woodTop && ny < woodTop + 0.006) wood = ACCENT_DARK; // thin brass bead
    col = lerp3(col, wood, smooth(woodTop, woodTop + 0.02, ny));
  }
  return [col[0], col[1], col[2], 255];
}

// ── asset: card back (ground colour + gold border + 8-point star medallion) ──
// `litCol`/`edgeCol` set the ground so the SAME ornament renders on green (default)
// or the burgundy alternate (Stage 13.0) — identical geometry, distinct felt.
function cardBackWith(litCol, edgeCol) {
  return (nx, ny) => cardBack(nx, ny, litCol, edgeCol);
}
function cardBack(nx, ny, litCol = FELT_LIT, edgeCol = FELT_EDGE) {
  const dx = nx - 0.5, dy = ny - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx);
  // Ground colour, slightly lit centre.
  let col = lerp3(litCol, edgeCol, smooth(0.0, 0.72, r));
  const gold = (t) => lerp3(ACCENT_DARK, ACCENT_LIGHT, t);
  // Inset filigree border (rounded-rect ring): distance to a rounded rectangle.
  const bx = 0.5 - 0.055, by = 0.5 - 0.055; // inset
  const qx = Math.abs(dx) - bx, qy = Math.abs(dy) - by;
  const rr = Math.min(0, Math.max(qx, qy)) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const border = smooth(0.012, 0.006, Math.abs(rr)); // ~ a thin frame line
  const border2 = smooth(0.004, 0.0, Math.abs(rr + 0.02)); // inner hairline
  col = lerp3(col, gold(0.7 + 0.3 * Math.sin(ang * 8)), clamp(border) * 0.95);
  col = lerp3(col, gold(0.4), clamp(border2) * 0.8);
  // Central 8-point star medallion: two rings + a radial petal rosette.
  const ring1 = smooth(0.006, 0.0, Math.abs(r - 0.30));
  const ring2 = smooth(0.004, 0.0, Math.abs(r - 0.235));
  const petals = (Math.cos(ang * 8) * 0.5 + 0.5); // 8-fold
  const starEdge = 0.10 + 0.085 * petals;          // star silhouette radius by angle
  const star = smooth(0.010, 0.0, Math.abs(r - starEdge));
  const starFill = smooth(starEdge, starEdge - 0.02, r) * 0.35; // faint fill
  const dot = smooth(0.028, 0.018, r); // centre boss
  col = lerp3(col, gold(0.85), clamp(ring1) * 0.9);
  col = lerp3(col, gold(0.6), clamp(ring2) * 0.8);
  col = lerp3(col, gold(0.5 + 0.5 * petals), clamp(star) * 0.95);
  col = lerp3(col, gold(0.9), clamp(starFill));
  col = lerp3(col, gold(0.95), clamp(dot));
  // Faint corner rosettes.
  return [col[0], col[1], col[2], 255];
}

// ── icons: emblems in brass with a vertical bevel, transparent bg ────────────
function brass(ny, t = 0.5) { return lerp3(lerp3(ACCENT_DARK, ACCENT, 0.65), ACCENT_LIGHT, clamp((1 - ny) * 0.9) * t); }
function emblem(nx, ny, inside, edge) {
  // inside(x,y) → signed value >0 inside; edge width via smoothstep for AA outline.
  const s = inside(nx, ny);
  const fill = smooth(-edge, edge, s);
  if (fill <= 0.001) return [0, 0, 0, 0];
  const outline = smooth(edge * 2, edge, Math.abs(s)); // dark rim near border
  const col = lerp3(brass(ny, 1), ACCENT_DARK, clamp(outline) * 0.55);
  return [col[0], col[1], col[2], clamp(fill) * 255];
}
// crown
function iconKing(nx, ny) {
  return emblem(nx, ny, (x, y) => {
    x -= 0.5; const yy = y;
    // band
    const band = (yy > 0.60 && yy < 0.74 && Math.abs(x) < 0.34) ? 0.05 : -1;
    // three triangular peaks meeting a top line, valleys between
    const peaks = Math.abs(x) < 0.36 ? (0.60 - (0.10 + 0.16 * Math.abs(Math.cos(x * Math.PI * 3)))) - (yy) : -1;
    const s = Math.max(band, (yy < 0.60 && yy > (0.20 + 0.30 * Math.abs(Math.sin((x) * Math.PI * 3)))) && Math.abs(x) < 0.34 ? 0.05 : -1);
    return Math.max(band, s);
  }, 0.012);
}
// jester hat: a base band + three triangular horns each tipped with a bell.
const tri = (px, py, ax, ay, bx, by, cx, cy) => {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos) ? 0.05 : -1; // inside → positive
};
function iconDurak(nx, ny) {
  return emblem(nx, ny, (x, y) => {
    const band = (y > 0.58 && y < 0.67 && x > 0.20 && x < 0.80) ? 0.05 : -1;
    const bell = (bx, by) => (Math.hypot(x - bx, y - by) < 0.058) ? 0.05 : -1;
    return Math.max(
      band,
      tri(x, y, 0.17, 0.30, 0.26, 0.60, 0.42, 0.60),   // left horn
      tri(x, y, 0.50, 0.23, 0.42, 0.60, 0.58, 0.60),   // centre horn
      tri(x, y, 0.83, 0.30, 0.58, 0.60, 0.74, 0.60),   // right horn
      bell(0.17, 0.28), bell(0.50, 0.21), bell(0.83, 0.28),
    );
  }, 0.012);
}
// suit gem (diamond ♦ with a facet split)
function iconDeberc(nx, ny) {
  return emblem(nx, ny, (x, y) => {
    x -= 0.5; y -= 0.5;
    const d = Math.abs(x) / 0.30 + Math.abs(y) / 0.40; // diamond
    return (1 - d) * 0.1;
  }, 0.012);
}
// spade inside an 8-point star
function iconTarneeb(nx, ny) {
  return emblem(nx, ny, (x, y) => {
    const dx = x - 0.5, dy = y - 0.5, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const starR = 0.30 + 0.14 * (Math.cos(a * 8) * 0.5 + 0.5);
    const star = starR - r;
    // spade: heart-ish top + stem
    const sx = dx / 0.24, sy = (dy) / 0.24;
    const lobes = 1 - (Math.pow(Math.abs(sx) - 0.5, 2) + Math.pow(sy + 0.15, 2)); // two top lobes approx
    const spadeTop = (sy < 0.1) ? (0.5 - (Math.pow(sx, 2) + Math.pow(sy + 0.2, 2))) : -1;
    const stem = (Math.abs(dx) < 0.03 + Math.max(0, dy) * 0.18 && dy > 0 && dy < 0.24) ? 0.05 : -1;
    const spade = Math.max(spadeTop, stem, (Math.abs(dx) < 0.18 && dy > -0.05 && dy < 0.12 && (Math.pow((Math.abs(dx) - 0.09) / 0.09, 2) + Math.pow((dy - 0.02) / 0.12, 2) < 1)) ? 0.05 : -1);
    // faint star behind + solid spade in front (union)
    return Math.max(star * 0.4, spade);
  }, 0.012);
}
// refined top hat (Preferans — a solo contract/бidding game). A single clean brass
// silhouette in the set's language (crown + wide brim), distinct from crown/jester/
// gem/spade and legible at 32–64 px. No text/letters.
function iconPreferans(nx, ny) {
  return emblem(nx, ny, (x, y) => {
    const cx = x - 0.5;
    // Crown: a tall body with a subtle opera-hat flare toward the top.
    const halfW = 0.150 + 0.020 * smooth(0.66, 0.20, y);
    const crown = (y > 0.19 && y < 0.685 && Math.abs(cx) < halfW) ? 0.05 : -1;
    // Brim: a wide, flat lens (ellipse) at the base — the hat's defining line.
    const brim = (1 - Math.pow(cx / 0.35, 2) - Math.pow((y - 0.705) / 0.052, 2)) * 0.05;
    return Math.max(crown, brim);
  }, 0.012);
}

// two fanned playing cards (51 — a cutthroat rummy of runs & sets / melds). A
// signed rounded-rect SDF per card (>0 inside); the max of the two unions them,
// so the back card's edge reads as a seam where it peeks out behind the front one.
// Distinct from crown/jester/gem/spade/top-hat and legible at 32–64 px. No text.
function roundCard(nx, ny, cx, cy, hw, hh, rot, rad) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = nx - cx, dy = ny - cy;
  const u = Math.abs(dx * c + dy * s) - hw + rad;
  const v = Math.abs(-dx * s + dy * c) - hh + rad;
  const sdf = Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0) - rad;
  return -sdf; // >0 inside; magnitude ≈ distance to the (rounded) card edge
}
function iconFiftyOne(nx, ny) {
  return emblem(nx, ny, (x, y) => Math.max(
    roundCard(x, y, 0.565, 0.49, 0.140, 0.200, 0.24, 0.028),   // back card (fanned right)
    roundCard(x, y, 0.445, 0.515, 0.140, 0.200, -0.24, 0.028), // front card (fanned left)
  ), 0.010);
}

// poker chip (Poker — No-Limit Texas Hold'em). A casino-chip silhouette: an outer
// rim band (annulus) + a centre pip + six edge notches at 60° steps. Distinct from
// crown/jester/gem/spade/top-hat/fanned-cards and legible at 32–64 px. No text.
function iconPoker(nx, ny) {
  return emblem(nx, ny, (x, y) => {
    const dx = x - 0.5, dy = y - 0.5;
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const ring = Math.min(0.42 - r, r - 0.30);                 // outer rim band
    const core = 0.15 - r;                                     // centre pip
    const notch = (Math.cos(a * 6) > 0.6 && r > 0.30 && r < 0.47) ? 0.05 : -1; // 6 edge notches
    return Math.max(ring, core, notch);
  }, 0.012);
}

// ── P1: finish frame (ornamental transparent banner behind a winner summary) ──
// Transparent interior (content shows through) + a brass double-line rounded-rect
// border, 8-point corner rosettes, and a very faint warm interior glow. No text.
function finishFrame(nx, ny) {
  const dx = nx - 0.5, dy = ny - 0.5;
  const gold = (t) => lerp3(ACCENT_DARK, ACCENT_LIGHT, t);
  // Rounded-rect ring distance (aspect-correct-ish; the frame is wide).
  const bx = 0.5 - 0.035, by = 0.5 - 0.06;
  const qx = Math.abs(dx) - bx, qy = Math.abs(dy) - by;
  const rr = Math.min(0, Math.max(qx, qy)) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const line1 = smooth(0.010, 0.004, Math.abs(rr));            // outer brass line
  const line2 = smooth(0.004, 0.0, Math.abs(rr + 0.018));       // inner hairline
  // Corner rosettes: 8-point stars near each corner.
  let rosette = 0;
  for (const [cx, cy] of [[-bx, -by], [bx, -by], [-bx, by], [bx, by]]) {
    const rx = dx - cx, ry = dy - cy, r = Math.hypot(rx, ry), a = Math.atan2(ry, rx);
    const petal = Math.cos(a * 8) * 0.5 + 0.5;
    rosette = Math.max(rosette, smooth(0.032 + 0.018 * petal, 0.0, r));
  }
  // Faint warm interior glow (top-centre lamp pool), very low alpha.
  const glow = Math.exp(-((dx * 1.4) ** 2 + ((dy + 0.12) * 1.6) ** 2) * 3.0);
  const border = clamp(Math.max(line1, line2 * 0.8, rosette));
  let col = gold(0.55 + 0.4 * clamp(rosette + line1));
  col = lerp3(WARM, col, border);
  const alpha = clamp(border * 0.96 + glow * 0.12);
  return [col[0], col[1], col[2], alpha * 255];
}

// ── P1: seat status badge "coins" (dark felt disc + gold rim + tinted emblem) ──
function badgeCoin(nx, ny, inside, edge, tint) {
  const dx = nx - 0.5, dy = ny - 0.5, r = Math.hypot(dx, dy);
  const disc = smooth(0.47, 0.43, r);                     // dark felt disc alpha
  const rim = smooth(0.004, 0.0, Math.abs(r - 0.45));     // thin gold rim ring
  const em = clamp(smooth(-edge, edge, inside(nx, ny)));  // emblem fill (0..1)
  let col = lerp3(FELT_DEEP, WALNUT, 0.35);               // warm-dark coin ground
  col = lerp3(col, ACCENT, clamp(rim) * 0.95);            // gold rim
  col = lerp3(col, tint, em);                             // tinted emblem on top
  const alpha = clamp(Math.max(disc, rim, em * disc));    // stay within the coin
  return [col[0], col[1], col[2], alpha * 255];
}
const inHost = (x, y) => {              // crown (three peaks + band)
  x -= 0.5;
  const band = (y > 0.60 && y < 0.72 && Math.abs(x) < 0.30) ? 0.05 : -1;
  const body = (y < 0.60 && y > (0.26 + 0.26 * Math.abs(Math.sin(x * Math.PI * 3))) && Math.abs(x) < 0.30) ? 0.05 : -1;
  return Math.max(band, body);
};
const inBot = (x, y) => {               // robot head: rounded box, 2 eyes cut out, antenna
  const head = (Math.abs(x - 0.5) < 0.24 && y > 0.34 && y < 0.74) ? 0.05 : -1;
  const antenna = (Math.abs(x - 0.5) < 0.03 && y > 0.22 && y < 0.34) ? 0.05 : -1;
  const dot = (Math.hypot(x - 0.5, y - 0.20) < 0.05) ? 0.05 : -1;
  const eyeL = Math.hypot(x - 0.41, y - 0.52) < 0.055, eyeR = Math.hypot(x - 0.59, y - 0.52) < 0.055;
  const mouth = (Math.abs(x - 0.5) < 0.12 && Math.abs(y - 0.64) < 0.02);
  if (eyeL || eyeR || mouth) return -1;   // carve eyes + mouth
  return Math.max(head, antenna, dot);
};
const inOffline = (x, y) => {            // power/off glyph: ring with a top gap + stem
  const r = Math.hypot(x - 0.5, y - 0.5), a = Math.atan2(y - 0.5, x - 0.5);
  const gap = a < -Math.PI / 2 - 0.5 || a > -Math.PI / 2 + 0.5; // gap at the top
  const ring = (Math.abs(r - 0.22) < 0.045 && gap) ? 0.05 : -1;
  const stem = (Math.abs(x - 0.5) < 0.035 && y > 0.24 && y < 0.52) ? 0.05 : -1;
  return Math.max(ring, stem);
};
const inActive = (x, y) =>              // play triangle ▶ (it's this seat's turn)
  tri(x, y, 0.40, 0.30, 0.40, 0.70, 0.70, 0.50);

// ── write everything ────────────────────────────────────────────────────────
function write(path, buf) { writeFileSync(path, buf); return statSync(path).size; }
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
let total = 0;
const out = [];
const emit = (rel, buf) => { const abs = join(ROOT, 'public', rel); const s = write(abs, buf); total += s; out.push([rel, s]); console.log(`  ${rel}  ${kb(s)}`); };

console.log('Generating P0 visual assets…');
emit('visual/felt-tile.png', png(1024, 1024, 2, feltTile));
emit('visual/menu-hero-portrait.png', png(1242, 2208, 1, (x, y) => hero(x, y, true)));
emit('visual/menu-hero-wide.png', png(2560, 1440, 1, (x, y) => hero(x, y, false)));
emit('cards/back/back-green.png', png(750, 1050, 3, cardBackWith(FELT_LIT, FELT_EDGE)));
emit('cards/back/back-red.png', png(750, 1050, 3, cardBackWith(BURGUNDY_LIT, BURGUNDY_EDGE)));
emit('cards/back/back-blue.png', png(750, 1050, 3, cardBackWith(SAPPHIRE_LIT, SAPPHIRE_EDGE)));
emit('cards/back/back-dark.png', png(750, 1050, 3, cardBackWith(CHARCOAL_LIT, CHARCOAL_EDGE)));
emit('visual/icons/game-king.png', png(512, 512, 4, iconKing));
emit('visual/icons/game-durak.png', png(512, 512, 4, iconDurak));
emit('visual/icons/game-deberc.png', png(512, 512, 4, iconDeberc));
emit('visual/icons/game-tarneeb.png', png(512, 512, 4, iconTarneeb));
emit('visual/icons/game-preferans.png', png(512, 512, 4, iconPreferans));
emit('visual/icons/game-fifty-one.png', png(512, 512, 4, iconFiftyOne));
emit('visual/icons/game-poker.png', png(512, 512, 4, iconPoker));

console.log('Generating P1 visual assets (finish frame + seat badges)…');
emit('visual/finish-frame.png', png(1600, 700, 2, finishFrame));
emit('visual/badges/badge-host.png',    png(256, 256, 4, (x, y) => badgeCoin(x, y, inHost, 0.012, ACCENT_LIGHT)));
emit('visual/badges/badge-bot.png',     png(256, 256, 4, (x, y) => badgeCoin(x, y, inBot, 0.012, [156, 214, 240])));
emit('visual/badges/badge-offline.png', png(256, 256, 4, (x, y) => badgeCoin(x, y, inOffline, 0.012, [232, 150, 150])));
emit('visual/badges/badge-active.png',  png(256, 256, 4, (x, y) => badgeCoin(x, y, inActive, 0.012, ACCENT_LIGHT)));
console.log(`Total: ${kb(total)} across ${out.length} files.`);
