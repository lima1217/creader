import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Node 25 enables a broken native localStorage stub by default that
    // shadows jsdom's Storage (no getItem/clear). Disable it so jsdom wins.
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--no-webstorage'],
      },
    },
  },
});
