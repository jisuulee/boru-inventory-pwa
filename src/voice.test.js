import test from 'node:test'
import assert from 'node:assert/strict'
import { createVoice } from './voice.js'

test('recognition reuses the same engine, ignores synthesis and can restart manually', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const instances = []
  const commands = []
  let output
  class Recognition {
    constructor() { instances.push(this) }
    start() { this.starts = (this.starts ?? 0) + 1; this.onstart() }
    abort() { this.onend() }
    send(transcript) {
      this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript }], { isFinal: true })] })
    }
  }
  const voice = createVoice({
    SpeechRecognition: Recognition,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text } },
    speechSynthesis: { getVoices: () => [], speak: value => { output = value }, cancel() {} }
  }, async command => { commands.push(command); return '3보루입니다.' }, () => {})
  voice.start()
  instances[0].send('제품명')
  await Promise.resolve()
  assert.equal(output.text, '3보루입니다.')
  instances[0].send('3보루입니다.')
  t.mock.timers.tick(1000)
  assert.equal(instances.length, 1)
  assert.deepEqual(commands, ['제품명'])
  output.onend()
  t.mock.timers.tick(500)
  assert.equal(instances[0].starts, 1)
  instances[0].onend()
  t.mock.timers.tick(400)
  await Promise.resolve()
  assert.equal(instances[0].starts, 2)
  voice.stop()
  t.mock.timers.tick(1000)
  assert.equal(instances.length, 1)
  voice.start()
  assert.equal(instances.length, 2)
  voice.stop()
})

test('automatic restart stops before asking for microphone permission again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let starts = 0, engine, status
  class Recognition {
    constructor() { engine = this }
    start() { starts++; this.onstart() }
  }
  const voice = createVoice({
    SpeechRecognition: Recognition,
    navigator: { permissions: { query: async () => ({ state: 'prompt' }) } }
  }, async () => '', (message, active) => { status = { message, active } })
  voice.start()
  engine.onend()
  t.mock.timers.tick(400)
  await Promise.resolve()
  assert.equal(starts, 1)
  assert.equal(status.active, false)
  assert.match(status.message, /마이크 권한/)
})

