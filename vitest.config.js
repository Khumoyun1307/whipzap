import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    exclude: ['test/helpers/**', 'node_modules/**'],
  },
});
