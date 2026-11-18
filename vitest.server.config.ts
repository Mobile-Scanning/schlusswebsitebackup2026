import { defineConfig } from 'vitest/config';

// Backend API tests – run against a real MariaDB/MySQL test database (DB_NAME_TEST).
export default defineConfig({
  test: {
    include: ['tests/server/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/server/global-setup.cjs'],
    env: { NODE_ENV: 'test' },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
