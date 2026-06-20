// ---------------------------------------------------------------------------
// Slice the 4 source suit sprite-sheets in card-sources/ into individual
// J / Q / K / A preview crops, plus a labelled contact sheet for visual review.
//
//   node scripts/slice-card-sources.mjs
//
// PURE Node (zlib only) — no sharp/canvas/jimp, matching the project style.
//
// Each source PNG is one suit laid out as a 4x4 grid:
//     row0: 2  3  4  5
//     row1: 6  7  8  9
//     row2: 10 J  Q  K
//     row3: A  (only col0 has a card)
//
// We export ALL 13 ranks per suit (2-10, J, Q, K, A) => 52 files total.
//
// Grid cells are auto-detected via projection profiles (gaps between cards are
// pure background). If auto-detection looks wrong, switch CONFIG.mode to
// 'manual' and tune the pixel coordinates in CONFIG.manualGrid.
//
// IMPORTANT: This script ONLY reads card-sources/ and writes
// public/cards/preview/. It never touches game logic, CardView, deck, etc.
// ---------------------------------------------------------------------------

import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'card-sources');
// Production card faces (committed, used at runtime).
const FACES = join(ROOT, 'public', 'cards', 'faces');
// Debug-only contact sheet for visual review (NOT referenced at runtime; the
// build strips public/cards/preview/ out of dist — see scripts/strip-preview.mjs).
const PREVIEW = join(ROOT, 'public', 'cards', 'preview');

// ── Configuration ───────────────────────────────────────────────────────────
const CONFIG = {
  // 'auto'  : detect grid via projection profiles (default)
  // 'manual': use CONFIG.manualGrid below
  mode: 'auto',

  // Background detection: pixels whose colour distance from the corner colour
  // exceeds this are considered "content". Raise if background is noisy.
  bgThreshold: 38,

  // A column/row counts as part of a card if its content-pixel ratio exceeds
  // this fraction of the perpendicular dimension.
  activeRatio: 0.012,

  // Pixels of padding trimmed INWARD from each detected band edge (positive)
  // or expanded OUTWARD (negative). 0 = exact detected border.
  pad: 0,

  // Manual grid (only used when mode === 'manual').
  // For each suit-sheet (all 4 share the same layout) provide x/y bands.
  // colX[i] = [left, right], rowY[j] = [top, bottom]  (pixels, inclusive-ish)
  manualGrid: {
    colX: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    rowY: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  },

  // Contact sheet thumbnail width in px.
  thumbW: 150,
};

// Which cells to export: [rowIndex, colIndex, rankLabel]
// Grid: row0=2,3,4,5  row1=6,7,8,9  row2=10,J,Q,K  row3=A(col0 only)
const EXPORT_CELLS = [
  [0, 0, '2'], [0, 1, '3'], [0, 2, '4'], [0, 3, '5'],
  [1, 0, '6'], [1, 1, '7'], [1, 2, '8'], [1, 3, '9'],
  [2, 0, '10'], [2, 1, 'j'], [2, 2, 'q'], [2, 3, 'k'],
  [3, 0, 'a'],
];

// NOTE: the source files in card-sources/ are mis-named: spades.png actually
// contains the CLUBS artwork and clubs.png contains the SPADES artwork.
// We map each source FILE to its TRUE suit so output names match the pips.
// (Originals are never renamed/modified.)
const SOURCE_MAP = [
  { file: 'clubs', suit: 'spades' },    // clubs.png -> spade pips
  { file: 'hearts', suit: 'hearts' },
  { file: 'diamonds', suit: 'diamonds' },
  { file: 'spades', suit: 'clubs' },    // spades.png -> club pips
];
const SUITS = SOURCE_MAP.map((m) => m.suit);

