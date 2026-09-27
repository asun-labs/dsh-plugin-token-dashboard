import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outExtensions: () => ({ js: '.js' }),
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
})
