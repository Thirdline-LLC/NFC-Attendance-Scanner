import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: the dev/build config requires PORT and
// BASE_PATH to be set, which unit tests have no need for.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    // electron/ holds the main process's input validation, which is plain
    // TypeScript with no Electron import precisely so it can be tested here.
    include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
    exclude: ['src/**/*.browser.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
