import { defineConfig } from "vite";
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: "esnext",
    outDir: "dist",
  },
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      { find: '@test', replacement: resolve(__dirname, 'test') }
    ],
  },
});