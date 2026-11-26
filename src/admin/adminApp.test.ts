import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_TABS, parseAdminHash } from './AdminApp';
import { niceMax } from './charts';

describe('admin shell (Stage 44.0)', () => {
  it('routes hashes to tabs, unknown → overview', () => {
    expect(parseAdminHash('#/users/abc')).toEqual({ tab: 'users', arg: 'abc' });
    expect(parseAdminHash('#/appeals/errors')).toEqual({ tab: 'appeals', arg: 'errors' });
    expect(parseAdminHash('')).toEqual({ tab: 'overview', arg: null });
    expect(parseAdminHash('#/nope/x')).toEqual({ tab: 'overview', arg: null });
  });
  it('carries every quiz-admin generic section, adapted', () => {
    expect(ADMIN_TABS.map((t) => t.id)).toEqual(['overview', 'live', 'users', 'appeals', 'announcement', 'broadcast', 'log', 'backup']);
  });
  it('chart axis maximum rounds to 1/2/5 × 10^n', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(420)).toBe(500);
  });
  it('the admin chunk is lazy — the game bundle never imports it statically', () => {
    const main = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8');
    expect(main).toMatch(/lazy\(\(\) => import\('\.\/admin\/AdminApp'\)\)/);
    expect(main).not.toMatch(/^import .*admin\/AdminApp/m);
  });
});
