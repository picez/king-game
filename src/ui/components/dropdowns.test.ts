import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-level guards (no jsdom here): the game, avatar and language pickers all
// use the ONE custom dropdown (SelectMenu) — never a native <select> or a big
// expanded grid/segmented control. See Stage 9.11.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('SelectMenu component', () => {
  const src = read('./SelectMenu.tsx');
  it('is a custom button+listbox dropdown, not a native select', () => {
    expect(src).not.toContain('<select');
    expect(src).toContain('aria-haspopup="listbox"');
    expect(src).toContain('role="listbox"');
    expect(src).toContain('role="option"');
  });
  it('closes on Escape and outside-click', () => {
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain('mousedown');
  });
  it('namespaces every class under .select-menu (never .card/.table)', () => {
    expect(src).toContain('select-menu__trigger');
    expect(src).toContain('select-menu__popover');
    expect(src).toContain('select-menu__option');
    expect(src).not.toMatch(/className="(card|table|menu|dropdown|option|selected)"/);
  });
});

describe('pickers use the dropdown', () => {
  it('the avatar picker is a SelectMenu grid, not an expanded avatar grid', () => {
    const src = read('../menu/ProfilePanel.tsx');
    expect(src).toContain('<SelectMenu');
    expect(src).toContain('layout="grid"');
    expect(src).not.toContain('avatar-chip'); // old expanded grid removed
  });
  it('the language selector is a SelectMenu (custom), not a native <select>', () => {
    const src = read('../../i18n/index.tsx');
    expect(src).toContain('<SelectMenu');
    expect(src).not.toContain('<select');
  });
});

describe('language selector lives only in the Profile panel', () => {
  it('LanguageSelector is rendered solely by ProfilePanel', () => {
    expect(read('../menu/ProfilePanel.tsx')).toContain('<LanguageSelector');
    // Not used anywhere else in the UI tree.
    expect(read('../StartMenu.tsx')).not.toContain('LanguageSelector');
  });
});
