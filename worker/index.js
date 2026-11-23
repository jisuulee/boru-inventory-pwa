import files from 'site-assets'
import { validateBackup } from '../src/db.js'
import { appendMissingProducts, empty, normalize } from '../src/model.js'
import { isAccountId } from '../src/cloud.js'

const origins = new Set(['https://jisuulee.github.io', 'https://boru-inventory-pwa.smilingcheetah1.chatgpt.site'])
const maxBytes = 1_000_000
const productCollator = new Intl.Collator('ko', { numeric: true })

function readInventory(db, key) {
  return db.prepare('SELECT data, revision FROM inventory_account WHERE id = ?').bind(key).first()
}

async function writeInventory(db, key, data, revision) {
  const result = revision === 0
    ? await db.prepare('INSERT INTO inventory_account (id, data, revision) VALUES (?, ?, 1) ON CONFLICT(id) DO NOTHING').bind(key, data).run()
    : await db.prepare('UPDATE inventory_account SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(data, key, revision).run()
  return result.meta.changes === 1
}

async function inventory(request, db) {
  const origin = request.headers.get('Origin')
  const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' }
  if (origins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
  } else if (origin) {
    return new Response(null, { status: 403, headers })
  }
  const json = (value, status = 200) => Response.json(value, { status, headers })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return json({ error: 'method' }, 405)
  const reader = request.body?.getReader()
  if (!reader) return json({ error: 'invalid' }, 400)
  const decoder = new TextDecoder()
  let bytes = 0, raw = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      return json({ error: 'size' }, 413)
    }
    raw += decoder.decode(value, { stream: true })
  }
  let payload
  try { payload = JSON.parse(raw + decoder.decode()) } catch { return json({ error: 'invalid' }, 400) }
  if (!isAccountId(payload?.account)) return json({ error: 'invalid' }, 400)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload.account))
  const key = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  try {
    if (payload.operation === 'sort-products') {
      const row = await readInventory(db, key)
      const state = row ? JSON.parse(row.data) : empty()
      const sorted = state.products.toSorted((left, right) => productCollator.compare(left.name, right.name))
      const changed = sorted.some((product, index) => product.id !== state.products[index].id)
      if (changed && !await writeInventory(db, key, JSON.stringify({ ...state, products: sorted }), row.revision))
        return json({ error: 'conflict' }, 409)
      return json({ count: sorted.filter(product => !product.archived).length, changed })
    }
    if (payload.operation === 'append-products') {
      const names = payload.names
      if (!Array.isArray(names) || names.length < 1 || names.length > 500 ||
          names.some(name => typeof name !== 'string' || name.length > 100 || !normalize(name)))
        return json({ error: 'invalid' }, 400)
      const row = await readInventory(db, key)
      const state = row ? JSON.parse(row.data) : empty()
      const added = appendMissingProducts(state, names)
      if (added) {
        const data = JSON.stringify(state)
        if (new TextEncoder().encode(data).byteLength > maxBytes - 256) return json({ error: 'size' }, 413)
        if (!await writeInventory(db, key, data, row?.revision ?? 0)) return json({ error: 'conflict' }, 409)
      }
      return json({ added, skipped: names.length - added })
    }
    if (!Object.hasOwn(payload, 'state')) {
      const row = await readInventory(db, key)
      return json({ state: row ? JSON.parse(row.data) : empty(), revision: row?.revision ?? 0 })
    }
    const { state, revision } = payload
    if (!Number.isSafeInteger(revision) || revision < 0) return json({ error: 'invalid' }, 400)
    try { validateBackup(state) } catch { return json({ error: 'invalid' }, 400) }
    const data = JSON.stringify(state)
    if (!await writeInventory(db, key, data, revision)) return json({ error: 'conflict' }, 409)
    return json({ state, revision: revision + 1 })
  } catch {
    return json({ error: 'storage' }, 503)
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/inventory') return inventory(request, env.DB)
    const asset = files[pathname === '/' ? '/index.html' : pathname]
    if (!asset || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 })
    const [mime, data] = asset
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(data), char => char.charCodeAt(0)), {
      headers: {
        'Content-Type': mime,
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  },
}
