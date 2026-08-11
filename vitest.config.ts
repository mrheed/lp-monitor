import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirrors the `@/*` path alias from tsconfig, which component files use to import from lib.
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  // Next compiles JSX with the automatic runtime; esbuild here must be told the same, or a
  // component file fails at import time looking for a React global it never imports.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    // Live checks hit the real Krystal and Uniswap APIs, so they stay out of the default run
    // and are invoked explicitly with `npm run test:live`.
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
  },
})
