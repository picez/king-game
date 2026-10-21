import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_THEMES, APP_THEME_COLOR, normalizeAppTheme } from './appTheme';
import { APP_THEME_KEY, loadAppTheme, saveAppTheme } from '../../net/prefs';
import { EN as en } from '../../i18n/dictionaries/en';
import { UK as uk } from '../../i18n/dictionaries/uk';
import { DE as de } from '../../i18n/dictionaries/de';
import { AR as ar } from '../../i18n/dictionaries/ar';

// Stage 42.0 — the app colour theme: 'midnight' (default) and 'classic' (green felt).

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('app theme', () => {
  it('normalises unknown values to midnight and round-trips through storage', () => {
    expect(normalizeAppTheme(undefined)).toBe('midnight');
    expect(normalizeAppTheme('green')).toBe('midnight');
    expect(normalizeAppTheme('classic')).toBe('classic');
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    expect(loadAppTheme(s)).toBe('midnight');
    saveAppTheme('classic', s);
    expect(loadAppTheme(s)).toBe('classic');
    saveAppTheme('bogus', s);
    expect(loadAppTheme(s)).toBe('midnight');
  });

  it('index.html stamps the theme before first paint with the same key and colours', () => {
    const html = read('index.html');
    expect(html).toContain(`localStorage.getItem('${APP_THEME_KEY}')`);
    expect(html).toContain(`content="${APP_THEME_COLOR.midnight}"`);
    expect(html).toContain(`'${APP_THEME_COLOR.classic}'`);
  });

  it('midnight is the :root default and classic redefines every theme token', () => {
    const css = read('src/styles/base.css');
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    const classic = css.slice(css.indexOf(':root[data-app-theme="classic"] {'), css.indexOf('}', css.indexOf(':root[data-app-theme="classic"] {')));
    const names = (block: string) => new Set([...block.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
    const classicNames = names(classic);
    expect(classicNames.size).toBeGreaterThan(20);
    for (const n of classicNames) expect(names(root).has(n), `${n} must have a midnight default`).toBe(true);
  });

  it('is labelled in every language', () => {
    for (const dict of [en, uk, de, ar] as Record<string, string>[]) {
      for (const k of ['profile.appTheme', 'profile.themeMidnight', 'profile.themeClassic']) expect(dict[k], k).toBeTruthy();
    }
    expect(APP_THEMES).toEqual(['midnight', 'classic']);
  });
});
