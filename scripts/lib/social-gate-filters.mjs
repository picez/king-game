// ---------------------------------------------------------------------------
// (Stage 38.0.16.2c.2) The social gate's matrix selection — pure, so it can be tested.
//
// WHY. The gate had exactly one filter, `--only <substr>`, matched against SCENARIO and
// GAME names. `--only 390` therefore selected NOTHING and the run printed "0 social layout
// checks run" and exited 0. A focused reproduction built on that is not evidence of
// anything, so the first job of this stage was to make focused runs honest:
//
//     --viewport 390          --game durak        --dir ltr
//     --act typing-caret      --scenario collapsed
//
// Each filter works alone, they compose, the selected matrix is printed before the run, and
// a filter combination that selects nothing FAILS — a green "0 checks" is the one outcome a
// gate must never produce.
//
// The phases the gate runs are not symmetric, and the filters say so rather than pretending:
//   * `--scenario` names a PHASE A row (the isolated variant harness), so it excludes B;
//   * `--game` / `--dir` / `--act` name PHASE B rows (the real online branches), so they
//     exclude A;
//   * `--viewport` narrows both;
//   * `--act` additionally means "run ONLY that behaviour", skipping the geometry block, so
//     a hang can be reproduced with the smallest possible amount of work in front of it.
// `--act` FILTERS the default act set for that viewport/direction — it never widens it, so
// `--act combined --viewport 360` correctly selects nothing (360 only runs the core pair)
// and says why instead of inventing coverage the full run does not have.
// ---------------------------------------------------------------------------

/** Every filter this gate understands, and whether it takes a value. */
export const FILTER_FLAGS = ['viewport', 'game', 'dir', 'act', 'scenario'];

/**
 * Read the filters out of argv. Values may be comma-separated (`--viewport 360,390`); an
 * absent flag means "no restriction on this axis", which is what a full run has.
 */
export function parseFilters(argv) {
  const filters = {};
  const errors = [];
  for (const key of FILTER_FLAGS) {
    const i = argv.indexOf(`--${key}`);
    if (i === -1) continue;
    const raw = argv[i + 1];
    if (!raw || raw.startsWith('--')) { errors.push(`--${key} needs a value`); continue; }
    const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!values.length) { errors.push(`--${key} needs a value`); continue; }
    filters[key] = values;
  }
  return { filters, errors };
}

const wants = (filters, key, value) => !filters[key] || filters[key].includes(String(value));

/** A filter that names a PHASE B axis makes PHASE A irrelevant, and vice versa. */
export function phasesFor(filters) {
  const bOnly = !!(filters.game || filters.dir || filters.act);
  const aOnly = !!filters.scenario;
  return { runA: !bOnly, runB: !aOnly };
}

/**
 * Flatten the whole run into a list of units, then keep the ones the filters select.
 *
 * `actsFor(vpTag, dirTag, game)` is the gate's own rule for which behaviour actions a
 * combination runs by default; it is passed in rather than duplicated here.
 */
export function selectMatrix({ viewports, variants, scenarios, games, dirs, actsFor }, filters = {}, legacyOnly = null) {
  const { runA, runB } = phasesFor(filters);
  const units = [];
  // Viewport stays the outermost loop, exactly as the unfiltered run has always been
  // ordered: it keeps the log readable and each width's two phases together.
  for (const vp of viewports) {
    if (!wants(filters, 'viewport', vp.tag)) continue;

    if (runA) {
      for (const variant of variants) {
        for (const sc of scenarios) {
          if (!wants(filters, 'scenario', sc.name)) continue;
          if (legacyOnly && !`${variant}/${sc.name}`.includes(legacyOnly)) continue;
          units.push({ phase: 'A', vp, variant, scenario: sc, name: `${vp.tag} ${variant}/${sc.name}` });
        }
      }
    }

    if (runB) {
      for (const dir of dirs) {
        if (!wants(filters, 'dir', dir)) continue;
        for (const game of games) {
          if (!wants(filters, 'game', game.tag)) continue;
          if (legacyOnly && !`${game.tag}/${dir}`.includes(legacyOnly)) continue;
          const defaultActs = actsFor(vp.tag, dir, game);
          const acts = filters.act ? defaultActs.filter((a) => filters.act.includes(a)) : defaultActs;
          // `--act` asked for a behaviour: a combination that does not run it by default is
          // simply not selected, and the geometry block is skipped for the ones that are.
          if (filters.act && !acts.length) continue;
          units.push({
            phase: 'B', vp, dir, game, acts, actsOnly: !!filters.act,
            name: `${vp.tag} ${game.tag}/${dir}`,
          });
        }
      }
    }
  }
  return units;
}

/** What the run is about to do, printed before it does it. */
export function summarise(units, filters) {
  const active = FILTER_FLAGS.filter((k) => filters[k]).map((k) => `--${k} ${filters[k].join(',')}`);
  const a = units.filter((u) => u.phase === 'A');
  const b = units.filter((u) => u.phase === 'B');
  const acts = b.reduce((n, u) => n + u.acts.length, 0);
  const lines = [
    `selected matrix: ${active.length ? active.join(' ') : 'FULL (no filters)'}`,
    `  phase A (variant harness): ${a.length} scenario run(s)`
      + (a.length ? ` — ${[...new Set(a.map((u) => u.scenario.name))].join(', ')}` : ''),
    `  phase B (real branches):   ${b.length} game run(s)`
      + (b.length ? ` — ${[...new Set(b.map((u) => u.game.tag))].join(', ')}` : ''),
    `  behaviour actions:         ${acts}`
      + (acts ? ` — ${[...new Set(b.flatMap((u) => u.acts))].join(', ')}` : ''),
    `  viewports:                 ${[...new Set(units.map((u) => u.vp.tag))].join(', ') || 'none'}`,
  ];
  if (b.some((u) => u.actsOnly)) lines.push('  (--act given: geometry blocks are skipped, behaviour only)');
  return lines;
}

/**
 * The message a zero-selection run dies with. A filter that matches nothing is a mistake in
 * the invocation, never a pass — the old `--only 390` printed "0 checks run" and exited 0.
 */
export function emptySelectionError(filters, { viewports, games, dirs, scenarios }) {
  const active = FILTER_FLAGS.filter((k) => filters[k]);
  const known = {
    viewport: viewports.map((v) => v.tag), game: games.map((g) => g.tag), dir: dirs,
    scenario: scenarios.map((s) => s.name),
    act: ['typing-caret', 'blurred-draft', 'blurred-empty', 'opened-while-typing', 'focus-switch', 'sticker', 'combined'],
  };
  return [
    `the filters ${active.map((k) => `--${k} ${filters[k].join(',')}`).join(' ')} selected 0 checks.`,
    'A gate that measures nothing must fail, not pass. Known values:',
    ...active.map((k) => `  --${k}: ${known[k].join(', ')}`),
    'Note: --act filters the default set for that viewport/direction and never widens it —',
    'the full behaviour set runs at 390 ltr; 360 and 390 rtl run the core pair only.',
  ].join('\n');
}