// ── PNG decode (8-bit, colour type 2 RGB or 6 RGBA, no interlace) ────────────
function decodePng(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) throw new Error('not a PNG');
  }
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bitDepth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error(`unsupported colorType ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const bpp = channels; // bytes per pixel at 8-bit
  const out = Buffer.alloc(width * height * 4);

  const cur = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let i = 0; i < stride; i++) {
      const x = raw[rp++];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = x + pr;
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
    // expand scanline to RGBA
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      out[di] = cur[si];
      out[di + 1] = cur[si + 1];
      out[di + 2] = cur[si + 2];
      out[di + 3] = channels === 4 ? cur[si + 3] : 255;
    }
    cur.copy(prev);
  }
  return { width, height, data: out };
}

// ── PNG encode (RGBA, 8-bit) ─────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter none
    data.copy(raw, p, y * stride, y * stride + stride);
    p += stride;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Image helpers ────────────────────────────────────────────────────────────
function crop(img, x0, y0, w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    img.data.copy(data, y * w * 4, src, src + w * 4);
  }
  return { width: w, height: h, data };
}

// Box-average downscale to target width.
function resizeTo(img, tw) {
  const th = Math.max(1, Math.round((img.height * tw) / img.width));
  const data = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy0 = Math.floor((y * img.height) / th);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.height) / th));
    for (let x = 0; x < tw; x++) {
      const sx0 = Math.floor((x * img.width) / tw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.width) / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const si = (sy * img.width + sx) * 4;
          r += img.data[si]; g += img.data[si + 1];
          b += img.data[si + 2]; a += img.data[si + 3]; n++;
        }
      }
      const di = (y * tw + x) * 4;
      data[di] = Math.round(r / n); data[di + 1] = Math.round(g / n);
      data[di + 2] = Math.round(b / n); data[di + 3] = Math.round(a / n);
    }
  }
  return { width: tw, height: th, data };
}

function makeCanvas(w, h, [r, g, b]) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const si = (y * src.width + x) * 4;
      const di = (ty * dst.width + tx) * 4;
      const a = src.data[si + 3] / 255;
      dst.data[di] = Math.round(src.data[si] * a + dst.data[di] * (1 - a));
      dst.data[di + 1] = Math.round(src.data[si + 1] * a + dst.data[di + 1] * (1 - a));
      dst.data[di + 2] = Math.round(src.data[si + 2] * a + dst.data[di + 2] * (1 - a));
      dst.data[di + 3] = 255;
    }
  }
}

// ── Tiny 5x7 bitmap font for labels ──────────────────────────────────────────
const FONT = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};
function drawText(dst, text, x, y, scale, [r, g, b]) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] || FONT[' '];
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === '1') {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = cx + gx * scale + sx;
              const py = y + gy * scale + sy;
              if (px < 0 || px >= dst.width || py < 0 || py >= dst.height) continue;
              const di = (py * dst.width + px) * 4;
              dst.data[di] = r; dst.data[di + 1] = g; dst.data[di + 2] = b; dst.data[di + 3] = 255;
            }
          }
        }
      }
    }
    cx += (5 + 1) * scale;
  }
}

// ── Grid detection ───────────────────────────────────────────────────────────
function detectGrid(img) {
  const { width, height, data } = img;
  // background = top-left corner
  const bg = [data[0], data[1], data[2]];
  const thr2 = CONFIG.bgThreshold * CONFIG.bgThreshold;
  const colCount = new Float64Array(width);
  const rowCount = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
      if (dr * dr + dg * dg + db * db > thr2) {
        colCount[x]++;
        rowCount[y]++;
      }
    }
  }
  const colBands = bands(colCount, height * CONFIG.activeRatio);
  const rowBands = bands(rowCount, width * CONFIG.activeRatio);
  return { colBands, rowBands, bg };
}

// Find contiguous runs where profile exceeds threshold; return [start,end] (inclusive).
function bands(profile, thr) {
  const out = [];
  let start = -1;
  for (let i = 0; i < profile.length; i++) {
    const active = profile[i] > thr;
    if (active && start < 0) start = i;
    else if (!active && start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, profile.length - 1]);
  // drop tiny noise bands (< 2% of dimension)
  const minLen = profile.length * 0.04;
  return out.filter(([a, b]) => b - a + 1 >= minLen);
}

// ── Main ─────────────────────────────────────────────────────────────────────
mkdirSync(FACES, { recursive: true });
mkdirSync(PREVIEW, { recursive: true });

const created = [];
const thumbsBySuit = {};
let gridReport = '';

for (const { file, suit } of SOURCE_MAP) {
  const img = decodePng(readFileSync(join(SRC, `${file}.png`)));
  let colBands, rowBands;
  if (CONFIG.mode === 'manual') {
    colBands = CONFIG.manualGrid.colX;
    rowBands = CONFIG.manualGrid.rowY;
  } else {
    ({ colBands, rowBands } = detectGrid(img));
  }
  gridReport += `\n[${suit} <- ${file}.png] ${img.width}x${img.height}\n`;
  gridReport += `  cols(${colBands.length}): ${colBands.map((b) => `[${b[0]}-${b[1]}]`).join(' ')}\n`;
  gridReport += `  rows(${rowBands.length}): ${rowBands.map((b) => `[${b[0]}-${b[1]}]`).join(' ')}\n`;

  if (colBands.length < 4 || rowBands.length < 4) {
    console.warn(`[WARN] ${suit}: expected 4 col & 4 row bands, got ${colBands.length}/${rowBands.length}. Crop may be wrong.`);
  }

  thumbsBySuit[suit] = [];
  for (const [r, c, rank] of EXPORT_CELLS) {
    if (!rowBands[r] || !colBands[c]) {
      console.warn(`[WARN] ${suit} ${rank}: missing band r${r}/c${c}, skipped.`);
      continue;
    }
    const [x0b, x1b] = colBands[c];
    const [y0b, y1b] = rowBands[r];
    const x0 = Math.max(0, x0b + CONFIG.pad);
    const y0 = Math.max(0, y0b + CONFIG.pad);
    const w = Math.min(img.width - x0, x1b - x0b + 1 - 2 * CONFIG.pad);
    const h = Math.min(img.height - y0, y1b - y0b + 1 - 2 * CONFIG.pad);
    const cell = crop(img, x0, y0, w, h);
    const file = `${suit}-${rank}.png`;
    writeFileSync(join(FACES, file), encodePng(cell));
    created.push(`faces/${file}`);
    thumbsBySuit[suit].push({ rank, thumb: resizeTo(cell, CONFIG.thumbW) });
  }
}

// ── Contact sheet ─────────────────────────────────────────────────────────────
{
  const cols = EXPORT_CELLS.length; // 13 ranks
  const tw = CONFIG.thumbW;
  // tallest thumb determines cell height
  let maxTh = 0;
  for (const s of SUITS) for (const t of thumbsBySuit[s]) maxTh = Math.max(maxTh, t.thumb.height);
  const labelH = 22;
  const padX = 24, padY = 24, gapX = 12, gapY = 18, titleH = 44;
  const cellW = tw, cellH = maxTh + labelH;
  const sheetW = padX * 2 + cols * cellW + (cols - 1) * gapX;
  const sheetH = titleH + padY * 2 + SUITS.length * cellH + (SUITS.length - 1) * gapY;
  const sheet = makeCanvas(sheetW, sheetH, [24, 26, 30]);
  drawText(sheet, 'CARD SOURCES PREVIEW - ALL 52 CARDS', padX, 16, 2, [245, 197, 24]);

  for (let s = 0; s < SUITS.length; s++) {
    const suit = SUITS[s];
    const rowY = titleH + padY + s * (cellH + gapY);
    for (let c = 0; c < thumbsBySuit[suit].length; c++) {
      const { rank, thumb } = thumbsBySuit[suit][c];
      const cellX = padX + c * (cellW + gapX);
      blit(sheet, thumb, cellX + Math.round((cellW - thumb.width) / 2), rowY);
      drawText(sheet, `${suit}-${rank}`, cellX, rowY + maxTh + 4, 1, [235, 235, 235]);
    }
  }
  writeFileSync(join(PREVIEW, 'contact-sheet.png'), encodePng(sheet));
  created.push('preview/contact-sheet.png');
}

console.log('=== Grid detection ===' + gridReport);
console.log('=== Created files (public/cards/) ===');
for (const f of created) console.log('  ' + f);
console.log(`\nDone: ${created.length} files (${created.length - 1} faces + 1 contact sheet). Mode=${CONFIG.mode}.`);
