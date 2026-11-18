import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { apply, empty, sessionOf, quantity, search, parseSpeech, undoTarget, voiceCountAction } from './model.js'
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

test('speech distinguishes names, increments, decrements, absolute counts, and incomplete quantities', () => {
  for (const [spoken, kind, name, amount] of [
    ['에쎄수0.1', 'lookup', '에쎄수0.1', undefined],
    ['2보루 추가', 'add', '', 2], ['3보루로 변경', 'set', '', 3],
    ['에쎄수0.1 3보루로 변경', 'set', '에쎄수0.1', 3],
    ['레종 프렌치블랙 두 보루 차감', 'subtract', '레종 프렌치블랙', 2],
    ['에쎄수 두 보루', 'unclear', undefined, undefined],
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

