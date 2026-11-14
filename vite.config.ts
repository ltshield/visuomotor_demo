/**
 * Vite + Vitest configuration.
 *
 * `base: './'` makes the production build location-independent, so the same
 * `dist/` folder works at a domain root (Cloudflare Pages) or under a sub-path.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    // Core logic is DOM-free, so tests default to the fast Node environment.
    // UI tests opt in to jsdom with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
