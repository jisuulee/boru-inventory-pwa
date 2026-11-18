import { empty } from './model.js'
let connection
function open() {
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('boru-inventory', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('data')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { connection = undefined; reject(request.error) }
  })
}
export async function transact(update) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', update ? 'readwrite' : 'readonly')
    const store = tx.objectStore('data')
    const request = store.get('inventory')
    let result, failure
    request.onsuccess = () => {
      try {
        result = request.result ?? empty()
        if (update) {
          result = update(result)
          store.put(result, 'inventory')
        }
      } catch (error) { failure = error; tx.abort() }
    }
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure ?? tx.error ?? Error('저장에 실패했습니다.'))
  })
}
export function validateBackup(data) {
  const fail = () => { throw Error('유효한 보루 재고 백업 파일이 아닙니다.') }
  const id = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value)
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  const count = value => value === null || (Number.isSafeInteger(value) && value >= 0)
  if (data?.version !== 1 || !Array.isArray(data.products) || !Array.isArray(data.sessions)) fail()
  const products = new Set()
  for (const item of data.products) {
    if (!id(item?.id) || products.has(item.id) || typeof item.name !== 'string' ||
        !item.name.trim() || !Array.isArray(item.aliases) || item.aliases.some(value => typeof value !== 'string')) fail()
    products.add(item.id)
  }
  const sessions = new Set()
  for (const session of data.sessions) {
    if (!id(session?.id) || sessions.has(session.id) || !date(session.at) || !Array.isArray(session.events)) fail()
    sessions.add(session.id)
    const events = new Set()
    const stack = []
    const quantities = new Map()
    for (const event of session.events) {
      if (!id(event?.id) || events.has(event.id) || !products.has(event.product) || !date(event.at) ||
          !count(event.before) || !count(event.after) || event.before !== (quantities.get(event.product) ?? null)) fail()
      if (event.undo !== undefined) {
        const target = stack.pop()
        if (!target || target.id !== event.undo || target.product !== event.product || target.before !== event.after) fail()
      } else {
        if (event.after === null || event.after === event.before) fail()
        stack.push(event)
      }
      events.add(event.id)
      quantities.set(event.product, event.after)
    }
  }
  if (data.active !== null && !sessions.has(data.active)) fail()
  return data
}

