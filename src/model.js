export const empty = () => ({ version: 1, products: [], sessions: [], active: null })
export const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
export const sessionOf = state => state.sessions.find(session => session.id === state.active)
export function quantity(session, id) {
  return session?.events.findLast(event => event.product === id)?.after ?? null
}
export function nextQuantity(before, kind, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0 || (kind !== 'set' && amount === 0))
    throw Error('유효한 보루 수량을 입력해 주세요.')
  if (kind !== 'set' && before === null) throw Error('미확인 제품은 수량을 먼저 입력해 주세요.')
  const after = kind === 'set' ? amount : kind === 'add' ? before + amount : before - amount
  if (!Number.isSafeInteger(after) || after < 0) throw Error('변경 후 수량이 유효 범위를 벗어납니다.')
  return after
}
export function voiceCountAction(session, product, command) {
  const expected = quantity(session, product.id)
  const { amount } = command
  if (command.kind === 'auto' && expected !== null) return null
  const firstCount = expected === null && (command.kind === 'auto' || (command.kind === 'add' && amount > 0))
  const kind = firstCount ? 'set' : command.kind
  return { type: 'count', session: session.id, id: product.id, kind, amount, expected }
}
export function apply(state, action) {
  const session = sessionOf(state)
  const at = new Date().toISOString()
  if (action.type === 'session') {
    state.active = crypto.randomUUID()
    state.sessions.push({ id: state.active, at, events: [] })
  } else if (action.type === 'select') {
    if (!state.sessions.some(item => item.id === action.id)) throw Error('조사를 찾을 수 없습니다.')
    state.active = action.id
  } else if (action.type === 'voice-register') {
    if (!session || session.id !== action.session) throw Error('조사가 바뀌었습니다. 다시 시도해 주세요.')
    const name = action.name.trim()
    if (!normalize(name) || name.length > 100) throw Error('제품명을 다시 말해 주세요.')
    if (state.products.some(product => normalize(product.name) === normalize(name)))
      throw Error('이미 등록된 제품입니다. 다시 말해 주세요.')
    const after = nextQuantity(0, action.kind === 'auto' ? 'set' : 'add', action.amount)
    const id = crypto.randomUUID()
    state.products.push({ id, name, aliases: [] })
    session.events.push({ id: crypto.randomUUID(), at, product: id, before: null, after })
  } else if (action.type === 'product') {
    const name = action.name.trim()
    if (!normalize(name)) throw Error('제품명을 입력해 주세요.')
    if (state.products.some(product => product.id !== action.id && normalize(product.name) === normalize(name)))
      throw Error('같은 이름의 제품이 있습니다.')
    const product = state.products.find(item => item.id === action.id)
    const fields = { name, aliases: action.aliases.split(',').map(alias => alias.trim()).filter(Boolean) }
    if (product) Object.assign(product, fields)
    else state.products.push({ id: crypto.randomUUID(), ...fields })
  } else {
    if (!session || session.id !== action.session) throw Error('조사가 바뀌었습니다. 다시 시도해 주세요.')
    if (action.type === 'undo') {
      const undone = new Set(session.events.map(event => event.undo))
      const target = session.events.findLast(event => !event.undo && !undone.has(event.id))
      if (!target || target.id !== action.id) throw Error('최근 변경을 다시 확인해 주세요.')
      session.events.push({ id: crypto.randomUUID(), at, product: target.product,
        before: quantity(session, target.product), after: target.before, undo: target.id })
    } else {
      if (!state.products.some(item => item.id === action.id)) throw Error('제품을 찾을 수 없습니다.')
      const before = quantity(session, action.id)
      if ('expected' in action && action.expected !== before) throw Error('수량이 바뀌었습니다. 명령을 다시 말해 주세요.')
      const after = nextQuantity(before, action.kind, action.amount)
      if (before !== after) session.events.push({ id: crypto.randomUUID(), at, product: action.id, before, after })
    }
  }
  return state
}
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const previous = row
    row = [i + 1]
    for (let j = 0; j < b.length; j++)
      row.push(Math.min(row[j] + 1, previous[j + 1] + 1, previous[j] + Number(a[i] !== b[j])))
  }
  return row[b.length]
}
export function search(products, query) {
  const key = normalize(query)
  if (!key) return products.map(product => ({ product, score: 0 }))
  return products.map(product => {
    const score = Math.max(...[product.name, ...product.aliases].map(value => {
      const name = normalize(value)
      if (name === key) return 100
      if (name.includes(key)) return 80
      const maxLength = Math.max(key.length, name.length)
      const limit = Math.min(3, Math.floor(maxLength / 3))
      if (key.length < 2 || Math.abs(key.length - name.length) > limit) return 0
      const edits = distance(key, name)
      return edits <= limit ? 55 - 10 * edits : 0
    }))
    return { product, score }
  }).filter(match => match.score).sort((a, b) => b.score - a.score)
}
const words = { 영:0, 한:1, 하나:1, 일:1, 두:2, 둘:2, 이:2, 세:3, 셋:3, 삼:3, 네:4, 넷:4, 사:4, 다섯:5, 오:5, 여섯:6, 육:6, 일곱:7, 칠:7, 여덟:8, 팔:8, 아홉:9, 구:9, 열:10, 십:10 }
const cartonUnit = '(?:[보뽀]\\s*[루로러르료뤄류]|[개계게])'
const countCommand = new RegExp(
  '^(.*?)\\s*(\\d+|[가-힣]{1,8})\\s*' + cartonUnit +
  '\\s*(로\\s*(?:변경|설정)|추가|차감|빼기|빼|변경|설정)?(?:\\s*(?:해\\s*줘|해\\s*주세요|요))?$'
)
const compoundCommand = new RegExp(cartonUnit + '\\s*(?:로\\s*)?(?:추가|차감|변경|설정|빼)')
const trailingQuantity = new RegExp('(?:\\d+|' + Object.keys(words).join('|') + ')\\s*' + cartonUnit + '$')
export function parseSpeech(input) {
  const line = input.normalize('NFKC').trim().replace(/[.!?。]+$/, '')
  const match = line.match(countCommand)
  if (match) {
    const numeric = match[2]
    const prefix = match[1].trim()
    const amount = /^\d+$/.test(numeric) ? Number(numeric) : words[numeric]
    const verb = match[3]
    if (!Number.isSafeInteger(amount)) {
      if (verb) return { kind: 'unclear' }
    } else {
      if (compoundCommand.test(prefix) || trailingQuantity.test(prefix) || /[.\-+]$/.test(prefix))
        return { kind: 'unclear' }
      if (!verb) return { name: prefix, amount, kind: 'auto' }
      return { name: prefix, amount, kind: verb === '추가' ? 'add' : /차감|빼/.test(verb) ? 'subtract' : 'set' }
    }
  }
  if (/추가|차감|변경|설정/.test(line)) return { kind: 'unclear' }
  return { kind: 'lookup', name: line.replace(/\s*(?:조회|수량|몇\s*개야)$/, '').trim() }
}
export const undoTarget = session => {
  const events = session?.events ?? []
  const undone = new Set(events.map(event => event.undo))
  return events.findLast(event => !event.undo && !undone.has(event.id))
}
export const labelQuantity = value => value === null ? '미확인' : value + '보루'

