import { useEffect, useRef } from 'react'
import { closeConfirm, dismissNotice, useUi } from '../lib/uiStore'

// 확인 시트(바텀시트)와 토스트·스낵바를 그리는 곳. App에 한 번만 둔다.
function ConfirmSheet() {
  const req = useUi((s) => s.confirm)
  const ref = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!req) return
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus() // 실수로 엔터를 눌러도 위험한 쪽이 실행되지 않게 취소에 먼저 둔다
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation() // 뒤에 있는 화면의 Esc 처리로 넘기지 않는다
        closeConfirm(false)
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      // 포커스를 시트 안에 가둔다
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not(:disabled)'))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!ref.current.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [req])

  if (!req) return null
  return (
    <div className="cs-root">
      <div className="cs-dim" onClick={() => closeConfirm(false)} />
      <div ref={ref} className="cs-sheet" role="alertdialog" aria-modal="true" aria-labelledby="cs-title" aria-describedby={req.body ? 'cs-body' : undefined}>
        <h2 id="cs-title">{req.title}</h2>
        {req.body && <p id="cs-body">{req.body}</p>}
        <div className="cs-actions">
          <button ref={cancelRef} type="button" className="cs-cancel" onClick={() => closeConfirm(false)}>
            {req.cancelLabel ?? '취소'}
          </button>
          <button type="button" className={'cs-ok' + (req.danger ? ' danger' : '')} onClick={() => closeConfirm(true)}>
            {req.confirmLabel ?? '확인'}
          </button>
        </div>
      </div>
    </div>
  )
}

function NoticeBar() {
  const n = useUi((s) => s.notice)
  useEffect(() => {
    if (!n) return
    const t = window.setTimeout(dismissNotice, n.ms)
    return () => window.clearTimeout(t)
  }, [n])
  return (
    <div className="nt-lane" role="status" aria-live="polite">
      {n && (
        <div key={n.id} className="nt-item">
          <span>{n.message}</span>
          {n.undo && (
            <button
              type="button"
              onClick={() => {
                n.undo?.()
                dismissNotice()
              }}
            >
              {n.undoLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function UiLayer() {
  return (
    <>
      <ConfirmSheet />
      <NoticeBar />
    </>
  )
}
