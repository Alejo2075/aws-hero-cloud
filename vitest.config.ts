import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'plugins/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**/*.ts', 'plugins/*/src/**/*.ts', 'apps/cli/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
