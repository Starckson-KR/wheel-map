import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import RewardCelebrate from './RewardCelebrate'
import { pickPromotion } from '../lib/verifyDeck'
import { DEMO_USERS, useReports, userName } from '../lib/reportStore'
import type { Report } from '../types'
import '../styles/interact-verify.css'
import { EMBLEM_BY_ID, computeRewards, diffRewards, type EmblemDef, type RewardChange, type UserReward } from '../lib/rewards'

// 점수·칭호가 늘어난 순간 화면 아래에 짧게 알려 준다. 점수는 제보 기록에서 계산하므로, 기록이 바뀔 때마다 이전 계산과 비교한다.
type Toast = { id: number; title: string; sub?: string; ms: number }
// 로그인하면 계정 사용자가 DEMO_USERS에 더해지므로 매번 다시 구한다.
const userIds = () => DEMO_USERS.filter((u) => u.role !== 'officer').map((u) => u.id)

function describe(c: RewardChange, mine: boolean): Toast {
  const parts: string[] = []
  if (c.points > 0) parts.push(`+${c.points}점`)
  for (const id of c.newEmblems) {
    const e = EMBLEM_BY_ID.get(id)
    if (!e) continue
    parts.push(e.grade || id === 'special' ? `'${e.name}' 칭호와 엠블럼을 받았어요` : `'${e.name}' 엠블럼을 받았어요`)
  }
  const head = parts.join(', ')
  // 점수만 오른 작은 일은 짧게(3초), 칭호·엠블럼을 받은 큰 일은 길게(5초) 보여 준다.
  return { id: 0, title: mine ? head : `${userName(c.userId)}님 ${head}`, sub: c.reasons[0], ms: c.newEmblems.length > 0 ? 5200 : 3000 }
}

export default function RewardToasts() {
  const prev = useRef<Record<string, UserReward> | null>(null)
  const prevIds = useRef<Set<string>>(new Set())
  const seq = useRef(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  // 내가 새 칭호를 받으면 한 줄 알림 대신 승급 장면을 먼저 보여 주고, 닫으면 알림 줄로 줄어든다.
  const [promo, setPromo] = useState<{ def: EmblemDef; toast: Toast } | null>(null)
  const promoRef = useRef(promo)
  promoRef.current = promo
  const showToast = useCallback((t: Toast) => {
    setToasts((x) => [...x, t].slice(-3))
    window.setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), t.ms)
  }, [])
  const closePromo = useCallback(() => {
    const p = promoRef.current
    if (!p) return
    setPromo(null)
    showToast(p.toast)
  }, [showToast])
  // 시연 확인용: window.dispatchEvent(new CustomEvent('wheelmap:promo', { detail: 'g2' }))
  useEffect(() => {
    const on = (e: Event) => {
      const def = EMBLEM_BY_ID.get(String((e as CustomEvent).detail ?? 'g2'))
      if (def) setPromo({ def, toast: { id: ++seq.current, title: `'${def.name}' 칭호와 엠블럼을 받았어요`, ms: 3000 } })
    }
    window.addEventListener('wheelmap:promo', on)
    return () => window.removeEventListener('wheelmap:promo', on)
  }, [])

  // 제보 기록이 바뀔 때마다(저장소 구독) 이전 계산과 비교한다.
  useEffect(() => {
    const check = (reports: Report[]) => {
      const ids = userIds()
      const next = computeRewards(reports, ids)
      // 시연 데이터를 한꺼번에 채울 때와 처음 불러올 때는 알리지 않는다.
      const bulk = reports.some((r) => r.demo && !prevIds.current.has(r.id))
      if (prev.current && !bulk) {
        const me = useReports.getState().userId
        const made: Toast[] = []
        for (const id of ids) {
          const c = diffRewards(prev.current[id], next[id])
          if (!c) continue
          const t = { ...describe(c, id === me), id: ++seq.current }
          const def = id === me ? pickPromotion(c.newEmblems, (k) => EMBLEM_BY_ID.get(k)) : null
          if (def && !promoRef.current) setPromo({ def, toast: t })
          else made.push(t)
        }
        if (made.length > 0) {
          setToasts((t) => [...t, ...made].slice(-3))
          for (const m of made) window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== m.id)), m.ms)
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

  return (
    <>
      <AnimatePresence>{promo && <RewardCelebrate key="promo" def={promo.def} mine name="" onClose={closePromo} />}</AnimatePresence>
      {toasts.length > 0 && (
    <div className="rw-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className="rw-toast" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
          <strong>{t.title}</strong>
          {t.sub && <span>{t.sub}</span>}
        </button>
      ))}
    </div>
      )}
    </>
  )
}
