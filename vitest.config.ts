import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': '/tmp/cc-agent/61616833/project/shared',
      '@': '/tmp/cc-agent/61616833/project/client/src',
    },
  },
});
