import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { apply, empty, sessionOf, quantity, search, parseSpeech, undoTarget, voiceCountAction, moveProductOrder } from './model.js'
import { transact, validateBackup } from './db.js'

test('new surveys distinguish zero from unknown and preserve prior history', () => {
  const data = empty()
  apply(data, { type: 'product', name: '에쎄 수 0.1', aliases: '에쎄수' })
  const id = data.products[0].id
  apply(data, { type: 'session' })
  const session = data.active
  const count = (kind, amount) => apply(data, { type: 'count', session, id, kind, amount })
  assert.throws(() => count('add', 2), /미확인/)
  count('set', 0)
  assert.equal(quantity(sessionOf(data), id), 0)
  count('add', 2)
  count('set', 3)
  assert.throws(() => count('subtract', 4), /범위/)
  assert.equal(quantity(sessionOf(data), id), 3)
  for (const expected of [2, 0, null]) {
    apply(data, { type: 'undo', session, id: undoTarget(sessionOf(data)).id })
    assert.equal(quantity(sessionOf(data), id), expected)
  }
  count('set', 7)
  assert.equal(validateBackup(JSON.parse(JSON.stringify(data))).active, session)
  apply(data, { type: 'session' })
  assert.equal(quantity(sessionOf(data), id), null)
  assert.throws(() => count('set', 4), /조사가 바뀌었습니다/)
  apply(data, { type: 'select', id: session })
  assert.equal(quantity(sessionOf(data), id), 7)
  const invalid = structuredClone(data)
  sessionOf(invalid).events[0].after = -2
  assert.throws(() => validateBackup(invalid), /유효한/)
})

test('search ranks aliases, partial names, and typos', () => {
  const products = [{ name: '레종 프렌치 블랙', aliases: ['프블'] }, { name: '레종 프렌치 블루', aliases: [] }]
  assert.equal(search(products, '프블')[0].score, 100)
  assert.equal(search(products, '프렌치').length, 2)
  assert.equal(search(products, '레종 프렌치 블렉')[0].product, products[0])
})

test('manual product order persists and rejects a stale or incomplete reorder', async () => {
  const data = empty()
  for (const name of ['가 제품', '나 제품', '다 제품']) apply(data, { type: 'product', name, aliases: '' })
  const before = data.products.map(product => product.id)
  await transact(() => data)
  const ids = [before[2], before[0], before[1]]
  await assert.rejects(transact(state => apply(state, { type: 'reorder-products', before, ids: [before[0]] })))
  await transact(state => apply(state, { type: 'reorder-products', before, ids }))
  await assert.rejects(transact(state => apply(state, { type: 'reorder-products', before, ids })), /목록이 바뀌었어요/)
  assert.deepEqual(validateBackup(await transact()).products.map(product => product.id), ids)
})

test('dropping before or after a visible product retains the other products in order', () => {
  const order = ['a', 'hidden', 'b', 'c']
  assert.deepEqual(moveProductOrder(order, 'a', 'b', true), ['hidden', 'b', 'a', 'c'])
  assert.deepEqual(moveProductOrder(order, 'c', 'a', false), ['c', 'a', 'hidden', 'b'])
  assert.equal(moveProductOrder(order, 'c', 'b', true), order)
})

test('speech recognizes initial S as 에쎄 and preserves Latin brand names', () => {
  const products = [
    { name: '에쎄 체인지 1미리', aliases: [] },
    { name: 'LBS', aliases: [] },
    { name: 'LSS', aliases: [] },
    { name: 'S 수', aliases: [] },
  ]
  assert.deepEqual(parseSpeech('S 체인지 1미리 새보러'), { kind: 'auto', name: products[0].name, amount: 3 })
  assert.deepEqual(parseSpeech('S'), { kind: 'lookup', name: '에쎄' })
  for (const [voice, product] of [
    ['S체인지 1미리', products[0]], ['lbs', products[1]], ['lss', products[2]], ['에쎄 수', products[3]],
  ]) {
    const command = parseSpeech(voice + ' 두 보 로 추가')
    const [match] = search(products, command.name, { voice: true })
    assert.equal(match.score, 100)
    assert.equal(match.product, product)
  }
  assert.equal(parseSpeech('lss 두 보 로').name, 'lss')
  assert.equal(parseSpeech('스페셜 S').name, '스페셜 S')
  assert.equal(search(products, 'S 수')[0].score, 100)
  assert.equal(search(products, 'S 체인지 1미리').some(item => item.score === 100), false)
})

