import path from 'path';
import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: the dev/build config requires PORT and
// BASE_PATH to be set, which unit tests have no need for.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
