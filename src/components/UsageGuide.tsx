// 사용법 슬라이드(팝업): 초기 설정을 마치면 한 번 뜨고, 홈의 「이용 안내」에서 다시 열 수 있다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../styles/usageGuide.css'
import Icon from './Icon'
import { prefersCalm } from '../lib/viewPrefs'
import { GUIDE_OPEN_EVENT, GUIDE_SLIDES, ONBOARDED_EVENT, clampSlide, guideSeen, homeAfterClose, markGuideSeen } from '../lib/usageGuide'

const N = GUIDE_SLIDES.length

export default function UsageGuide() {
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const track = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const show = () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setIdx(0)
      setOpen(true)
    }
    const onDone = () => {
      if (!guideSeen()) show()
    }
    window.addEventListener(ONBOARDED_EVENT, onDone)
    window.addEventListener(GUIDE_OPEN_EVENT, show)
    return () => {
      window.removeEventListener(ONBOARDED_EVENT, onDone)
      window.removeEventListener(GUIDE_OPEN_EVENT, show)
    }
  }, [])

  const close = useCallback(() => {
    markGuideSeen()
    setOpen(false)
    const to = homeAfterClose(location.hash)
    if (to && location.hash !== to) location.hash = to
    const el = opener.current
    opener.current = null
    if (el?.isConnected) el.focus({ preventScroll: true })
  }, [])

  const goTo = useCallback((i: number) => {
    const t = track.current
    const n = clampSlide(i)
    setIdx(n)
    t?.scrollTo({ left: n * t.clientWidth, behavior: prefersCalm() ? 'auto' : 'smooth' })
  }, [])

  // 열려 있는 동안 뒤 화면을 막고, 포커스를 팝업으로 옮긴다
  useEffect(() => {
    if (!open) return
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    dialog.current?.focus({ preventScroll: true })
    return () => root?.removeAttribute('inert')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') goTo(idx + 1)
      else if (e.key === 'ArrowLeft') goTo(idx - 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, idx, close, goTo])

  if (!open) return null
  const last = idx === N - 1
  return createPortal(
    <div className="ug-root" role="dialog" aria-modal="true" aria-label="이용 안내" ref={dialog} tabIndex={-1}>
      <header className="ug-head">
        <button type="button" className="ug-skip" onClick={close}>건너뛰기</button>
      </header>
      <div
        className="ug-track"
        ref={track}
        onScroll={(e) => {
          const t = e.currentTarget
          const i = clampSlide(Math.round(t.scrollLeft / Math.max(1, t.clientWidth)))
          if (i !== idx) setIdx(i)
        }}
      >
        {GUIDE_SLIDES.map((s, i) => (
          <section key={s.text} className="ug-slide" role="group" aria-roledescription="슬라이드" aria-label={`${i + 1} / ${N}`} aria-hidden={i !== idx || undefined}>
            <span className="ug-art"><Icon name={s.icon} size={88} /></span>
            <p className="ug-text">{s.text}</p>
          </section>
        ))}
      </div>
      <div className="ug-foot">
        <div className="ug-dots" role="img" aria-label={`${N}장 중 ${idx + 1}장`}>
          {GUIDE_SLIDES.map((s, i) => <span key={s.text} className={'ug-dot' + (i === idx ? ' is-cur' : '')} />)}
        </div>
        <button type="button" className="ug-next" onClick={() => (last ? close() : goTo(idx + 1))}>{last ? '시작하기' : '다음'}</button>
      </div>
    </div>,
    document.body,
  )
}
