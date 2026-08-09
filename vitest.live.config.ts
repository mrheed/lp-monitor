import { defineConfig } from 'vitest/config'

/** Config for the live end to end check, which the default run excludes. */
export default defineConfig({
  test: {
    globals: true,
    include: ['**/*.live.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 180_000,
  },
})
