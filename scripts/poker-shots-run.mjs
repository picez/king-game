import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const mod = await vite.ssrLoadModule('/scripts/poker-shots.tsx');
  mod.run();
} finally {
  await vite.close();
}
