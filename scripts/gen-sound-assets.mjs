// ---------------------------------------------------------------------------
// Generate the MVP sound-effect set (Stage 15.1) with NO npm dependency.
//
//   node scripts/gen-sound-assets.mjs      (or: npm run sounds)
//
// Procedural, DETERMINISTIC synthesis (seeded noise — no Math.random / Date):
//   1. render each SFX to an in-memory 16-bit PCM mono WAV (built-in only)
//   2. use system ffmpeg to transcode WAV → .webm (Opus, primary) + .mp3 (fallback)
//   3. remove the intermediate WAV; only .webm/.mp3 land in public/sounds/
//
// The character follows SOUND_DESIGN.md §3 (warm/tactile/understated: soft card
// tap, felt slide, brass tick, warm chime). Every SFX is short (80–900 ms),
// soft-clipped (no harsh peaks), peak-normalised to ~-3 dBFS, and fade-in/out to
// avoid clicks. NOT wired into any runtime here — playback is Stage 15.3+.
//
// If ffmpeg is missing, the script FAILS with a clear message (no WAV is left in
// public/, so the manifest never points at a half-baked set). See SOUND_DESIGN.md §5.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'sounds');
mkdirSync(OUT, { recursive: true });

const SR = 48000; // render sample rate

// ── deterministic PRNG (mulberry32) — seeded per sound, so runs are identical ──
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── synthesis primitives (all return Float32 sample buffers in ~[-1,1]) ───────
const secs = (ms) => Math.max(1, Math.round((ms / 1000) * SR));
/** attack ramp then exponential decay; `a`,`d` in seconds. */
const env = (t, a, d) => Math.min(1, t / a) * Math.exp(-Math.max(0, t - a) / d);

/** One-pole lowpass noise burst — the "tap"/"felt" grain. */
function noise(ms, { cutoff, attack = 0.001, decay, seed }) {
  const n = secs(ms), out = new Float32Array(n), r = rng(seed);
  const k = Math.exp((-2 * Math.PI * cutoff) / SR);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp = k * lp + (1 - k) * (r() * 2 - 1);
    out[i] = lp * env(i / SR, attack, decay);
  }
  return out;
}

/** Additive tone with harmonic partials — the "chime"/"tick"/"body". */
function tone(ms, { freq, attack = 0.002, decay, partials = [[1, 1]], glideTo }) {
  const n = secs(ms), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, frac = i / n;
    const f = glideTo == null ? freq : freq + (glideTo - freq) * frac;
    ph += (2 * Math.PI * f) / SR;
    let s = 0;
    for (const [mult, amp] of partials) s += amp * Math.sin(ph * mult);
    out[i] = s * env(t, attack, decay);
  }
  return out;
}

/** Mix buffers, each optionally gained and offset (seconds). */
function mix(parts) {
  let len = 0;
  for (const [buf, , off = 0] of parts) len = Math.max(len, buf.length + secs(off * 1000));
  const out = new Float32Array(len);
  for (const [buf, gain = 1, off = 0] of parts) {
    const o = secs(off * 1000) - 1;
    for (let i = 0; i < buf.length; i++) out[o + i + 1] += buf[i] * gain;
  }
  return out;
}

/** Soft-clip (tanh) → no harsh transients, then peak-normalise + click-safe fades. */
function finish(buf, peak = 0.72) {
  const out = new Float32Array(buf.length);
  let max = 1e-9;
  for (let i = 0; i < buf.length; i++) { out[i] = Math.tanh(buf[i] * 1.1); max = Math.max(max, Math.abs(out[i])); }
  const g = peak / max;
  const fi = secs(2), fo = secs(8);
  for (let i = 0; i < out.length; i++) {
    let a = out[i] * g;
    if (i < fi) a *= i / fi;
    if (i > out.length - fo) a *= (out.length - i) / fo;
    out[i] = a;
  }
  return out;
}

