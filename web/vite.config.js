import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The Story wording tests read the vendored parser and the wording file from the repo root (outside web/).
  server: { fs: { allow: ['..'] } },
  server: {
    host: '127.0.0.1',
    port: 5251,
    proxy: { '/api': 'http://127.0.0.1:5250' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testSetup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    testTimeout: 30000,
  },
});
