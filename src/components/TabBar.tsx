import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, m } from 'motion/react'
import Icon from './Icon'
import ReportTypeIcon from './ReportTypeIcon'
import { useLongPress } from './useLongPress'
import { fanHit, fanOffsets, fanShiftX, type Pt } from '../lib/gesture'
import { haptic } from '../lib/haptic'
import { goCircle } from '../lib/circleReveal'
import { FADE, FADE_OUT, SPRING } from '../lib/motionTokens'
import { go, type PageId } from '../lib/nav'
import { FAN_ITEMS, fanTarget, TAB_ITEMS } from '../lib/tabs'
import { prefersCalm } from '../lib/viewPrefs'

// 부채꼴: 중심(제보 원)에서 반지름 FAN_R, 가운데 방향에서 좌우 FAN_SPREAD도까지. 항목은 64px 정사각형(한 번 누르기에 충분히 큼)
const FAN_R = 140
const FAN_SPREAD = 72
const FAN_HALF = 32
const FAN_HIT = 38
/** 길게 누른 뒤 이만큼(px) 안에서 떼면 「그냥 길게 눌렀다」로 보고 메뉴를 열어 둔다(눌러서 고르기) */
const FAN_STAY = 24
const REPORT_TO = TAB_ITEMS.find((t) => t.fab)?.to ?? '#/report'

type Mode = 'drag' | 'tap' | 'key'
type Fan = { page: PageId; mode: Mode; center: Pt; offsets: Pt[] }

