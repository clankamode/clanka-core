import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@clankamode/core-runtime': path.resolve(__dirname, 'packages/core-runtime/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
