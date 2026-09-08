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
    setupFiles: ['./src/test/browser-setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      // No executablePath by default: Playwright uses the Chromium it
      // downloads with `pnpm exec playwright install chromium`, which is what
      // a laptop has. `CHROMIUM_PATH` still overrides it for a machine that
      // would rather point at a system browser — the old default was
      // /repl/tools/bin/chromium, which exists only inside Replit and made
      // this suite unrunnable anywhere else.
      provider: playwright({
        launchOptions: process.env.CHROMIUM_PATH
          ? { executablePath: process.env.CHROMIUM_PATH }
          : {},
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