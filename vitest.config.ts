import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  define: {
    __ENABLE_CDP_DRIVER__: 'true',
    __AUTO_UPDATE_CHECK__: 'false',
    __IP_REGION_LOOKUP__: 'false',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
});
