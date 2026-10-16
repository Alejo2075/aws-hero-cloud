import { defineConfig } from 'vitest/config';

// Runs the tests that need a real AWS sandbox account: `HERO_INTEGRATION=1 pnpm test:integration`.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 1_800_000,
  },
});
