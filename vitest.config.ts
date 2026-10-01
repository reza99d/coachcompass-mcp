import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', CC_RATE_LIMIT_PER_MIN: '20', CC_API_BASE: 'http://fake-api.test/api' },
    testTimeout: 20_000,
  },
});
