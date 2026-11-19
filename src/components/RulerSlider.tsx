import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { haptic } from '../lib/haptic'
import { lockAxis } from '../lib/gesture'
import {
  TIER_TEXT,
  clampTo,
  crossedLine,
  formatValue,
  parseValue,
  ratioOf,
  stepValue,
  valueFromX,
  type RulerSpec,
} from '../lib/ruler'

type Props = {
  spec: RulerSpec
  label: string
  /** 입력칸과 같은 문자열 값(비어 있으면 아직 안 잼) */
  value: string
  onChange: (next: string) => void
}

/**
 * 줄자 끌기: 막대를 끌어(또는 눌러, −/+ 버튼으로) 폭·턱 높이를 맞춘다. 판정 선을 지나면 색·글자가 바뀌고 진동이 한 번 난다.
 * 세로 스크롤은 그대로 두고(touch-action: pan-y) 가로로 8px 넘게 움직일 때만 끌기로 본다. 숫자 입력칸은 그대로 따로 있다.
 */
export default function RulerSlider({ spec, label, value, onChange }: Props) {
  const id = useId()
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; axis: 'x' | null } | null>(null)
  const last = useRef<number | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const [flash, setFlash] = useState(0)

  const num = parseValue(value)
  const has = num !== undefined
  const tier = has ? spec.tierOf(num) : null
  const p = has ? ratioOf(spec, num) : 0

  const apply = (v: number) => {
    const c = clampTo(spec, v)
    const prev = last.current ?? num
    if (prev !== undefined && prev !== c && crossedLine(spec, prev, c)) {
      haptic('tick')
      setFlash((n) => n + 1)
    }
    last.current = c
    onChange(formatValue(spec, c))
  }
  const fromClientX = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return
    apply(valueFromX(spec, clientX - r.left, r.width))
  }

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    last.current = num
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null }
    if (e.pointerType === 'mouse') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // 무시
      }
      drag.current.axis = 'x'
      setDragging(true)
    }
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!d.axis) {
      const a = lockAxis(e.clientX - d.x, e.clientY - d.y)
      if (!a) return
      if (a === 'y') {
        drag.current = null // 세로: 화면 스크롤에 맡긴다
        return
      }
      d.axis = 'x'
      setDragging(true)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // 무시
      }
    }
    fromClientX(e.clientX)
  }
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.axis) fromClientX(e.clientX) // 끌지 않고 눌렀다 뗌 → 그 자리로
    setDragging(false)
  }
  const cancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null
    setDragging(false)
  }

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key
    let next: number | undefined
    if (k === 'ArrowLeft' || k === 'ArrowDown') next = stepValue(spec, num, -1)
    else if (k === 'ArrowRight' || k === 'ArrowUp') next = stepValue(spec, num, 1)
    else if (k === 'PageDown') next = stepValue(spec, num, -1, true)
    else if (k === 'PageUp') next = stepValue(spec, num, 1, true)
    else if (k === 'Home') next = spec.min
    else if (k === 'End') next = spec.max
    if (next === undefined) return
    e.preventDefault()
    last.current = num
    apply(next)
  }
  const stepBy = (dir: -1 | 1) => {
    last.current = num
    apply(stepValue(spec, num, dir))
  }

  const readout = has ? `${formatValue(spec, num)}${spec.unit}` : '-'
  const tierLabel = tier ? TIER_TEXT[tier] : '끌어서 맞춰 보세요'

  return (
    <div className="rl" data-tier={tier ?? 'none'}>
      <div className="rl-head">
        <span id={id} className="rl-label">
          {label}
        </span>
        <span className="rl-read" aria-hidden="true">
          <b>{readout}</b>
          <i key={flash} className={'rl-tier' + (flash ? ' is-flash' : '')}>
            {tierLabel}
          </i>
        </span>
      </div>
      <div className="rl-row">
        <button type="button" className="rl-btn" aria-label={`${label} 줄이기`} onClick={() => stepBy(-1)}>
          −
        </button>
        <div
          ref={trackRef}
          className={'rl-track' + (dragging ? ' is-drag' : '')}
          role="slider"
          tabIndex={0}
          aria-labelledby={id}
          aria-valuemin={spec.min}
          aria-valuemax={spec.max}
          aria-valuenow={has ? num : undefined}
          aria-valuetext={has ? `${formatValue(spec, num)}${spec.unit}, ${TIER_TEXT[tier!]}` : '아직 재지 않음'}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
          onKeyDown={key}
          style={{ ['--p' as string]: `${p * 100}%` }}
        >
          <span className="rl-bar" aria-hidden="true">
            {has && <span className="rl-fill" />}
            {spec.lines.map((l) => (
              <span key={l.at} className="rl-line" style={{ left: `${ratioOf(spec, l.at) * 100}%` }} />
            ))}
          </span>
          {has && <span className="rl-thumb" aria-hidden="true" />}
          <div className="rl-scale" aria-hidden="true">
            {spec.lines.map((l) => (
              <span key={l.at} style={{ left: `${ratioOf(spec, l.at) * 100}%` }}>
                {l.label}
              </span>
            ))}
          </div>
        </div>
        <button type="button" className="rl-btn" aria-label={`${label} 늘리기`} onClick={() => stepBy(1)}>
          +
        </button>
      </div>
    </div>
  )
}
