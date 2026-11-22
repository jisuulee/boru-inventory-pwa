import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'
import { extname } from 'node:path'

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
const files = {}
for (const name of await readdir('dist', { recursive: true })) {
  const path = name.replaceAll('\\', '/')
  if (path.startsWith('server/') || !mime[extname(path)]) continue
  files['/' + path] = [mime[extname(path)], (await readFile('dist/' + path)).toString('base64')]
}
await build({
  entryPoints: ['worker/index.js'], outfile: 'dist/server/index.js',
  bundle: true, format: 'esm', platform: 'browser',
  plugins: [{
    name: 'site-assets',
    setup(plugin) {
      plugin.onResolve({ filter: /^site-assets$/ }, args => ({ path: args.path, namespace: 'site' }))
      plugin.onLoad({ filter: /.*/, namespace: 'site' }, () => ({ contents: JSON.stringify(files), loader: 'json' }))
    },
  }],
})
