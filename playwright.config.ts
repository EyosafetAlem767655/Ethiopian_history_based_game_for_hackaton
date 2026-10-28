import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 180000,
  workers: 1,
  use: {
    channel: 'chromium',
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node --import tsx apps/server/src/index.ts',
      url: 'http://localhost:2567/api/health',
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 0.0.0.0 apps/web',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
