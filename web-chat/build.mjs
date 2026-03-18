import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

await esbuild.build({
  entryPoints: [join(__dirname, 'chat-lib.mjs')],
  bundle: true,
  outfile: join(__dirname, '..', 'docs', 'chat-bundle.js'),
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': '"production"',
    'global': 'globalThis',
  },
})

console.log('✅ Built docs/chat-bundle.js')
