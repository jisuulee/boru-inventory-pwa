import test from 'node:test'
import assert from 'node:assert/strict'
import { createVoice } from './voice.js'

test('recognition pauses during synthesis, ignores stale results and can restart manually', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const instances = []
  const commands = []
  let output
  class Recognition {
    constructor() { instances.push(this) }
    start() { this.onstart() }
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
  t.mock.timers.tick(400)
  assert.equal(instances.length, 2)
  voice.stop()
  t.mock.timers.tick(1000)
  assert.equal(instances.length, 2)
  voice.start()
  assert.equal(instances.length, 3)
  voice.stop()
})

