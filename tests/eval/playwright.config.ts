import { defineConfig } from '@playwright/test';

/** The evaluation with a real model (see eval.spec.ts). Run with `pnpm eval`. */
export default defineConfig({
  testDir: '.',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
});
