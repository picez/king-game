// Source guards for the optional Docker deployment (Stage 20.1). The Dockerfile
// exists ONLY to add ffmpeg so server avatar upload works in production; the native
// Render path (render.yaml, runtime: node) is unchanged. These string-level checks
// keep the image honest: Node 22, ffmpeg installed + apt cleaned, lockfile-repro
// `npm ci`, the app build, the SAME production command, PORT respected, and NO
// secrets/env files baked in. See RENDER_DEPLOY.md.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');

describe('Dockerfile — ffmpeg-enabled production image', () => {
  it('pins Node 22 (matches the toolchain policy)', () => {
    expect(dockerfile).toMatch(/^FROM\s+node:22/m);
  });

  it('installs ffmpeg and cleans the apt lists (small image)', () => {
    expect(dockerfile).toMatch(/apt-get install .*ffmpeg/);
    expect(dockerfile).toContain('rm -rf /var/lib/apt/lists/*');
  });

  it('installs deps reproducibly with npm ci (no npm install churn) and builds the app', () => {
    expect(dockerfile).toContain('npm ci');
    expect(dockerfile).not.toMatch(/RUN\s+npm\s+install\b/); // ci, not install
    expect(dockerfile).toContain('npm run build');
  });

  it('runs the SAME production start command as the native path', () => {
    expect(dockerfile).toContain('server:prod');
    expect(dockerfile).toMatch(/NODE_ENV=production|ENV NODE_ENV=production/);
  });

  it('respects the injected PORT (binds HOST 0.0.0.0, never hard-codes PORT)', () => {
    expect(dockerfile).toContain('HOST=0.0.0.0');
    expect(dockerfile).not.toMatch(/ENV\s+PORT\s*=|ENV\s+PORT\s+\d/); // PORT comes from the host
  });

  it('bakes NO secrets or env files into the image', () => {
    // No secret-shaped ENV with a value baked in.
    expect(dockerfile).not.toMatch(/ENV\s+\w*(SECRET|TOKEN|PASSWORD|DATABASE_URL|API_KEY)\w*\s*[=\s]/i);
    // Never COPY an env file explicitly (and .dockerignore excludes them anyway).
    expect(dockerfile).not.toMatch(/COPY\s+[^\n]*\.env/);
  });
});

describe('.dockerignore — small, safe build context', () => {
  const lines = dockerignore.split('\n').map((l) => l.trim());
  it('excludes node_modules, dist, .git, and env files', () => {
    for (const p of ['node_modules', 'dist', '.git', '.env']) {
      expect(lines).toContain(p);
    }
    expect(dockerignore).toMatch(/\.env\.\*/); // .env.* variants too
  });

  it('does NOT exclude assets/source the build needs (public, src, scripts)', () => {
    for (const p of ['public', 'src', 'scripts', 'server']) {
      expect(lines).not.toContain(p);        // no bare exclusion line
    }
  });
});
