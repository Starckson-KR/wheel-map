import type { CSSProperties, ReactNode } from 'react'
import { obstacleName } from '../lib/display'
import type { Hit, Verdict } from '../lib/routing/engine.ts'
import { ROLE_STYLE } from '../lib/routing/roleStyle.ts'

// 길찾기 화면이 같이 쓰는 작은 조각: 배지, 세로 타임라인

export type BadgeTone = 'blue' | 'red' | 'orange' | 'green' | 'grey'

/** 상태 배지: 연한 배경과 진한 글자, 작은 크기(TDS Badge의 weak·small 기준) */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={'tds-badge tds-badge-' + tone}>{children}</span>
}

const VERDICT: Record<Verdict, { tone: BadgeTone; label: string }> = {
  pass: { tone: 'green', label: '괜찮음' },
  caution: { tone: 'orange', label: '주의' },
  blocked: { tone: 'red', label: '어려움' },
}
export const VerdictBadge = ({ v }: { v: Verdict }) => <Badge tone={VERDICT[v].tone}>{VERDICT[v].label}</Badge>

export function Tl({ children }: { children: ReactNode }) {
  return <ol className="tl">{children}</ol>
}

/** 타임라인 한 단계: 점에서 아래로 이어지는 세로선 색이 이 단계의 색이다 */
export function TlStep(props: { color: string; title: ReactNode; sub?: ReactNode; last?: boolean; end?: boolean; children?: ReactNode }) {
  const { color, title, sub, last, end, children } = props
  return (
    <li className={'tl-step' + (last ? ' tl-last' : '') + (end ? ' tl-end' : '')} style={{ '--tl-c': color } as CSSProperties}>
      <span className="tl-dot" aria-hidden="true" />
      <div className="tl-body">
        <p className="tl-title">{title}</p>
        {sub && <p className="tl-sub">{sub}</p>}
        {children}
      </div>
    </li>
  )
}

/** 경로 카드: 큰 시간, 회색 거리, 작은 상태 배지. 카드 전체가 하나의 버튼이다 */
export function RouteCard(props: { time: string; sub: ReactNode; badges?: ReactNode; chips?: ReactNode; on: boolean; onPick: () => void; foot?: ReactNode }) {
  const { time, sub, badges, chips, on, onPick, foot } = props
  return (
    <li className={'rc' + (on ? ' on' : '')}>
      <button type="button" className="rc-btn" aria-pressed={on} onClick={onPick}>
        <span className="rc-top">
          <span className="rc-time">{time}</span>
          {badges && <span className="rc-badges">{badges}</span>}
        </span>
        <span className="rc-sub">{sub}</span>
        {chips && <span className="rc-chips">{chips}</span>}
      </button>
      {foot}
    </li>
  )
}

/** 걷는 길 위의 주의 지점: 선 위에 작은 표시로 놓고, 누르면 상세가 열린다 */
export function TlHit(props: { color: string; h: Hit; onOpen: (h: Hit) => void; note?: ReactNode; where?: string }) {
  const { color, h, onOpen, note, where } = props
  const st = ROLE_STYLE[h.role]
  return (
    <li className="tl-step tl-mini" style={{ '--tl-c': color } as CSSProperties}>
      <i className="tl-glyph" style={{ background: st.color, color: (st as { ink?: string }).ink ?? '#fff' }} aria-hidden="true">
        {st.glyph}
      </i>
      <button type="button" className="tl-hit" onClick={() => onOpen(h)}>
        <span className="tl-hit-name">{obstacleName(h.o)}</span>
        <span className="tl-hit-sub">
          {st.label.startsWith(st.glyph + ' ') ? st.label.slice(st.glyph.length + 1) : st.label}
          {where ? ` · ${where}` : ''}
          {note}
        </span>
      </button>
    </li>
  )
}
