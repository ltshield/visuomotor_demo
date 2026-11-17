/**
 * Vite + Vitest configuration.
 *
 * `base: '/'`: the site is served from the root of its domain. That is what
 * lets `/instructor` and `/class/<CODE>` be real addresses: on such a path a
 * relative asset URL would resolve under `/class/` and fail to load. (To host
 * under a sub-folder instead, set `base` to that folder, e.g. '/lab/'.)
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    // One bundle on purpose: once the page has loaded, the whole activity
    // (including the results page and its charts) works even if the network
    // drops, so a student can never finish the task and then fail to see results.
    chunkSizeWarningLimit: 900,
  },
  test: {
    // Core logic is DOM-free, so tests default to the fast Node environment.
    // UI tests opt in to jsdom with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    // The class-data API (src/server) is tested here too; `functions/` holds only thin route files.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
