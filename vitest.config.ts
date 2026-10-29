import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    env: {
      PERSISTENCE: 'sqlite',
      SUPABASE_DB_URL: '',
      SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      AGE_REVIEWER_IDS: '',
    },
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
