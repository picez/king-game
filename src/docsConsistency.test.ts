// ---------------------------------------------------------------------------
// (Stage 38.0.18) The docs must not outlive the code.
//
// Every current-state number in this repo has ONE source of truth in the code —
// `GAME_TYPES`, `ACHIEVEMENTS`, the migrations directory, `package.json`. This suite
// reads those, then checks that the CURRENT-STATE documents agree. Nothing here is
// hard-coded to 7 / 52 / 0014: add the 8th game and this file starts demanding the
// docs say eight, which is the point.
//
// WHAT IT DELIBERATELY DOES NOT DO — the reason a guard like this usually rots:
//   * CHANGELOG.md is checked ONLY inside the `[Unreleased]` slice. A released block
//     records what was true at the time; rewriting history to satisfy a test would be
//     the bug, not the fix.
//   * The per-stage log in NEXT_SESSION_MEMORY.md is history too. Only its short
//     "Product state" header block is current, and only that is checked.
//   * `*_PLAN.md` and the release-time snapshot sections of PRODUCTION_SMOKE.md are
//     left alone for the same reason.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_TYPES } from './games/catalog';
import { ACHIEVEMENTS } from './stats/achievements';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── The source of truth, derived — never typed in ───────────────────────────
const GAME_COUNT = GAME_TYPES.length;
const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;
const MIGRATION_FILES = readdirSync(join(process.cwd(), 'server/db/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
const LATEST_MIGRATION = MIGRATION_FILES[MIGRATION_FILES.length - 1];
const VERSION = JSON.parse(read('package.json')).version as string;

/** The slice of CHANGELOG.md that describes the code as it stands, and nothing older. */
function unreleasedSection(): string {
  const md = read('CHANGELOG.md');
  const start = md.indexOf('## [Unreleased]');
  expect(start, 'CHANGELOG.md must keep an [Unreleased] section').toBeGreaterThanOrEqual(0);
  const next = md.indexOf('\n## [', start + 1);
  return next === -1 ? md.slice(start) : md.slice(start, next);
}

/** The short current-state header of the running memory log — not the stage entries below it. */
function memoryHeader(): string {
  const md = read('NEXT_SESSION_MEMORY.md');
  const end = md.indexOf('## Important rules / gotchas');
  expect(end, 'NEXT_SESSION_MEMORY.md must keep its header sections').toBeGreaterThan(0);
  return md.slice(0, end);
}

describe('docs consistency — the derived counters', () => {
  it('the code itself is the source of truth this suite reads', () => {
    // A sanity floor, not a restatement: if any of these ever read 0 the assertions
    // below would pass vacuously against docs that say anything at all.
    expect(GAME_COUNT).toBeGreaterThan(0);
    expect(ACHIEVEMENT_COUNT).toBeGreaterThan(0);
    expect(MIGRATION_FILES.length).toBeGreaterThan(0);
    expect(LATEST_MIGRATION).toMatch(/^\d{4}_.+\.sql$/);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('every game id is named in the owner smoke guide', () => {
    const guide = read('OWNER_SMOKE_GUIDE.md');
    for (const id of GAME_TYPES) expect(guide, `${id} missing from OWNER_SMOKE_GUIDE.md`).toContain(id);
  });

  it('the owner smoke guide and production smoke state the current game count', () => {
    for (const doc of ['OWNER_SMOKE_GUIDE.md', 'PRODUCTION_SMOKE.md']) {
      expect(read(doc), `${doc} must state games.count: ${GAME_COUNT}`)
        .toContain(`games.count: ${GAME_COUNT}`);
    }
  });

  it('the current-state docs state the current achievement count', () => {
    for (const doc of ['PRODUCTION_SMOKE.md', 'PROJECT_OVERVIEW.md', 'MVP_STATUS.md']) {
      expect(read(doc), `${doc} must state ${ACHIEVEMENT_COUNT} achievements`)
        .toMatch(new RegExp(`\\b${ACHIEVEMENT_COUNT}\\b[^\\n]{0,40}achievement|achievement[^\\n]{0,40}\\b${ACHIEVEMENT_COUNT}\\b|\\*\\*${ACHIEVEMENT_COUNT}\\*\\* badges`, 'i'));
    }
  });

  it('the current-state docs name the latest migration file', () => {
    for (const doc of ['OWNER_SMOKE_GUIDE.md', 'PRODUCTION_SMOKE.md', 'MVP_STATUS.md']) {
      expect(read(doc), `${doc} must name ${LATEST_MIGRATION}`).toContain(LATEST_MIGRATION);
    }
  });

  it('the running memory header carries the current counters, not the ones it was written with', () => {
    const header = memoryHeader();
    expect(header).toContain(`${ACHIEVEMENT_COUNT} total`);
    expect(header).toContain(LATEST_MIGRATION.replace(/\.sql$/, ''));
    expect(header).toMatch(new RegExp(`all ${GAME_COUNT} games`));
  });

  it('PRODUCTION_SMOKE states the migration file count the runner reports', () => {
    expect(read('PRODUCTION_SMOKE.md')).toContain(`done (${MIGRATION_FILES.length} file(s))`);
    expect(read('OWNER_SMOKE_GUIDE.md')).toContain(`done (${MIGRATION_FILES.length} file(s))`);
  });
});

describe('docs consistency — the owner smoke sections must actually exist', () => {
  const guide = () => read('OWNER_SMOKE_GUIDE.md');
  const smoke = () => read('PRODUCTION_SMOKE.md');

  // The ten checks the owner pass is made of. A doc that silently loses one of these
  // still reads fine to a human — which is exactly why it is asserted.
  const REQUIRED = [
    { what: 'diagnostics / version / commit / db / games', probe: /health\/diagnostics/ },
    { what: 'migration evidence 0009–0014', probe: /0009.{0,4}0014/ },
    { what: 'King wide desktop chat states', probe: /closed/i },
    { what: 'adaptive sidecar boundaries', probe: /1668/ },
    { what: 'mobile 360/390', probe: /360.{0,4}390/ },
    { what: 'Arabic RTL', probe: /Arabic/i },
    { what: 'rich chat text + one sticker', probe: /sticker/i },
    { what: 'Poker with two authenticated accounts', probe: /rebuy/i },
    { what: 'online statistics separation', probe: /with-bots|with_bots/ },
    { what: 'PASS / FAIL / NOT RUN states', probe: /NOT RUN/ },
  ];

  for (const { what, probe } of REQUIRED) {
    it(`OWNER_SMOKE_GUIDE.md covers: ${what}`, () => {
      expect(guide(), `owner guide lost the "${what}" check`).toMatch(probe);
    });
    it(`PRODUCTION_SMOKE.md §0 covers: ${what}`, () => {
      expect(smoke(), `production smoke lost the "${what}" check`).toMatch(probe);
    });
  }

  it('both smoke docs name the second sidecar threshold and the games that have none', () => {
    for (const doc of [guide(), smoke()]) {
      expect(doc).toContain('1472');
      // The five full-width games must be named as having NO sidecar, or the boundary
      // check reads as if it applied everywhere.
      for (const id of ['Durak', 'Deberc', 'Tarneeb', 'Preferans']) expect(doc).toContain(id);
    }
  });

  it('the owner guide refuses to let a check be marked PASS by inference', () => {
    expect(guide()).toMatch(/never.{0,40}infer|Never mark PASS by inference/i);
  });
});

describe('docs consistency — no stale current-state claims', () => {
  // Each entry is a claim that was TRUE once and is FALSE now. They are listed as exact
  // strings, not clever patterns, so a future stage that legitimately reintroduces the
  // wording has to delete the line here on purpose.
  const FORBIDDEN: Array<{ doc: string; text: string; why: string }> = [
    { doc: 'OWNER_SMOKE_GUIDE.md', text: 'games.count: 6', why: 'Poker is the 7th game' },
    { doc: 'PRODUCTION_SMOKE.md', text: 'six-game platform', why: 'seven games' },
    { doc: 'PRODUCTION_SMOKE.md', text: '0009 is still the latest', why: `latest is ${LATEST_MIGRATION}` },
    { doc: 'PRODUCTION_SMOKE.md', text: 'latest stays `0009`', why: `latest is ${LATEST_MIGRATION}` },
    { doc: 'PRODUCTION_SMOKE.md', text: '## 5. Six-game smoke', why: 'seven games' },
    { doc: 'PROJECT_OVERVIEW.md', text: 'card lounge** for six games', why: 'seven games' },
    { doc: 'PROJECT_OVERVIEW.md', text: '## Supported games (6 released', why: 'seven released' },
    { doc: 'ONLINE_ARCHITECTURE.md', text: 'Multi-game online (six games)', why: 'seven games' },
    { doc: 'QA_CHECKLIST.md', text: 'the **backdrop** close the whole chat', why: 'Stage 38.0.14 deleted the backdrop' },
  ];

  for (const { doc, text, why } of FORBIDDEN) {
    it(`${doc} no longer claims "${text}"`, () => {
      expect(read(doc), `${doc} still carries a stale claim — ${why}`).not.toContain(text);
    });
  }

  it('the online wire-protocol gameType union lists every game', () => {
    const arch = read('ONLINE_ARCHITECTURE.md');
    const union = arch.match(/`gameType: ('[a-z-]+'(?: \| '[a-z-]+')*)`/);
    expect(union, 'ONLINE_ARCHITECTURE.md must document the CREATE_ROOM gameType union').not.toBeNull();
    const documented = (union![1].match(/'([a-z-]+)'/g) ?? []).map((q) => q.slice(1, -1));
    expect([...documented].sort()).toEqual([...GAME_TYPES].sort());
  });
});

describe('docs consistency — history is left alone', () => {
  it('CHANGELOG [Unreleased] is the only slice checked, and it carries no stale counter', () => {
    const unreleased = unreleasedSection();
    // A released block below may legitimately say "six games" — that must not fail here,
    // so prove the slice really is bounded before asserting anything about it.
    const full = read('CHANGELOG.md');
    expect(unreleased.length).toBeGreaterThan(0);
    expect(unreleased.length).toBeLessThan(full.length);
    // "the other six games" is CORRECT prose in a Poker- or 51-scoped entry (7 minus the
    // one being described), so only a claim about the TOTAL is forbidden here.
    expect(unreleased).not.toMatch(/\b(?:all|the|our) six games\b/i);
    expect(unreleased).not.toMatch(/six-game (?:platform|state|lounge)/i);
  });

  it('older CHANGELOG release blocks are NOT required to match the current counters', () => {
    // Documents the contract explicitly: if this ever fails, someone has started
    // rewriting shipped release notes.
    const full = read('CHANGELOG.md');
    const released = full.slice(full.indexOf('\n## [', full.indexOf('## [Unreleased]') + 1));
    expect(released.length).toBeGreaterThan(0);
    // No assertion on its counters, by design. This test exists to say so out loud.
  });
});
