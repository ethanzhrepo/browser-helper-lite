import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  define: {
    __ENABLE_CDP_DRIVER__: 'true',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
});
