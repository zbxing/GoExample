import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const frontRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': frontRoot,
    },
  },
  test: {
    clearMocks: true,
    environment: 'node',
    include: ['__tests__/unit/**/*.test.ts'],
  },
});
