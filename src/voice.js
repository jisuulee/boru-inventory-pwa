export function createVoice(env, receive, report) {
  const Recognition = env.SpeechRecognition ?? env.webkitSpeechRecognition
  let wanted = false, current, engine, restart, speaking, watchdog, speechTimeout, quiet, generation = 0, misses = 0
  function stop(message = '음성 꺼짐') {
    wanted = false
    generation++
    clearTimeout(restart)
    clearTimeout(watchdog)
    clearTimeout(speechTimeout)
    clearTimeout(quiet)
    const previous = current
    current = undefined
    engine = undefined
    previous?.abort()
    if (speaking) env.speechSynthesis?.cancel()
    speaking = false
    report(message, false)
  }
  function schedule() {
    clearTimeout(restart)
    if (wanted && !current && !speaking) {
      report('다시 듣는 중…', true)
      const turn = generation
      restart = setTimeout(async () => {
        let permission
        try { permission = await env.navigator?.permissions?.query({ name: 'microphone' }) } catch {}
        if (!wanted || turn !== generation) return
        if (permission && permission.state !== 'granted') {
          stop('Chrome에서 마이크 허용이 필요해요. 사이트 설정에서 마이크 권한을 확인하세요.')
          return
        }
        listen()
      }, 400)
    }
  }
  function listen() {
    if (!wanted || current || speaking) return
    const recognition = engine ??= new Recognition()
    current = recognition
    recognition.lang = 'ko-KR'
    recognition.continuous = true
    recognition.interimResults = false
    let heard = false, started = false, outputSpeech = false
    recognition.onspeechstart = () => { outputSpeech = Boolean(speaking) }
    recognition.onstart = () => {
      if (current !== recognition) return
      started = true
      clearTimeout(watchdog)
      report('듣고 있어요', true)
    }
    recognition.onresult = event => {
      if (!wanted || current !== recognition || speaking || outputSpeech) return
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue
        heard = true
        misses = 0
        const text = event.results[i][0].transcript
        speaking = true
        announce(text)
        break
      }
    }
    recognition.onerror = event => {
      if (current !== recognition) return
      if (!['no-speech', 'aborted'].includes(event.error))
        stop('음성 연결이 중단됐어요. 권한과 연결을 확인한 뒤 다시 시작하세요.')
    }
    recognition.onend = () => {
      if (current !== recognition) return
      current = undefined
      clearTimeout(watchdog)
      if (!started && !heard) return stop('음성이 중단됐어요. 다시 시작하세요.')
      if (!heard && ++misses >= 4) return stop('음성이 중단됐어요. 다시 시작하세요.')
      schedule()
    }
    try {
      recognition.start()
      watchdog = setTimeout(() => {
        if (current === recognition && !started) stop('음성이 중단됐어요. 다시 시작하세요.')
      }, 8000)
    } catch { stop('음성을 시작할 수 없어요. 다시 시작하세요.') }
  }
  async function announce(text) {
    const turn = generation
    report('명령 확인 중…', true)
    let message
    try { message = await receive(text, () => wanted && generation === turn) } catch (error) { message = error.message }
    if (!wanted || generation !== turn) return
    report(message, true)
    const finish = () => {
      if (generation !== turn || !speaking) return
      clearTimeout(speechTimeout)
      clearTimeout(quiet)
      quiet = setTimeout(() => {
        speaking = false
        if (current) report('듣고 있어요', true)
        else schedule()
      }, 500)
    }
    if (!env.speechSynthesis || !env.SpeechSynthesisUtterance) return finish()
    const utterance = new env.SpeechSynthesisUtterance(message)
    utterance.lang = 'ko-KR'
    const koreanVoice = env.speechSynthesis.getVoices().find(voice => /^ko(?:-|_|$)/i.test(voice.lang))
    if (koreanVoice) utterance.voice = koreanVoice
    utterance.onend = finish
    utterance.onerror = finish
    speechTimeout = setTimeout(() => {
      env.speechSynthesis.cancel()
      finish()
    }, 20000)
    env.speechSynthesis.speak(utterance)
  }
  return { supported: Boolean(Recognition), stop, start() {
    if (!Recognition || wanted) return
    wanted = true
    misses = 0
    report('마이크 연결 중…', true)
    listen()
  } }
}

