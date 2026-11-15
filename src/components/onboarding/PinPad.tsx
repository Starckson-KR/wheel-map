// 토스식 숫자 키패드: 큰 버튼, 점 4개, 지우기. 오류는 shake 값을 올려 좌우 흔들림으로 알린다.
import { useEffect } from 'react'
import { m } from 'motion/react'
import { PressButton } from '../motionKit'
import { SPRING } from '../../lib/motionTokens'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export default function PinPad({
  value,
  onChange,
  disabled = false,
  shake = 0,
  label,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  shake?: number
  label: string
}) {
  const add = (d: string) => {
    if (!disabled && value.length < 4) onChange(value + d)
  }
  const del = () => {
    if (!disabled && value.length > 0) onChange(value.slice(0, -1))
  }

  // PC 키보드로도 입력할 수 있게
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^[0-9]$/.test(e.key)) add(e.key)
      else if (e.key === 'Backspace') del()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="ob-pad">
      <div key={shake} className={'ob-pindots' + (shake > 0 ? ' is-shake' : '')} role="img" aria-label={`${label}: 4자리 중 ${value.length}자리 입력됨`}>
        {[0, 1, 2, 3].map((i) => (
          <m.span key={i} className={'ob-pindot' + (i < value.length ? ' is-on' : '')} initial={false} animate={{ scale: i < value.length ? [1.3, 1] : 0.8 }} transition={SPRING.quick} />
        ))}
      </div>
      <div className="ob-keys" role="group" aria-label="숫자 키패드">
        {KEYS.map((k) => (
          <PressButton k key={k} type="button" className="ob-key" aria-label={k} disabled={disabled} onClick={() => add(k)}>
            {k}
          </PressButton>
        ))}
        <span aria-hidden="true" />
        <PressButton k type="button" className="ob-key" aria-label="0" disabled={disabled} onClick={() => add('0')}>
          0
        </PressButton>
        <PressButton k type="button" className="ob-key ob-key-del" aria-label="지우기" disabled={disabled || value.length === 0} onClick={del}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" />
            <path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
          </svg>
        </PressButton>
      </div>
    </div>
  )
}
