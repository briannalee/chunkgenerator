import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    sequence: {
      hooks: 'stack',
      setupFiles: 'list',
    },
    includeSource: ['src', 'test'],
  },
  
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      { find: '@test', replacement: resolve(__dirname, 'test') },
      { find: 'shared', replacement: resolve(__dirname, '../shared/src') },
    ],
  }
});