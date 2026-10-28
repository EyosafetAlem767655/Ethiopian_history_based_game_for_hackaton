import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 180000,
  workers: 1,
  use: {
    channel: 'chromium',
    baseURL: 'http://localhost:5174',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node --import tsx scripts/browser-server.ts',
      env: { CORS_ORIGINS: 'http://localhost:5174' },
      url: 'http://localhost:2570/api/health',
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command:
        'node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5174 --strictPort apps/web',
      env: {
        VITE_API_URL: 'http://localhost:2570',
        VITE_WS_URL: 'ws://localhost:2570',
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_ANON_KEY: '',
      },
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