// ── the 12 MVP sounds (ids/character per SOUND_DESIGN.md §3) ──────────────────
const SOUNDS = {
  // UI
  'ui-click':      () => finish(mix([[noise(90, { cutoff: 3200, decay: 0.018, seed: 101 }), 1], [tone(60, { freq: 200, decay: 0.02 }), 0.35]])),
  'ui-open':       () => finish(mix([[noise(170, { cutoff: 1400, attack: 0.03, decay: 0.09, seed: 102 }), 1], [tone(150, { freq: 320, glideTo: 460, decay: 0.09 }), 0.18]]), 0.6),
  'ui-error':      () => finish(mix([[tone(90, { freq: 400, decay: 0.05, partials: [[1, 1], [2, 0.2]] }), 0.9], [tone(110, { freq: 300, decay: 0.06, partials: [[1, 1], [2, 0.2]] }), 0.9, 0.075], [noise(30, { cutoff: 2000, decay: 0.01, seed: 103 }), 0.2]])),
  // Cards (shared)
  'card-deal':     () => finish(mix([[noise(80, { cutoff: 3600, decay: 0.014, seed: 201 }), 1], [tone(50, { freq: 220, decay: 0.014 }), 0.25]]), 0.6),
  'card-play':     () => finish(mix([[noise(130, { cutoff: 3400, decay: 0.03, seed: 202 }), 1], [noise(110, { cutoff: 1200, attack: 0.004, decay: 0.06, seed: 212 }), 0.5], [tone(70, { freq: 150, decay: 0.03 }), 0.4]])),
  'trick-collect': () => finish(mix([[noise(220, { cutoff: 1600, attack: 0.02, decay: 0.11, seed: 203 }), 1], [noise(160, { cutoff: 3000, attack: 0.05, decay: 0.09, seed: 213 }), 0.35], [tone(80, { freq: 160, decay: 0.05 }), 0.25]])),
  'trump-reveal':  () => finish(mix([[tone(240, { freq: 660, decay: 0.12, partials: [[1, 1], [2, 0.5], [3, 0.22], [4.2, 0.1]] }), 1], [tone(240, { freq: 990, decay: 0.1, partials: [[1, 0.5], [2, 0.2]] }), 0.5, 0.04]]), 0.68),
  // Game accents
  'bid-tick':      () => finish(mix([[tone(90, { freq: 1040, decay: 0.028, partials: [[1, 1], [2.01, 0.35]] }), 1], [noise(24, { cutoff: 5200, decay: 0.006, seed: 301 }), 0.3]]), 0.62),
  // Social
  'chat-pop':      () => finish(mix([[tone(150, { freq: 300, glideTo: 620, decay: 0.05, partials: [[1, 1], [2, 0.25]] }), 1], [noise(24, { cutoff: 4000, decay: 0.006, seed: 401 }), 0.15]]), 0.55),
  'reaction-pop':  () => finish(mix([[tone(140, { freq: 420, glideTo: 820, decay: 0.045, partials: [[1, 1], [2, 0.2]] }), 1], [noise(20, { cutoff: 4500, decay: 0.005, seed: 402 }), 0.12]]), 0.55),
  // Finish (aligns with WinnerCelebration kinds)
  'finish-win':    () => {
    // Three gentle rising bells (C5·E5·G5), staggered — kept ≤ 700 ms per the asset cap.
    const bell = (f) => tone(420, { freq: f, decay: 0.22, partials: [[1, 1], [2, 0.45], [3, 0.2], [4.2, 0.08]] });
    return finish(mix([[bell(523.25), 1, 0], [bell(659.25), 0.95, 0.1], [bell(783.99), 1, 0.2]]), 0.72);
  },
  'finish-neutral': () => finish(tone(500, { freq: 392, decay: 0.3, partials: [[1, 1], [2, 0.4], [3, 0.16]] }), 0.62),
};

// ── WAV (16-bit PCM mono) ─────────────────────────────────────────────────────
function wav(buf) {
  const n = buf.length, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    data.writeInt16LE((s < 0 ? s * 32768 : s * 32767) | 0, 44 + i * 2);
  }
  return data;
}

// ── ffmpeg presence check ─────────────────────────────────────────────────────
function haveFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
if (!haveFfmpeg()) {
  console.error('ERROR: ffmpeg not found on PATH. Install ffmpeg (with libopus + libmp3lame)');
  console.error('and re-run `npm run sounds`. No files were written (see SOUND_DESIGN.md §5).');
  process.exit(1);
}

// ── render → transcode → clean up ─────────────────────────────────────────────
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const tmp = tmpdir();
let total = 0;
const rows = [];
console.log(`Generating ${Object.keys(SOUNDS).length} sound effects (webm + mp3)…`);
for (const [id, render] of Object.entries(SOUNDS)) {
  const w = join(tmp, `cm-sfx-${id}.wav`);
  writeFileSync(w, wav(render()));
  const webm = join(OUT, `${id}.webm`), mp3 = join(OUT, `${id}.mp3`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', w, '-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-application', 'audio', '-ar', '48000', '-ac', '1', webm]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', w, '-c:a', 'libmp3lame', '-q:a', '6', '-ar', '44100', '-ac', '1', mp3]);
  rmSync(w, { force: true });
  const a = statSync(webm).size, b = statSync(mp3).size;
  total += a + b;
  rows.push([id, a, b]);
  console.log(`  ${id.padEnd(15)} webm ${kb(a).padStart(9)}   mp3 ${kb(b).padStart(9)}`);
}
console.log(`Total: ${kb(total)} across ${rows.length * 2} files (${rows.length} ids × 2 formats).`);
