import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Live checks hit the real Krystal and Uniswap APIs, so they stay out of the default run
    // and are invoked explicitly with `npm run test:live`.
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
  },
})
