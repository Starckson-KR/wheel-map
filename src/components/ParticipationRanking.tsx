import { useMemo, useRef, useState } from 'react'
import { computeRanking, rankDelta, type RankPeriod, type RankRow } from '../lib/ranking'
import { DEMO_USERS, nowMs, rankingUserIds, userName, useReports } from '../lib/reportStore'

const TOP_N = 10
const PERIODS: { id: RankPeriod; tab: string; idle: string }[] = [
  { id: 'week', tab: '이번 주', idle: '이번 주 참여 기록이 없어요' },
  { id: 'month', tab: '이번 달', idle: '이번 달 참여 기록이 없어요' },
]

function Change({ row }: { row: RankRow }) {
  const d = rankDelta(row)
  if (row.prevRank === undefined) return null
  if (row.prevRank === null) return <span className="rk-chg rk-new" aria-label="지난 기간에는 기록이 없었어요">새로</span>
  if (d === null || d === 0) return <span className="rk-chg" aria-label="지난 기간과 같은 순위예요">변동 없음</span>
  return d > 0 ? (
    <span className="rk-chg rk-up" aria-label={`지난 기간보다 ${d}계단 올랐어요`}>▲ {d}</span>
  ) : (
    <span className="rk-chg rk-down" aria-label={`지난 기간보다 ${-d}계단 내려갔어요`}>▼ {-d}</span>
  )
}

function Line({ row, me }: { row: RankRow; me: boolean }) {
  return (
    <>
      <span className="rk-no" aria-label={`${row.rank}위`}>{row.rank}</span>
      <span className="rk-who">
        <strong>
          {userName(row.userId)}
          {me && <b className="rk-me">나</b>}
        </strong>
        <span className="rk-sub">{row.counts.map((c) => `${c.label} ${c.n}`).join(' · ')}</span>
      </span>
      <span className="rk-pts">
        <b>{row.points}</b>점
        <Change row={row} />
      </span>
    </>
  )
}

export default function ParticipationRanking() {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const offsetDays = useReports((s) => s.offsetDays)
  const [period, setPeriod] = useState<RankPeriod>('week')
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  // 순위에 올릴 사용자: 시민과 검증자(행정 담당 계정은 제외) + 대규모 시연 데이터의 가상 사용자
  const res = useMemo(
    () => computeRanking(reports, rankingUserIds(), period, nowMs()),
    // offsetDays: 시연 도구로 시간을 앞당기면 기간이 바뀌므로 다시 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reports, period, offsetDays],
  )
  const def = PERIODS.find((p) => p.id === period) ?? PERIODS[0]
  const top = res.ranked.filter((r) => (r.rank ?? 99) <= TOP_N).slice(0, TOP_N)
  // 기록 없는 사람 이름은 시연 사용자만 나열한다(가상 사용자 수백 명을 다 적지 않는다)
  const idleShown = res.idle.filter((r) => DEMO_USERS.some((u) => u.id === r.userId))
  const mine = res.rows.find((r) => r.userId === userId)
  const mineOut = mine && mine.rank !== null && !top.includes(mine) ? mine : null

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? PERIODS.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    const n = (to + PERIODS.length) % PERIODS.length
    setPeriod(PERIODS[n].id)
    tabs.current[n]?.focus()
  }

  return (
    <section className="pg-card" aria-labelledby="rk-h">
      <h2 id="rk-h">참여 랭킹</h2>
      <div className="rk-seg" role="tablist" aria-label="랭킹 기간">
        {PERIODS.map((p, i) => (
          <button
            key={p.id}
            ref={(el) => {
              tabs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`rk-tab-${p.id}`}
            aria-selected={period === p.id}
            aria-controls="rk-panel"
            tabIndex={period === p.id ? 0 : -1}
            onClick={() => setPeriod(p.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {p.tab}
          </button>
        ))}
      </div>
      <div id="rk-panel" role="tabpanel" aria-labelledby={`rk-tab-${period}`} className="rk-panel">
        <p className="bm-meta">{res.range.label}</p>
        {top.length === 0 ? (
          <p className="bm-meta rk-empty">{def.idle}. 제보가 검증되면 여기에 순위가 생겨요.</p>
        ) : (
          <ol className="rk-list" aria-label={`${def.tab} 참여 순위`}>
            {top.map((r) => (
              <li key={r.userId} className={'rk-row' + (r.userId === userId ? ' rk-mine' : '')} aria-current={r.userId === userId ? 'true' : undefined}>
                <Line row={r} me={r.userId === userId} />
              </li>
            ))}
          </ol>
        )}
        {mineOut && (
          <div className="rk-row rk-mine rk-out" role="group" aria-label="내 순위" aria-current="true">
            <Line row={mineOut} me />
          </div>
        )}
        {idleShown.length > 0 && (
          <p className="bm-meta rk-idle">
            {def.idle}: {idleShown.map((r) => (r.userId === userId ? `${userName(r.userId)}(나)` : userName(r.userId))).join(', ')}
            {res.idle.length > idleShown.length && ` 외 ${res.idle.length - idleShown.length}명`}
          </p>
        )}
      </div>
      <ul className="rk-notes bm-meta">
        <li>검증된 기여만 점수로 세요. 중복·반려된 제보는 빠져요.</li>
        <li>랭킹은 참여를 돕는 보조 기능이에요.</li>
        <li>제보가 적은 곳이 안전하다는 뜻은 아니에요.</li>
      </ul>
    </section>
  )
}
