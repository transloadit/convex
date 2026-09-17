import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@transloadit/convex': fileURLToPath(new URL('./src/client/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'edge-runtime',
    exclude: ['node_modules/**', 'dist/**', 'test/e2e/**'],
  },
})
