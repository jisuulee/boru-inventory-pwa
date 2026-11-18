import { defineConfig } from 'vite'
import tailwind from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
export default defineConfig({
  base: './',
  plugins: [tailwind(), {
    name: 'offline-shell',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
        ...Object.keys(bundle).map(name => './' + name)]
      const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const cacheName = 'boru-${version}';
self.addEventListener('install', event => event.waitUntil(
  caches.open(cacheName).then(cache => cache.addAll(${JSON.stringify(files)}))
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('boru-') && key !== cacheName).map(key => caches.delete(key))))
));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    if (request.mode === 'navigate') return (await cache.match('./index.html')) || fetch(request);
    return (await cache.match(request)) || fetch(request);
  }));
});` })
    }
  }]
})
