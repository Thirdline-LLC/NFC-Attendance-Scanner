import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.browser.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          executablePath:
            process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium',
        },
      }),
      instances: [
        {
          browser: 'chromium',
          name: 'phone',
          viewport: { width: 390, height: 844 },
        },
        {
          browser: 'chromium',
          name: 'desktop',
          viewport: { width: 1280, height: 900 },
        },
      ],
    },
  },
});