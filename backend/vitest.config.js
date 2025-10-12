// backend/vitest.config.js
import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load environment variables for tests
config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    testTimeout: 30000,
    hookTimeout: 30000
  }
});