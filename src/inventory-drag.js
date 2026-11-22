import { useEffect, useRef, useState } from 'react'

export function useInventoryDrag(onDrop, enabled) {
  const list = useRef(null)
  const drop = useRef(onDrop)
  drop.current = onDrop
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    const element = list.current
    if (!element || !enabled) return
    let gesture, timer, frame, suppressClick = false
    const nonPassive = { passive: false }

    function update() {
      if (!gesture?.active) return
      const y = gesture.y
      const edge = Math.min(90, innerHeight / 5)
      if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 7))
      if (y > innerHeight - edge) window.scrollBy(0, Math.ceil((y - (innerHeight - edge)) / 7))
      const rows = Array.from(element.querySelectorAll('[data-order-id]'))
      const row = rows.find(item => item.getBoundingClientRect().bottom >= y) ?? rows.at(-1)
      if (row) {
        const bounds = row.getBoundingClientRect()
        const target = row.dataset.orderId
        const after = y >= (bounds.top + bounds.bottom) / 2
        if (target !== gesture.target || after !== gesture.after) {
          Object.assign(gesture, { target, after })
          setPreview({ id: gesture.id, target, after })
        }
      }
      frame = requestAnimationFrame(update)
    }
    function finish(commit = false) {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      const current = gesture
      gesture = null
      if (!current?.active) return
      setPreview(null)
      if (commit && current.target && current.target !== current.id)
        drop.current(current.id, current.target, current.after)
    }
    function start(event, point, touch) {
      if (gesture) { finish(); return }
      const row = event.target.closest('[data-order-id]')
      if (!row || event.target.closest('button, input, a')) return
      suppressClick = false
      gesture = { id: row.dataset.orderId, x: point.clientX, y: point.clientY, touch, touchId: point.identifier }
      timer = setTimeout(() => {
        gesture.active = true
        suppressClick = true
        setPreview({ id: gesture.id })
        update()
      }, 420)
    }
    function move(event, point) {
      if (!point) return
      if (!gesture.active && Math.hypot(point.clientX - gesture.x, point.clientY - gesture.y) > 8) {
        finish()
        return
      }
      if (gesture.active) {
        if (event.cancelable) event.preventDefault()
        gesture.y = point.clientY
      }
    }
    const touchStart = event => { if (event.touches.length === 1) start(event, event.touches[0], true); else finish() }
    const touchMove = event => {
      if (gesture?.touch) move(event, Array.from(event.touches).find(point => point.identifier === gesture.touchId))
    }
    const touchEnd = event => {
      if (!gesture?.touch || !Array.from(event.changedTouches).some(point => point.identifier === gesture.touchId)) return
      if (gesture.active && event.cancelable) event.preventDefault()
      finish(true)
    }
    const mouseStart = event => { if (event.pointerType === 'mouse' && event.button === 0) start(event, event, false) }
    const mouseMove = event => { if (gesture && !gesture.touch) move(event, event) }
    const mouseEnd = () => { if (gesture && !gesture.touch) finish(true) }
    const cancel = () => finish()
    const blockMenu = event => { if (gesture || suppressClick) event.preventDefault() }
    const blockClick = event => {
      if (!suppressClick) return
      suppressClick = false
      if (!event.target.closest('button')) { event.preventDefault(); event.stopPropagation() }
    }
    element.addEventListener('touchstart', touchStart)
    element.addEventListener('pointerdown', mouseStart)
    element.addEventListener('contextmenu', blockMenu)
    element.addEventListener('click', blockClick, true)
    window.addEventListener('touchmove', touchMove, nonPassive)
    window.addEventListener('touchend', touchEnd, nonPassive)
    window.addEventListener('touchcancel', cancel)
    window.addEventListener('pointermove', mouseMove)
    window.addEventListener('pointerup', mouseEnd)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      cancel()
      element.removeEventListener('touchstart', touchStart)
      element.removeEventListener('pointerdown', mouseStart)
      element.removeEventListener('contextmenu', blockMenu)
      element.removeEventListener('click', blockClick, true)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('touchend', touchEnd)
      window.removeEventListener('touchcancel', cancel)
      window.removeEventListener('pointermove', mouseMove)
      window.removeEventListener('pointerup', mouseEnd)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [enabled])

  return { list, preview }
}
