import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Icon from './Icon'
import { advisoryOf, cardLines, headline, iconOf } from '../lib/weather/model'
import { useWeather } from '../lib/weather/store'

// 날씨 표시 조각 4개(홈 머리줄·길찾기 주의 띠·AI 검색 답 카드·시연 도구 스위치는 DemoTools).
// 날씨를 못 받았으면 모두 아무것도 그리지 않는다(오류·확인 중 문구 없음).

/** 나타날 때 높이와 투명도가 부드럽게 열리고, 사라질 때도 닫힌다. 움직임 줄이기에서는 바로 바뀐다(weather.css). */
function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  const [on, setOn] = useState(false)
  const [kept, setKept] = useState<ReactNode>(null)
  useEffect(() => {
    if (show) {
      setKept(children)
      const id = requestAnimationFrame(() => setOn(true))
      return () => cancelAnimationFrame(id)
    }
    setOn(false)
    const t = window.setTimeout(() => setKept(null), 260) // 닫히는 동안은 마지막 내용을 남겨 둔다
    return () => window.clearTimeout(t)
    // children은 show가 켜진 때의 값만 기억하면 된다(내용 바뀜은 아래 key로 다시 그린다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])
  if (!show && !kept) return null
  return (
    <div className={'wx-reveal' + (on ? ' on' : '')}>
      <div className="wx-reveal-in">{show ? children : kept}</div>
    </div>
  )
}

/** 홈 맨 위 머리줄: 「용봉동 18° 맑음」, 비·눈이면 「경사로가 미끄러울 수 있어요」를 덧붙인다. */
export function WeatherLine() {
  const w = useWeather()
  const h = w ? headline(w) : null
  return (
    <Reveal show={!!w}>
      {w && h && (
        <p className="wx-line" key={`${h.main}|${h.extra}`}>
          <span className="wx-ic"><Icon name={iconOf(w.condition)} size={18} /></span>
          <span className="fx-fade">
            {h.main}
            {h.extra && <span className="wx-extra"> · {h.extra}</span>}
          </span>
        </p>
      )}
    </Reveal>
  )
}

/** 길찾기 경로 카드 위 주의 한 줄: 비·눈·높은 기온일 때만 보인다. */
export function WeatherBand() {
  const w = useWeather()
  const a = w ? advisoryOf(w) : null
  return (
    <Reveal show={!!a}>
      {a && (
        <p className="wx-band" role="note" key={a.kind}>
          <span className="wx-ic"><Icon name={a.icon} size={20} /></span>
          <span className="fx-fade">{a.text}</span>
        </p>
      )}
    </Reveal>
  )
}

/** AI 검색 답: 날씨 카드 내용(바깥 카드 틀은 AiSearch가 그린다). */
export function WeatherAnswer() {
  const w = useWeather()
  if (!w) return <p className="hp-ai-what">지금은 날씨를 알려 드리기 어려워요</p>
  const c = cardLines(w)
  return (
    <>
      <p className="hp-ai-lead">오늘 날씨</p>
      <p className="hp-ai-what wx-what">
        <span className="wx-ic"><Icon name={iconOf(w.condition)} size={22} /></span>
        <span>{c.title}</span>
      </p>
      {c.sub && <p className="hp-ai-slots">{c.sub}</p>}
    </>
  )
}
