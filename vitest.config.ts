import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'workers/**/test/**/*.test.ts', 'tests/security/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
