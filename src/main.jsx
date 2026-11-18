import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { apply, sessionOf, quantity, search, parseSpeech, voiceCountAction, undoTarget, labelQuantity } from './model.js'
import { transact, validateBackup } from './db.js'
import { createVoice } from './voice.js'
import './style.css'

const verbs = { set: '수량 설정', add: '추가', subtract: '차감' }
const date = value => new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
const icons = {
  box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10 M7.5 5l9 4',
  mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 10v1a7 7 0 0 0 14 0v-1 M12 18v4 M9 22h6',
  search: 'M15.5 15.5L21 21 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0z',
  plus: 'M12 5v14 M5 12h14', history: 'M3 12a9 9 0 1 1 2.5 6.2 M3 5v7h7 M12 7v5l3 2',
  settings: 'M4 7h16 M4 17h16 M9 4v6 M15 14v6', stop: 'M6 6h12v12H6z',
}
function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]}/></svg>
}
function App() {
  const [state, setState] = useState(null)
  const [tab, setTab] = useState('stock')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [dialog, setDialog] = useState(null)
  const [candidate, setCandidate] = useState(null)
  const [notice, setNotice] = useState('')
  const [voice, setVoice] = useState({ message: '음성이 꺼져 있어요', active: false })
  const [transcript, setTranscript] = useState('')
  const [offlineReady, setOfflineReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(null)
  const selected = useRef(null)
  const controller = useRef(null)
  const modal = useRef(null)
  const busyRef = useRef(false)
  const channel = useRef(null)

  async function commit(action, replacement) {
    const updated = await transact(replacement ? () => replacement : data => apply(data, action))
    setState(updated)
    channel.current?.postMessage('updated')
    return updated
  }
  async function run(work) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setNotice('')
    try { await work() } catch (error) { setNotice(error.message) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function setPending(value) {
    pending.current = value
    setCandidate(value)
  }
  function stopVoice(message) {
    controller.current?.stop(message)
    setPending(null)
    selected.current = null
  }
  async function resolveCommand(data, session, command, product) {
    const before = quantity(session, product.id)
    selected.current = { session: session.id, id: product.id }
    if (command.kind === 'lookup') return product.name + ', ' + labelQuantity(before) + '입니다.'
    const updated = await commit(voiceCountAction(session, product, command))
    const after = quantity(sessionOf(updated), product.id)
    const message = product.name + ', ' + labelQuantity(after) + '로 저장했습니다.'
    setNotice(message)
    return message
  }
  async function receive(text, isCurrent) {
    setTranscript(text)
    const answer = text.trim().replace(/[.!?。]+$/, '')
    const data = await transact()
    if (!isCurrent()) return ''
    setState(data)
    const session = sessionOf(data)
    if (!session) return '먼저 새 조사를 시작해 주세요.'
    const waiting = pending.current
    if (waiting) {
      if (waiting.session !== session.id) { setPending(null); return '조사가 바뀌었어요. 다시 말해 주세요.' }
      if (/^(취소|아니|아니요)$/.test(answer)) { setPending(null); return '취소했습니다.' }
      const matches = search(waiting.products, answer)
      if (matches.length && matches.filter(item => item.score === 100).length === 1) {
        setPending(null)
        return resolveCommand(data, session, waiting.command, matches[0].product)
      }
      return '화면의 제품을 선택하거나 정확한 제품명을 말해 주세요. 취소도 가능합니다.'
    }
    if (/^(확인|취소|네|예|아니요)$/.test(answer)) return '제품명이나 수량 명령을 말해 주세요.'
    const command = parseSpeech(answer)
    if (command.kind === 'unclear') return '수량과 동작을 다시 말해 주세요. 예를 들어, 두 보루 추가.'
    if (!command.name && command.kind !== 'lookup') {
      const product = selected.current?.session === session.id && data.products.find(item => item.id === selected.current.id)
      return product ? resolveCommand(data, session, command, product) : '먼저 제품명을 말해 주세요.'
    }
    if (!command.name) return '제품명을 말해 주세요.'
    const matches = search(data.products, command.name)
    if (!matches.length) { selected.current = null; return '제품을 찾지 못했어요. 이름을 다시 말해 주세요.' }
    if (matches[0].score === 100 && matches[1]?.score !== 100)
      return resolveCommand(data, session, command, matches[0].product)
    if (command.kind === 'lookup' && matches.length === 1 && matches[0].score === 80)
      return resolveCommand(data, session, command, matches[0].product)
    selected.current = null
    const products = matches.slice(0, 6).map(item => item.product)
    setPending({ session: session.id, command, products })
    return '어떤 제품인가요? ' + products.slice(0, 3).map(item => item.name).join(', ') + '.'
  }

  useEffect(() => {
    let mounted = true
    const report = (message, active) => {
      setVoice({ message, active })
      if (!active) {
        setPending(null)
        selected.current = null
      }
    }
    controller.current = createVoice(window, receive, report)
    const refresh = () => transact().then(value => { if (mounted) setState(value) }).catch(error => {
      if (mounted) setNotice(error.message)
    })
    refresh()
    channel.current = typeof BroadcastChannel === 'function' ? new BroadcastChannel('boru-data') : null
    if (channel.current) channel.current.onmessage = refresh
    const visibility = () => { if (document.hidden) stopVoice('화면을 벗어나 음성을 중지했어요.') }
    document.addEventListener('visibilitychange', visibility)
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => {
        if (mounted) setOfflineReady(true)
      }).catch(() => { if (mounted) setNotice('오프라인 화면 저장에 실패했습니다.') })
    }
    return () => {
      mounted = false
      channel.current?.close()
      controller.current.stop()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  useEffect(() => {
    if (dialog) modal.current?.showModal()
    else modal.current?.close()
  }, [dialog])

  const session = state && sessionOf(state)
  const products = state?.products ?? []
  const counts = new Map(session?.events.map(event => [event.product, event.after]))
  const checked = products.filter(product => counts.get(product.id) != null).length
  const progress = products.length ? Math.round(checked / products.length * 100) : 0
  const matches = search(products, query).map(({ product }) => product).filter(product =>
    tab !== 'stock' || filter === 'all' || (counts.get(product.id) != null) === (filter === 'checked'))
  const undo = undoTarget(session)

  function openDialog(value) { stopVoice(); setNotice(''); setDialog(value) }
  function switchTab(value) { setTab(value); setQuery(''); setNotice('') }
  function download() {
    return run(async () => {
      const backup = await transact()
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'boru-backup-' + new Date().toISOString().slice(0, 10) + '.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('백업 파일을 다운로드했습니다.')
    })
  }
  return <>
    <header className="bar"><div className="shell flex items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="brand"><Icon name="box"/></span><h1>보루 재고조사</h1></div>
      <span className="local"><i/>{offlineReady ? '오프라인 준비 완료' : '기기 저장'}</span>
    </div></header>
    <main className="shell">
      <section className="hero">
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div><p className="eyebrow">조사 진행률</p><h2>{checked}<small> / {products.length}개 확인</small></h2></div>
          <button className="hero-btn" disabled={!state} onClick={() => openDialog({ type: 'session' })}><Icon name="plus" size={17}/> 새 조사</button>
        </div>
        <div className="track" role="progressbar" aria-label="조사 진행률" aria-valuenow={progress}><span style={{ width: progress + '%' }}/></div>
        <div className="flex justify-between gap-3 hero-meta"><span>{session ? date(session.at) + ' 시작' : '진행 중인 조사 없음'}</span><span>{progress}%</span></div>
      </section>

      <section className="voice">
        <div className="flex items-center gap-3"><span className="mic"><Icon name="mic"/></span><div><h2>음성 조작</h2><p role="status">{voice.message}</p></div></div>
        <button className={voice.active ? 'danger' : 'primary'} disabled={!session || !controller.current?.supported}
          onClick={() => voice.active ? stopVoice() : controller.current.start()}>
          <Icon name={voice.active ? 'stop' : 'mic'} size={17}/>{voice.active ? '음성 중지' : '음성 시작'}</button>
        {transcript && <p className="voice-extra">인식한 말 · {transcript}</p>}
        {candidate && <div className="voice-extra pending">
          <strong>제품을 선택해 주세요</strong><div className="flex flex-wrap gap-2 mt-2">
            {candidate.products.map(product => <button key={product.id} disabled={busy} onClick={() => run(async () => {
              const data = await transact()
              if (pending.current !== candidate || sessionOf(data)?.id !== candidate.session) return
              setPending(null)
              setNotice(await resolveCommand(data, sessionOf(data), candidate.command, product))
            })}>{product.name}</button>)}
          </div>
          <button className="mt-2" onClick={() => setPending(null)}>취소</button>
        </div>}
      </section>
      <nav aria-label="메뉴" className="tabs">
        {[['stock','box','재고'], ['catalog','plus','제품'], ['history','history','이력'], ['backup','settings','설정']].map(([key, icon, label]) =>
          <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => switchTab(key)}><Icon name={icon} size={18}/>{label}</button>)}
      </nav>

      {(tab === 'stock' || tab === 'catalog') && <section>
        <div className="heading"><h2>{tab === 'stock' ? '재고 목록' : '제품 카탈로그'}</h2><button disabled={!state} onClick={() => openDialog({ type: 'product' })}><Icon name="plus" size={17}/>제품 추가</button></div>
        <label className="search"><Icon name="search"/><input aria-label="제품명 검색" placeholder="제품명 또는 별칭 검색" value={query} onChange={event => setQuery(event.target.value)}/></label>
        {tab === 'stock' && <div className="filters">{[['all','전체'], ['unchecked','미확인'], ['checked','확인 완료']].map(([key, label]) =>
          <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>}
        <div className="list">
          {matches.map(product => <article className="row" key={product.id}>
            <span className="item-icon"><Icon name="box" size={19}/></span>
            <div className="grow min-w-0"><h3>{product.name}</h3>{product.aliases.length > 0 && <p>{product.aliases.join(' · ')}</p>}</div>
            {tab === 'stock' ? <>
              <strong className={counts.get(product.id) == null ? 'unknown' : 'count'}>{labelQuantity(counts.get(product.id) ?? null)}</strong>
              <button disabled={!session} aria-label={product.name + ' 수량 입력'} onClick={() => openDialog({ type: 'count', product, session: session.id, before: counts.get(product.id) ?? null })}>입력</button>
            </> : <button aria-label={product.name + ' 수정'} onClick={() => openDialog({ type: 'product', product })}>수정</button>}
          </article>)}
          {!matches.length && <div className="empty"><span className="item-icon"><Icon name={query ? 'search' : 'box'} size={24}/></span>
            <h3>{!state ? '저장소를 여는 중…' : products.length ? '조건에 맞는 제품이 없어요' : '등록된 제품이 없어요'}</h3>
            {state && !products.length && <p>제품을 추가한 뒤 새 조사를 시작하세요.</p>}</div>}
        </div>
      </section>}
      {tab === 'history' && <section>
        <div className="heading"><h2>변경 이력</h2><button disabled={!undo || busy} onClick={() => run(async () => {
          stopVoice(); await commit({ type: 'undo', session: session.id, id: undo.id }); setNotice('최근 변경을 되돌렸습니다.')
        })}><Icon name="history" size={17}/>최근 변경 되돌리기</button></div>
        <label className="field">조사 선택<select value={state?.active ?? ''} onChange={event => {
          const id = event.target.value
          run(async () => { stopVoice(); await commit({ type: 'select', id }) })
        }}>
          {!state?.sessions.length && <option value="">저장된 조사 없음</option>}
          {state?.sessions.toReversed().map(item => <option key={item.id} value={item.id}>{date(item.at)} 조사</option>)}
        </select></label>
        <div className="list">
          {session?.events.toReversed().map(event => <article key={event.id} className="row">
            <div className="grow"><h3>{products.find(product => product.id === event.product)?.name}</h3><p>{date(event.at)}{event.undo ? ' · 되돌리기' : ''}</p></div>
            <strong>{labelQuantity(event.before)} → {labelQuantity(event.after)}</strong>
          </article>)}
          {!session?.events.length && <div className="empty">아직 수량 변경이 없어요.</div>}
        </div>
      </section>}
      {tab === 'backup' && <section>
        <div className="heading"><h2>백업 및 복원</h2></div>
        <div className="settings"><p>제품, 조사, 변경 이력을 JSON 파일로 보관할 수 있어요.</p>
          <div className="flex flex-wrap gap-2"><button className="primary" disabled={!state || busy} onClick={download}>백업 다운로드</button>
          <button disabled={!state} onClick={() => openDialog({ type: 'restore' })}>백업 복원</button></div>
        </div>
        <div className="settings"><h3>음성 명령</h3><p>제품명만 말하면 수량을 읽어 줍니다. “2보루 추가”, “1보루 차감”, “3보루로 변경”은 제품이 확실하면 바로 저장합니다. 미확인 품목에 처음 추가한 수량은 첫 조사 수량으로 기록됩니다.</p><p>마이크 동의가 반복되면 Chrome 주소창 왼쪽의 사이트 정보에서 이 사이트의 마이크 권한을 확인하세요.</p></div>
      </section>}
      {!dialog && notice && <p className="notice" role="status">{notice}</p>}
    </main>
    <dialog ref={modal} onCancel={event => { event.preventDefault(); if (!busy) setDialog(null) }}>
      {dialog && <form key={dialog.type} onSubmit={event => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        run(async () => {
          if (dialog.type === 'session') {
            await commit({ type: 'session' })
            setFilter('all')
            switchTab('stock')
          } else if (dialog.type === 'product') {
            await commit({ type: 'product', id: dialog.product?.id, name: form.get('name'), aliases: form.get('aliases') })
            setNotice('제품을 저장했습니다.')
          } else if (dialog.type === 'count') {
            await commit({ type: 'count', session: dialog.session, id: dialog.product.id, expected: dialog.before,
              kind: form.get('kind'), amount: Number(form.get('amount')) })
            setNotice('수량을 저장했습니다.')
          } else {
            const file = form.get('backup')
            if (!file?.size) throw Error('백업 파일을 선택해 주세요.')
            let data
            try { data = JSON.parse(await file.text()) } catch { throw Error('JSON 백업 파일을 읽을 수 없습니다.') }
            await commit(null, validateBackup(data))
            setNotice('백업을 복원했습니다.')
          }
          setDialog(null)
        })
      }}>
        <h2>{{ session: '새 조사 시작', product: dialog.product ? '제품 수정' : '제품 추가', count: dialog.product?.name, restore: '백업 복원' }[dialog.type]}</h2>
        {dialog.type === 'session' && <p>모든 제품이 미확인으로 시작합니다. 이전 조사는 이력에서 열 수 있어요.</p>}
        {dialog.type === 'product' && <>
          <label className="field">제품명<input name="name" required maxLength={100} defaultValue={dialog.product?.name} placeholder="예: 에쎄 수 0.1"/></label>
          <label className="field">별칭 (쉼표로 구분)<input name="aliases" maxLength={500} defaultValue={dialog.product?.aliases.join(', ')} placeholder="예: 에쎄수, 수 0.1"/></label>
        </>}
        {dialog.type === 'count' && <>
          <p>현재 수량 · {labelQuantity(dialog.before)}</p>
          <label className="field">동작<select name="kind">{Object.entries(verbs).map(([key, label]) =>
            <option key={key} value={key} disabled={key !== 'set' && dialog.before === null}>{label}</option>)}</select></label>
          <label className="field">보루 수량<input name="amount" type="number" inputMode="numeric" min="0" step="1" max={Number.MAX_SAFE_INTEGER} required /></label>
        </>}
        {dialog.type === 'restore' && <>
          <p>현재 기기의 제품, 조사, 변경 이력이 백업 파일의 내용으로 교체됩니다.</p>
          <label className="field">백업 파일<input name="backup" type="file" accept=".json,application/json" required/></label>
        </>}
        {notice && <p className="notice" role="alert">{notice}</p>}
        <div className="actions"><button type="button" disabled={busy} onClick={() => { setNotice(''); setDialog(null) }}>취소</button>
          <button className="primary" disabled={busy}>{dialog.type === 'session' ? '시작' : dialog.type === 'restore' ? '교체 및 복원' : '저장'}</button></div>
      </form>}
    </dialog>
  </>
}
createRoot(document.getElementById('root')).render(<App/>)

