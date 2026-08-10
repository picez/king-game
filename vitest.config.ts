import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `scripts/**` holds the QA gates' PURE logic — matrix selection, CDP command lifetime,
    // the post-navigation proof validator. They are plain .mjs and browser-free, so CI runs
    // them with everything else; the browser-driven halves stay in `npm run layout:*`.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
