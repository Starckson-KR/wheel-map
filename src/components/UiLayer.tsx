import { useEffect, useRef } from 'react'
import { AnimatePresence, m, useIsPresent } from 'motion/react'
import { closeConfirm, dismissNotice, useUi } from '../lib/uiStore'
import { PressButton } from './motionKit'
import { FADE, FADE_OUT, SPRING } from '../lib/motionTokens'
import { Sentences } from './Sentences'

// 확인 시트(바텀시트)와 토스트·스낵바를 그리는 곳. App에 한 번만 둔다.
type Req = NonNullable<ReturnType<typeof useUi.getState>['confirm']>

// 나가는 동안(isPresent=false)에는 포커스를 바로 돌려주고, 화면 읽기 프로그램·키보드·클릭에서 빠진다(inert).
function ConfirmView({ req }: { req: Req }) {
  const ref = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const present = useIsPresent()

  useEffect(() => {
    if (!present) return
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
  }, [present])

  return (
    <div className="cs-root" inert={!present} aria-hidden={!present || undefined}>
      <m.div className="cs-dim" onClick={() => closeConfirm(false)} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: FADE }} exit={{ opacity: 0, transition: FADE_OUT }} />
      <m.div
        ref={ref}
        className="cs-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cs-title"
        aria-describedby={req.body ? 'cs-body' : undefined}
        initial={{ y: '100%' }}
        animate={{ y: 0, transition: SPRING.sheet }}
        exit={{ y: '100%', transition: { ...SPRING.sheet, restDelta: 0.5 } }}
      >
        <h2 id="cs-title">{req.title}</h2>
        {req.body && <Sentences as="p" id="cs-body">{req.body}</Sentences>}
        <div className="cs-actions">
          <PressButton ref={cancelRef} type="button" className="cs-cancel" onClick={() => closeConfirm(false)}>
            {req.cancelLabel ?? '취소'}
          </PressButton>
          <PressButton type="button" className={'cs-ok' + (req.danger ? ' danger' : '')} onClick={() => closeConfirm(true)}>
            {req.confirmLabel ?? '확인'}
          </PressButton>
        </div>
      </m.div>
    </div>
  )
}

function ConfirmSheet() {
  const req = useUi((s) => s.confirm)
  return <AnimatePresence>{req && <ConfirmView key={req.id} req={req} />}</AnimatePresence>
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
      <AnimatePresence mode="popLayout" initial={false}>
      {n && (
        <m.div
          key={n.id}
          className="nt-item"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { y: SPRING.sheet, opacity: FADE } }}
          exit={{ opacity: 0, y: 6, transition: FADE_OUT }}
        >
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
        </m.div>
      )}
      </AnimatePresence>
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
