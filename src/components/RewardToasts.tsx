import { useEffect, useRef, useState } from 'react'
import { DEMO_USERS, useReports, userName } from '../lib/reportStore'
import type { Report } from '../types'
import { EMBLEM_BY_ID, computeRewards, diffRewards, type RewardChange, type UserReward } from '../lib/rewards'

// 점수·칭호가 늘어난 순간 화면 아래에 짧게 알려 준다. 점수는 제보 기록에서 계산하므로, 기록이 바뀔 때마다 이전 계산과 비교한다.
type Toast = { id: number; title: string; sub?: string }
const USER_IDS = DEMO_USERS.filter((u) => u.role !== 'officer').map((u) => u.id)

function describe(c: RewardChange, mine: boolean): Toast {
  const parts: string[] = []
  if (c.points > 0) parts.push(`+${c.points}점`)
  for (const id of c.newEmblems) {
    const e = EMBLEM_BY_ID.get(id)
    if (!e) continue
    parts.push(e.grade || id === 'special' ? `'${e.name}' 칭호와 엠블럼을 받았어요` : `'${e.name}' 엠블럼을 받았어요`)
  }
  const head = parts.join(', ')
  return { id: 0, title: mine ? head : `${userName(c.userId)}님 ${head}`, sub: c.reasons[0] }
}

export default function RewardToasts() {
  const prev = useRef<Record<string, UserReward> | null>(null)
  const prevIds = useRef<Set<string>>(new Set())
  const seq = useRef(0)
  const [toasts, setToasts] = useState<Toast[]>([])

  // 제보 기록이 바뀔 때마다(저장소 구독) 이전 계산과 비교한다.
  useEffect(() => {
    const check = (reports: Report[]) => {
      const next = computeRewards(reports, USER_IDS)
      // 시연 데이터를 한꺼번에 채울 때와 처음 불러올 때는 알리지 않는다.
      const bulk = reports.some((r) => r.demo && !prevIds.current.has(r.id))
      if (prev.current && !bulk) {
        const me = useReports.getState().userId
        const made: Toast[] = []
        for (const id of USER_IDS) {
          const c = diffRewards(prev.current[id], next[id])
          if (c) made.push({ ...describe(c, id === me), id: ++seq.current })
        }
        if (made.length > 0) {
          setToasts((t) => [...t, ...made].slice(-3))
          for (const m of made) window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== m.id)), 5200)
        }
      }
      prev.current = next
      prevIds.current = new Set(reports.map((r) => r.id))
    }
    check(useReports.getState().reports)
    let last = useReports.getState().reports
    return useReports.subscribe((st) => {
      if (st.reports !== last) {
        last = st.reports
        check(st.reports)
      }
    })
  }, [])

  if (toasts.length === 0) return null
  return (
    <div className="rw-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className="rw-toast" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
          <strong>{t.title}</strong>
          {t.sub && <span>{t.sub}</span>}
        </button>
      ))}
    </div>
  )
}
