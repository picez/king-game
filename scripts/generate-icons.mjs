// ---------------------------------------------------------------------------
// Generate PWA icons with zero external dependencies (built-in zlib only).
//
//   node scripts/generate-icons.mjs   (or: npm run icons)
//
// Emits flat, recognisable card-suit icons (green table + accent diamond) as
// valid PNGs, plus a crisp SVG. No network, no binary assets checked in by hand.
// ---------------------------------------------------------------------------

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// Palette (matches App.css theme)
const GREEN = [23, 99, 55];     // --green-table
const GREEN_DK = [13, 79, 40];  // --green-dark
const ACCENT = [245, 197, 24];  // --accent
const DARK = [17, 17, 17];

// ── CRC32 (PNG chunk checksum) ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// ── Pixel art: composite background + centred diamond ───────────────────────
function colorAt(nx, ny, maskablePad) {
  // Radial table felt
  const dxc = nx - 0.5, dyc = ny - 0.5;
  const r = Math.sqrt(dxc * dxc + dyc * dyc);
  const mix = Math.min(1, r * 1.4);
  let col = [
    Math.round(GREEN[0] * (1 - mix) + GREEN_DK[0] * mix),
    Math.round(GREEN[1] * (1 - mix) + GREEN_DK[1] * mix),
    Math.round(GREEN[2] * (1 - mix) + GREEN_DK[2] * mix),
  ];
  // Diamond motif (shrunk for maskable safe-zone)
  const scale = maskablePad ? 0.21 : 0.27;
  const d = Math.abs(dxc) / scale + Math.abs(dyc) / scale;
  if (d <= 1) col = ACCENT;
  else if (d <= 1.08) col = DARK; // thin outline
  return col;
}

function makePng(size, maskable) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = colorAt((x + 0.5) / size, (y + 0.5) / size, maskable);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><radialGradient id="g" cx="50%" cy="42%" r="70%">
    <stop offset="0%" stop-color="rgb(${GREEN.join(',')})"/>
    <stop offset="100%" stop-color="rgb(${GREEN_DK.join(',')})"/>
  </radialGradient></defs>
  <rect width="512" height="512" rx="96" fill="url(#g)"/>
  <path d="M256 116 L372 256 L256 396 L140 256 Z" fill="rgb(${ACCENT.join(',')})" stroke="rgb(${DARK.join(',')})" stroke-width="10"/>
</svg>`;

writeFileSync(join(OUT, 'icon-192.png'), makePng(192, false));
writeFileSync(join(OUT, 'icon-512.png'), makePng(512, false));
writeFileSync(join(OUT, 'maskable-512.png'), makePng(512, true));
writeFileSync(join(OUT, 'icon.svg'), SVG);

console.log('[icons] wrote public/icons/{icon-192,icon-512,maskable-512}.png + icon.svg');
