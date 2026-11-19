import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import ReportPhotos from './ReportPhotos'
import { usePhotoUrls } from '../lib/usePhotoUrls'
import { COMPARE_SCENES, sceneFor } from '../lib/compareScenes'
import { DEMO_SWEEP, crossed, nearerSide, posFromX, posText, stepPos } from '../lib/compareSlider'
import { lockAxis } from '../lib/gesture'
import { haptic } from '../lib/haptic'
import { prefersCalm } from '../lib/viewPrefs'
import { isSampleReport } from '../lib/samplePhotos'
import type { Report } from '../types'
import '../styles/interact-verify.css'

type Axis = 'x' | 'y' | null

/** 전 사진 위에 후 사진을 깔고, 가운데 선을 끌어 비교한다. 끌기 대신 「전/후」 버튼과 방향키로도 된다. */
function Slider({ before, after, alt, demo }: { before: string; after: string; alt: string; demo: boolean }) {
  const [pos, setPos] = useState(50)
  const [glide, setGlide] = useState(false) // 버튼·시범일 때만 부드럽게
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; axis: Axis } | null>(null)
  const touched = useRef(false)
  const posRef = useRef(50)

  const move = useCallback((next: number, smooth: boolean) => {
    if (crossed(posRef.current, next)) haptic('tick')
    posRef.current = next
    setGlide(smooth && !prefersCalm())
    setPos(next)
  }, [])

  // 처음 화면에 보일 때 한 번: 좌 → 우 → 가운데 시범(약 0.8초). 이미 만졌거나 움직임 줄이기면 하지 않는다.
  useEffect(() => {
    const el = stage.current
    if (!el || typeof IntersectionObserver === 'undefined' || prefersCalm()) return
    const timers: number[] = []
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return
        io.disconnect()
        DEMO_SWEEP.forEach((p, i) =>
          timers.push(
            window.setTimeout(() => {
              if (!touched.current) move(p, true)
            }, i * 280),
          ),
        )
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      timers.forEach(clearTimeout)
    }
  }, [move])

  const at = (clientX: number) => {
    const r = stage.current?.getBoundingClientRect()
    return r ? posFromX(clientX, r.left, r.width) : 50
  }

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    if (!d.axis) {
      d.axis = lockAxis(e.clientX - d.x, e.clientY - d.y)
      if (!d.axis) return
      if (d.axis === 'y') {
        drag.current = null // 세로면 스크롤에 맡긴다
        return
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // 무시
      }
    }
    touched.current = true
    move(at(e.clientX), false)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    // 거의 안 움직이고 뗀 한 번 누르기: 눌린 자리로 선을 옮긴다
    if (d.axis === null && e.type === 'pointerup') {
      touched.current = true
      move(at(e.clientX), true)
    }
  }
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const n = stepPos(pos, e.key)
    if (n === null) return
    e.preventDefault()
    touched.current = true
    move(n, false)
  }
  const jump = (to: number) => {
    touched.current = true
    haptic('tick')
    posRef.current = to
    setGlide(!prefersCalm())
    setPos(to)
  }
  const near = nearerSide(pos)

  return (
    <div className="cmp" role="group" aria-label="조치 전 후 사진 비교">
      <div
        ref={stage}
        className={'cmp-stage' + (glide ? ' is-glide' : '')}
        style={{ '--pos': `${pos}%` } as React.CSSProperties}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img className="cmp-img" src={after} alt={`조치 후 ${alt}`} draggable={false} />
        <img className="cmp-img cmp-before" src={before} alt={`조치 전 ${alt}`} draggable={false} />
        <span className="cmp-tag cmp-tag-b" aria-hidden="true">조치 전</span>
        <span className="cmp-tag cmp-tag-a" aria-hidden="true">조치 후</span>
        <span className="cmp-line" aria-hidden="true" />
        <button
          type="button"
          className="cmp-handle"
          role="slider"
          aria-label="조치 전후 비교 선"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={posText(pos)}
          onKeyDown={onKey}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="cmp-btns">
        <button type="button" className={near === 'before' ? 'on' : ''} aria-pressed={pos >= 99} onClick={() => jump(100)}>
          전
        </button>
        <button type="button" className={near === 'after' ? 'on' : ''} aria-pressed={pos <= 1} onClick={() => jump(0)}>
          후
        </button>
      </div>
      {demo && <p className="adm-demo cmp-demo">시연용 가상 그림 · 실제 현장 사진이 아니에요</p>}
    </div>
  )
}

// 조치 전/후 사진 비교. 조치 전 사진이 없으면 제보 사진을 대신 쓴다. 사진이 없는 시연 데이터는 직접 그린 시연용 그림을 쓴다.
export default function BeforeAfter({ report: r }: { report: Report }) {
  const own = r.action?.beforePhotos ?? []
  const afterKeys = r.action?.afterPhotos ?? []
  const fallback = own.length === 0 && r.photos.length > 0
  const beforeKeys = own.length > 0 ? own : r.photos
  const b = usePhotoUrls(beforeKeys)
  const a = usePhotoUrls(afterKeys)
  const isDemo = !!r.demo || r.demoSet === 'large' || isSampleReport(r)

  if (afterKeys.length === 0) {
    if (isDemo) {
      const s = COMPARE_SCENES[sceneFor(r.type)]
      return <Slider before={s.before} after={s.after} alt={s.alt} demo />
    }
    return <p className="ba-empty">조치 사진이 아직 없어요</p>
  }
  const bu = b.urls.find((u): u is string => !!u)
  const au = a.urls.find((u): u is string => !!u)
  const loaded = a.urls.length === afterKeys.length && (beforeKeys.length === 0 || b.urls.length === beforeKeys.length)
  if (bu && au) return <Slider before={bu} after={au} alt={r.type} demo={false} />
  if (!loaded) return <p className="ba-empty">사진을 불러오고 있어요</p>

  return (
    <div className="ba" role="group" aria-label="조치 전 후 사진 비교">
      <figure>
        <figcaption>조치 전{fallback ? ' (제보 사진)' : ''}</figcaption>
        {beforeKeys.length > 0 ? <ReportPhotos keys={beforeKeys} /> : <p className="ba-none">조치 전 사진이 없어요</p>}
      </figure>
      <figure>
        <figcaption>조치 후</figcaption>
        <ReportPhotos keys={afterKeys} />
      </figure>
    </div>
  )
}