// 모바일은 아래 고정, PC는 위쪽 내비게이션(CSS가 정한다). 가운데 [제보]는 탭 바 위로 솟은 원형 버튼(PC에서는 강조 버튼).
// [제보]: 짧게 누르기 = 제보 화면. 길게 누르기(또는 위쪽 화살표·메뉴 키·마우스 오른쪽 버튼) = 자주 쓰는 유형 5개 부채꼴 → 고르면 그 유형이 선택된 제보 화면.
export default function TabBar({ page }: { page: PageId }) {
  const fabRef = useRef<HTMLButtonElement>(null)
  const circleRef = useRef<HTMLSpanElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [fan, setFan] = useState<Fan | null>(null)
  const [hover, setHover] = useState(-1)
  const [picked, setPicked] = useState(-1)
  const drag = useRef<{ center: Pt; offsets: Pt[]; sx: number; sy: number; far: boolean } | null>(null)
  const hoverRef = useRef(-1)
  const timer = useRef(0)
  const open = fan && fan.page === page ? fan : null
  useEffect(() => () => clearTimeout(timer.current), [])

  const layout = (): { center: Pt; offsets: Pt[] } => {
    const r = (circleRef.current ?? fabRef.current)?.getBoundingClientRect()
    const center = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight - 40 }
    const raw = fanOffsets(FAN_ITEMS.length, FAN_R, FAN_SPREAD, center.y < innerHeight / 2 ? 'down' : 'up') // PC는 탭 바가 위라 아래로 펼친다
    const sx = fanShiftX(center.x, raw, FAN_HALF, innerWidth)
    return { center, offsets: raw.map((o) => ({ x: o.x + sx, y: o.y })) }
  }
  const openFan = (mode: Mode) => {
    hoverRef.current = -1
    setHover(-1)
    setPicked(-1)
    setFan({ page, mode, ...layout() })
  }
  const close = (refocus = false) => {
    drag.current = null
    hoverRef.current = -1
    clearTimeout(timer.current)
    setFan(null)
    setHover(-1)
    setPicked(-1)
    if (refocus) fabRef.current?.focus()
  }
  const choose = (i: number) => {
    if (picked >= 0) return
    haptic('tick')
    setPicked(i)
    drag.current = null
    const target = fanTarget(FAN_ITEMS[i])
    timer.current = window.setTimeout(
      () => {
        setFan(null)
        setPicked(-1)
        go(target)
      },
      prefersCalm() ? 0 : 150,
    )
  }

  const setRing = (p: number) => ringRef.current?.setAttribute('stroke-dashoffset', String(100 - p * 100))
  const lp = useLongPress({
    onProgress: setRing,
    onFire: ({ x, y }) => {
      const l = layout()
      drag.current = { ...l, sx: x, sy: y, far: false }
      hoverRef.current = -1
      setHover(-1)
      setPicked(-1)
      setFan({ page, mode: 'drag', ...l })
      haptic('tick')
    },
  })

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    lp.handlers.onPointerMove(e)
    const d = drag.current
    if (!d) return
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > FAN_STAY) d.far = true
    const h = fanHit(e.clientX - d.center.x, e.clientY - d.center.y, d.offsets, FAN_HIT)
    if (hoverRef.current !== h && h >= 0) haptic('tick')
    hoverRef.current = h
    setHover(h)
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    lp.handlers.onPointerUp()
    const d = drag.current
    if (!d) return
    drag.current = null
    const h = fanHit(e.clientX - d.center.x, e.clientY - d.center.y, d.offsets, FAN_HIT)
    if (h >= 0) choose(h)
    else if (d.far) close()
    else setFan((f) => (f ? { ...f, mode: 'tap' } : f)) // 제자리에서 뗐으면 메뉴를 열어 두고 눌러서 고르게 한다
  }
  const onPointerCancel = () => {
    lp.handlers.onPointerCancel()
    if (drag.current) close()
  }
  const onFabClick = () => {
    if (lp.fired.current) {
      lp.fired.current = false // 길게 누른 뒤의 click은 짧게 누르기로 세지 않는다
      return
    }
    close()
    // 제보 원에서 새 화면이 원으로 퍼진다(미지원·움직임 줄이기면 그냥 이동)
    const r = (circleRef.current ?? fabRef.current)?.getBoundingClientRect()
    if (r) goCircle(REPORT_TO, r.left + r.width / 2, r.top + r.height / 2)
    else go(REPORT_TO)
  }
  const onFabKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      openFan('key')
    }
  }
  const onFabContext = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (!drag.current && !open) openFan('tap') // 마우스 오른쪽 버튼. 터치 길게 누르기는 이미 열려 있다
  }
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const cur = itemRefs.current.findIndex((el) => el === document.activeElement)
    const n = FAN_ITEMS.length
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (cur + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (cur - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (to >= 0) {
      e.preventDefault()
      itemRefs.current[to]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'Tab') close()
  }

  // 열려 있는 동안 Esc로 닫고, 창 크기·포커스가 바뀌면 자리가 틀어지니 닫는다
  const isOpen = !!open
  useEffect(() => {
    if (!isOpen) ringRef.current?.setAttribute('stroke-dashoffset', '100') // 닫히면 진행 고리를 비운다
  }, [isOpen])
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    const onGone = () => close()
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onGone)
    window.addEventListener('blur', onGone)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onGone)
      window.removeEventListener('blur', onGone)
    }
    // close는 매 렌더 새로 만들어지지만 상태만 바꾸므로 열림이 바뀔 때만 다시 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])
  // 키보드로 열었으면 첫 항목에 포커스
  const mode = open?.mode
  useEffect(() => {
    if (mode === 'key') itemRefs.current[0]?.focus()
  }, [mode])

  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      {TAB_ITEMS.map((t) =>
        t.fab ? (
          <button
            key={t.page}
            ref={fabRef}
            type="button"
            className={'tabbar-btn tabbar-fab' + (open ? ' is-open' : '')}
            aria-current={page === t.page ? 'page' : undefined}
            aria-label="제보하기"
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-describedby="fabm-hint"
            onClick={onFabClick}
            onKeyDown={onFabKey}
            onPointerDown={lp.handlers.onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onContextMenu={onFabContext}
          >
            <span ref={circleRef} className="tabbar-fab-c" aria-hidden="true">
              <svg className="fabm-ring" viewBox="0 0 68 68" focusable="false">
                <circle ref={ringRef} cx="34" cy="34" r="32" pathLength="100" strokeDasharray="100" strokeDashoffset="100" transform="rotate(-90 34 34)" />
              </svg>
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </span>
          </button>
        ) : (
          <button key={t.page} type="button" className="tabbar-btn" aria-current={page === t.page ? 'page' : undefined} aria-label={t.label} onClick={() => go(t.to)} onPointerDown={() => haptic('tick')}>
            {page === t.page && <m.span layoutId="tabbar-ind" className="tabbar-ind" transition={SPRING.quick} aria-hidden="true" />}
            {/* 누르면 아이콘이 작아졌다가 손을 뗄 때 살짝 튕겨 돌아온다(B3) */}
            <m.span className="tb-ic" whileTap={{ scale: 0.82 }} transition={SPRING.pop} aria-hidden="true">
              <Icon name={t.icon} size={22} />
            </m.span>
            <span>{t.label}</span>
          </button>
        ),
      )}
      <span id="fabm-hint" className="sr-only">
        길게 누르거나 위쪽 화살표를 누르면 자주 쓰는 유형을 바로 고를 수 있어요.
      </span>
      <AnimatePresence>
        {open && <m.div key="scrim" className="fabm-scrim" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: FADE_OUT }} transition={FADE} onPointerDown={() => close()} />}
        {open && (
          <m.div
            key="menu"
            className="fabm"
            role="menu"
            aria-label="제보 유형 바로 고르기"
            style={{ left: open.center.x, top: open.center.y }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            onKeyDown={onMenuKey}
          >
            {FAN_ITEMS.map((it, i) => (
              <m.button
                key={it.label}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                type="button"
                role="menuitem"
                className={'fabm-it' + (hover === i ? ' is-hover' : '') + (picked === i ? ' is-picked' : '')}
                tabIndex={open.mode === 'key' && i === 0 ? 0 : -1}
                initial={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
                animate={{ x: open.offsets[i].x, y: open.offsets[i].y, scale: 1, opacity: 1 }}
                transition={{ ...SPRING.pop, delay: i * 0.03, opacity: FADE }}
                onClick={() => choose(i)}
              >
                <span className="fabm-in">
                  {it.type ? (
                    <ReportTypeIcon type={it.type} size={22} />
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                      <circle cx="5" cy="12" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="19" cy="12" r="2" />
                    </svg>
                  )}
                  <span>{it.label}</span>
                </span>
              </m.button>
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </nav>
  )
}
