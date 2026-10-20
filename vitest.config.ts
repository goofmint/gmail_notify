import { defineConfig } from 'vitest/config';

// vite.config.ts を継承しない。テスト実行時に crx() を読み込まないため。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
