import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { m } from 'motion/react'
import { PressButton } from './motionKit'
import { SPRING } from '../lib/motionTokens'
import { prefersCalm } from '../lib/viewPrefs'
import { CHIPS, type ChipId, type Summary } from '../lib/layerPresets'

type Props = {
  order: ChipId[]
  selected: ChipId | null
  onPick: (id: ChipId) => void
  /** 고른 칩의 요약 한 줄. 없으면 줄이 닫힌다 */
  summary: Summary | null
}

/** 동행지도 검색바 아래의 상황 칩 한 줄. 하나만 고른다. 날씨로 순서가 바뀌면 칩이 자리를 미끄러져 옮긴다(줄을 옆으로 민 것은 움직임으로 치지 않게 layoutScroll). */
export default function SituationChips({ order, selected, onPick, summary }: Props) {
  const row = useRef<HTMLDivElement>(null)
  // 요약 줄: 닫히는 동안에는 마지막 내용을 남겨 두고 높이·투명도만 줄인다(map.css .sc-sum-wrap)
  const [kept, setKept] = useState<Summary | null>(summary)
  const [open, setOpen] = useState(false)
  const sumKey = summary ? summary.before + summary.strong + summary.after : ''
  useEffect(() => {
    if (summary) {
      setKept(summary)
      const id = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(id)
    }
    setOpen(false)
    const t = window.setTimeout(() => setKept(null), 260)
    return () => window.clearTimeout(t)
    // 내용이 같으면 다시 돌지 않는다(summary는 그릴 때마다 새 객체일 수 있다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sumKey])
  // 고른 칩이 줄 밖에 있으면 보이는 자리로 옮긴다
  useEffect(() => {
    if (!selected) return
    row.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: prefersCalm() ? 'auto' : 'smooth' })
  }, [selected, order])
  const shown = summary ?? kept
  return (
    <div className="sc">
      <m.div ref={row} layoutScroll className="sc-row" role="group" aria-label="지금 상황 고르기">
        {order.map((id) => {
          const c = CHIPS[id]
          const on = selected === id
          return (
            <PressButton key={id} layout="position" transition={SPRING.quick} type="button" className={'sc-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onPick(id)}>
              <Icon name={c.icon} size={18} />
              {c.label}
            </PressButton>
          )
        })}
      </m.div>
      {shown && (
        <div className={'sc-sum-wrap' + (open ? ' on' : '')}>
          <div className="sc-sum-in">
            <p className="sc-sum" role="status">
              <span className="sc-sum-ic" style={{ color: shown.color }}>
                <Icon name={shown.icon} size={20} />
              </span>
              <span key={shown.icon + shown.before} className="fx-fade">
                {shown.before}
                <strong>{shown.strong}</strong>
                {shown.after}
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
