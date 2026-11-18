export function createVoice(env, receive, report) {
  const Recognition = env.SpeechRecognition ?? env.webkitSpeechRecognition
  let wanted = false, current, restart, speaking, watchdog, generation = 0, misses = 0
  function stop(message = '음성 꺼짐') {
    wanted = false
    generation++
    clearTimeout(restart)
    clearTimeout(watchdog)
    const previous = current
    current = undefined
    previous?.abort()
    if (speaking) env.speechSynthesis?.cancel()
    speaking = false
    report(message, false)
  }
  function schedule() {
    clearTimeout(restart)
    if (wanted && !current && !speaking) {
      report('다시 듣는 중…', true)
      restart = setTimeout(listen, 400)
    }
  }
  function listen() {
    if (!wanted || current || speaking) return
    const recognition = new Recognition()
    current = recognition
    recognition.lang = 'ko-KR'
    recognition.continuous = true
    recognition.interimResults = false
    let heard = false, started = false
    recognition.onstart = () => {
      if (current !== recognition) return
      started = true
      clearTimeout(watchdog)
      report('듣고 있어요', true)
    }
    recognition.onresult = event => {
      if (!wanted || current !== recognition || speaking || heard) return
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue
        heard = true
        misses = 0
        const text = event.results[i][0].transcript
        speaking = true
        recognition.abort()
        announce(text)
        break
      }
    }
    recognition.onerror = event => {
      if (current !== recognition || heard) return
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
    try { message = await receive(text) } catch (error) { message = error.message }
    if (!wanted || generation !== turn) return
    report(message, true)
    const finish = () => {
      if (generation !== turn || !speaking) return
      clearTimeout(watchdog)
      speaking = false
      schedule()
    }
    if (!env.speechSynthesis || !env.SpeechSynthesisUtterance) return finish()
    const utterance = new env.SpeechSynthesisUtterance(message)
    utterance.lang = 'ko-KR'
    const koreanVoice = env.speechSynthesis.getVoices().find(voice => /^ko(?:-|_|$)/i.test(voice.lang))
    if (koreanVoice) utterance.voice = koreanVoice
    utterance.onend = finish
    utterance.onerror = finish
    watchdog = setTimeout(() => {
      env.speechSynthesis.cancel()
      finish()
    }, 20000)
    env.speechSynthesis.speak(utterance)
  }
  return { supported: Boolean(Recognition), isActive: () => wanted, stop, start() {
    if (!Recognition || wanted) return
    wanted = true
    misses = 0
    report('마이크 연결 중…', true)
    listen()
  } }
}