test('speech distinguishes names, increments, decrements, absolute counts, and incomplete quantities', () => {
  for (const [spoken, kind, name, amount] of [
    ['에쎄수0.1', 'lookup', '에쎄수0.1', undefined],
    ['2보루 추가', 'add', '', 2], ['3보루로 변경', 'set', '', 3],
    ['에쎄수0.1 3보루로 변경', 'set', '에쎄수0.1', 3],
    ['레종 프렌치블랙 두 보루 차감', 'subtract', '레종 프렌치블랙', 2],
    ['에쎄체인지 1미리 두보로 추가', 'add', '에쎄체인지 1미리', 2],
    ['3보러로 변경', 'set', '', 3],
    ['3개 추가', 'add', '', 3],
    ['한 개 차감', 'subtract', '', 1],
    ['3개로 변경', 'set', '', 3],
    ['3개', 'auto', '', 3],
    ['세 개요', 'auto', '', 3],
    ['세 계', 'auto', '', 3],
    ['세게', 'auto', '', 3],
    ['새개', 'auto', '', 3],
    ['새보러', 'auto', '', 3],
    ['새보루', 'auto', '', 3],
    ['네개', 'auto', '', 4],
    ['내개', 'auto', '', 4],
    ['함보루', 'auto', '', 1],
    ['함 보 루 추가', 'add', '', 1],
    ['내부로', 'auto', '', 4],
    ['에쎄 수 내 부 로 변경', 'set', '에쎄 수', 4],
    ['에쎄 수 내부로 추가', 'add', '에쎄 수', 4],
    ['내 게', 'auto', '', 4],
    ['내 보 러 추가', 'add', '', 4],
    ['내 제품명 내 계로 변경', 'set', '내 제품명', 4],
    ['쎄 계 추가', 'add', '', 3],
    ['두 보 로', 'auto', '', 2],
    ['에쎄체인지 1미리 두 보 로 추가', 'add', '에쎄체인지 1미리', 2],
    ['새 제품명 새 보 러 로 변경', 'set', '새 제품명', 3],
    ['새 제품명', 'lookup', '새 제품명', undefined],
    ['두보류', 'auto', '', 2],
    ['에쎄체인지 1미리 두 보로', 'auto', '에쎄체인지 1미리', 2],
    ['3보로 변경', 'set', '', 3],
    ['두보루 세보로', 'unclear', undefined, undefined],
    ['2개 추가 3개 추가', 'unclear', undefined, undefined],
    ['2.5개 추가', 'unclear', undefined, undefined],
    ['에쎄수 두 보루', 'auto', '에쎄수', 2],
    ['2.5보루 추가', 'unclear', undefined, undefined],
    ['-2보루 추가', 'unclear', undefined, undefined],
  ]) {
    const parsed = parseSpeech(spoken)
    assert.deepEqual([parsed.kind, parsed.name, parsed.amount], [kind, name, amount], spoken)
  }
})

test('IndexedDB serializes concurrent changes and rolls back failures', async () => {
  const data = empty()
  apply(data, { type: 'product', name: '레종 프렌치블랙', aliases: '' })
  apply(data, { type: 'session' })
  await transact(() => data)
  const id = data.products[0].id
  const action = { type: 'count', session: data.active, id }
  const count = (kind, amount) => transact(state => apply(state, { ...action, kind, amount }))
  await count('set', 0)
  await Promise.all([count('add', 2), count('add', 3)])
  await assert.rejects(count('subtract', 6))
  await assert.rejects(transact(state => apply(state, { ...action, kind: 'set', amount: 1, expected: 0 })), /바뀌었습니다/)
  assert.equal(quantity(sessionOf(await transact()), id), 5)
})

test('voice commands save the first addition, later increments and absolute counts', async () => {
  const data = empty()
  apply(data, { type: 'product', name: '에쎄 수 0.1', aliases: '' })
  apply(data, { type: 'session' })
  await transact(() => data)
  const product = data.products[0]
  for (const [speech, expected] of [['2보루 추가', 2], ['두 보루 추가', 4], ['3보루로 변경', 3], ['1보루 차감', 2]]) {
    const action = voiceCountAction(sessionOf(await transact()), product, parseSpeech(speech))
    await transact(state => apply(state, action))
    assert.equal(quantity(sessionOf(await transact()), product.id), expected)
  }
})

test('a named voice addition can register a product and record its first count together', async () => {
  const data = empty()
  apply(data, { type: 'session' })
  await transact(() => data)
  const command = parseSpeech('에쎄체인지 1미리 두보루 추가')
  assert.deepEqual(command, { name: '에쎄체인지 1미리', kind: 'add', amount: 2 })
  const action = { ...command, type: 'voice-register', session: data.active }
  await assert.rejects(transact(state => apply(state, { ...action, amount: 0 })))
  assert.deepEqual((await transact()).products, [])
  const updated = await transact(state => apply(state, action))
  const [product] = updated.products
  assert.equal(product.name, command.name)
  assert.equal(quantity(sessionOf(updated), product.id), 2)
  await assert.rejects(transact(state => apply(state, action)), /이미 등록/)
  assert.equal((await transact()).products.length, 1)
  assert.equal(validateBackup(updated), updated)
})

test('an implicit quantity saves a first count and waits for an operation on counted products', () => {
  const data = empty()
  apply(data, { type: 'session' })
  apply(data, { type: 'product', name: '에쎄 수 0.1', aliases: '' })
  const product = data.products[0]
  const session = sessionOf(data)
  apply(data, voiceCountAction(session, product, parseSpeech('두 보 로')))
  assert.equal(quantity(session, product.id), 2)
  assert.equal(voiceCountAction(session, product, parseSpeech('새보러')), null)
  assert.equal(quantity(session, product.id), 2)
  apply(data, voiceCountAction(session, product, parseSpeech('세 계 추가')))
  assert.equal(quantity(session, product.id), 5)
  apply(data, voiceCountAction(session, product, parseSpeech('세게로 변경')))
  assert.equal(quantity(session, product.id), 3)
  const command = parseSpeech('에쎄체인지 1미리 세 게')
  apply(data, { ...command, type: 'voice-register', session: session.id })
  assert.equal(quantity(session, data.products[1].id), 3)
})

