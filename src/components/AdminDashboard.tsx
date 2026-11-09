import { useEffect, useMemo, useState } from 'react'
import { avgProcessDays } from '../lib/progress'
import { listAgencies } from '../lib/agencyGuide'
import { agencyOf, deadlineOf, pct } from '../lib/caseMetrics'
import { PRIORITY_DEMAND_RADIUS_M, PRIORITY_REPORT_RADIUS_M, PRIORITY_WEIGHTS } from '../lib/config'
import { collectPoints } from '../lib/priority'
import { usePriority } from '../lib/usePriority'
import { RATING_STYLE } from '../lib/rating'
import { dongKey, loadDongs } from '../lib/regions'
import { nowMs, useReports } from '../lib/reportStore'
import { computeRewards } from '../lib/rewards'
import { ROUTES, routeStats } from '../lib/routeStats'
import type { Barrier } from '../types'

function Bar({ label, value, max, note }: { label: string; value: number; max: number; note?: string }) {
  return (
    <div className="adm-hbar">
      <span className="adm-hbar-l">{label}</span>
      <span className="adm-hbar-t">
        <i style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
      </span>
      <b>
        {value}
        {note ?? ''}
      </b>
    </div>
  )
}

export function AdminDashboard({ barriers }: { barriers: Barrier[] }) {
  const reports = useReports((s) => s.reports)
  const offset = useReports((s) => s.offsetDays)
  void offset // 시간 앞당기기가 바뀌면 다시 계산
  const now = nowMs()
  const pts = useMemo(() => collectPoints(barriers, reports), [barriers, reports])
  const [dongs, setDongs] = useState<Record<string, string> | null>(null)
  const [dongErr, setDongErr] = useState('')

  useEffect(() => {
    let cancelled = false
    loadDongs([...pts, ...reports].map((p) => ({ lat: p.lat, lng: p.lng })))
      .then((d) => !cancelled && setDongs(d))
      .catch(() => !cancelled && setDongErr('행정동을 찾지 못했어요. 카카오 지도 설정을 확인해 주세요.'))
    return () => {
      cancelled = true
    }
  }, [pts, reports])

  const byDong = new Map<string, { O: number; TRIANGLE: number; X: number; none: number }>()
  if (dongs) {
    for (const p of pts) {
      const d = dongs[dongKey(p.lat, p.lng)] ?? '확인 필요'
      const e = byDong.get(d) ?? { O: 0, TRIANGLE: 0, X: 0, none: 0 }
      e[p.rating]++
      byDong.set(d, e)
    }
  }
  // 동 단위 기여 집계(명세서 4-2(3) 동네 기여 순위): 개인 이름은 보이지 않고 동별 점수 합계만 센다.
  const byDongPoints = new Map<string, { points: number; people: Set<string> }>()
  if (dongs) {
    const byReport = new Map(reports.map((r) => [r.id, r]))
    const rw = computeRewards(reports, [...new Set(reports.flatMap((r) => [r.userId, ...r.verification.voterIds, ...r.history.map((h) => h.by)]))])
    for (const u of Object.values(rw)) {
      for (const e of u.events) {
        const r = byReport.get(e.reportId)
        if (!r || e.points <= 0) continue
        const d = dongs[dongKey(r.lat, r.lng)] ?? '확인 필요'
        const x = byDongPoints.get(d) ?? { points: 0, people: new Set<string>() }
        x.points += e.points
        x.people.add(e.userId)
        byDongPoints.set(d, x)
      }
    }
  }
  const dongPointRows = [...byDongPoints].sort((a, b) => b[1].points - a[1].points)
  const maxDongPoints = Math.max(1, ...dongPointRows.map(([, x]) => x.points))
  const dongRows = [...byDong].sort((a, b) => b[1].X + b[1].TRIANGLE + b[1].O + b[1].none - (a[1].X + a[1].TRIANGLE + a[1].O + a[1].none))

  const cases = reports.filter((r) => r.complaint)
  const doneCases = cases.filter((r) => r.action?.doneAt)
  const avgDays = avgProcessDays(doneCases)
  const longN = cases.filter((r) => (deadlineOf(r, now)?.longDays ?? 0) > 0).length
  const overdueN = cases.filter((r) => (deadlineOf(r, now)?.overdueDays ?? 0) > 0).length
  const transfers = cases.flatMap((r) => r.transfers ?? [])

  const agRows = listAgencies()
    .map((a) => {
      const mine = cases.filter((r) => agencyOf(r) === a.id)
      const done = mine.filter((r) => r.status === 'resolved' || r.status === 'rechecked').length
      return { a, total: mine.length, done, sent: transfers.filter((t) => t.fromAgencyId === a.id).length, got: transfers.filter((t) => t.toAgencyId === a.id).length }
    })
    .filter((x) => x.total > 0 || x.sent > 0 || x.got > 0)

  const maxDong = Math.max(1, ...dongRows.map(([, c]) => c.O + c.TRIANGLE + c.X + c.none))

  return (
    <div className="adm-sec">
      <div className="adm-kpis">
        <div className="rf-card">
          <span className="bm-meta">접수된 민원</span>
          <strong>{cases.length}건</strong>
        </div>
        <div className="rf-card">
          <span className="bm-meta">평균 처리 기간</span>
          <strong>{avgDays === null ? '자료 없음' : `${avgDays.toFixed(1)}일`}</strong>
          <span className="bm-meta">접수부터 조치 완료까지, {doneCases.length}건 기준</span>
        </div>
        <div className="rf-card">
          <span className="bm-meta">처리기한 경과</span>
          <strong>{overdueN}건</strong>
        </div>
        <div className="rf-card">
          <span className="bm-meta">장기 미조치(60일+)</span>
          <strong>{longN}건</strong>
        </div>
        <div className="rf-card">
          <span className="bm-meta">기관 간 이관</span>
          <strong>{transfers.length}회</strong>
          <span className="bm-meta">수락 {transfers.filter((t) => t.status === 'accepted').length} · 반려 {transfers.filter((t) => t.status === 'rejected').length} · 대기 {transfers.filter((t) => t.status === 'requested').length}</span>
        </div>
      </div>

      <section className="rf-card">
        <h3>동별 ○△X 지점 수</h3>
        {dongErr && <p className="rf-warn">{dongErr}</p>}
        {!dongs && !dongErr && <p className="bm-meta">행정동을 찾고 있어요…</p>}
        {dongRows.map(([dong, c]) => (
          <div key={dong} className="adm-dong">
            <span className="adm-hbar-l">{dong}</span>
            <span className="adm-stack" style={{ width: `${((c.O + c.TRIANGLE + c.X + c.none) / maxDong) * 100}%` }}>
              {(['O', 'TRIANGLE', 'X', 'none'] as const).map((k) =>
                c[k] > 0 ? (
                  <span key={k} style={{ flex: c[k], background: RATING_STYLE[k].color, color: RATING_STYLE[k].ink }}>
                    {RATING_STYLE[k].glyph}
                    {c[k]}
                  </span>
                ) : null,
              )}
            </span>
          </div>
        ))}
        <span className="bm-meta">○ 괜찮음 · △ 주의 · X 어려움 · ? 평가 없음. 위치가 정해진 팀 조사 지점과 검증이 끝난 시민 제보를 세요. 행정동은 카카오 지도로 찾아서 이 브라우저에 저장해 둬요.</span>
      </section>

      <section className="rf-card">
        <h3>동별 시민 기여 점수</h3>
        {dongPointRows.length === 0 ? (
          <p className="bm-meta">아직 쌓인 기여 점수가 없어요. 제보가 검증되면 해당 동의 점수로 모여요.</p>
        ) : (
          dongPointRows.map(([dong, x]) => <Bar key={dong} label={dong} value={x.points} max={maxDongPoints} note={`점 · ${x.people.size}명`} />)
        )}
        <span className="bm-meta">개인 순위 없이 동 단위 합계만 보여 줘요. 검증 이후 지급된 점수만 더하며, 시연 사용자 기준이에요.</span>
      </section>

      <section className="rf-card">
        <h3>기관별 처리율·이관 횟수</h3>
        {agRows.length === 0 ? (
          <p className="bm-meta">접수된 민원이 없어요. 시연 도구에서 '시연 데이터 채우기'를 눌러 보세요.</p>
        ) : (
          <div className="adm-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>기관</th>
                  <th>맡은 건</th>
                  <th>조치 완료</th>
                  <th>처리율</th>
                  <th>이관 보냄</th>
                  <th>이관 받음</th>
                </tr>
              </thead>
              <tbody>
                {agRows.map(({ a, total, done, sent, got }) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{total}</td>
                    <td>{done}</td>
                    <td>{total > 0 ? `${Math.round((done / total) * 100)}%` : '—'}</td>
                    <td>{sent}</td>
                    <td>{got}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <span className="bm-meta">처리율은 조치 완료(재확인 포함)를 그 기관이 지금 맡은 건수로 나눈 값이에요.</span>
      </section>

      <section className="rf-card">
        <h3>경로별 통과 가능 구간 비율</h3>
        {ROUTES.map((rt) => {
          const st = routeStats(rt, barriers, reports)
          return <Bar key={rt.id} label={rt.name} value={Math.round((st.ratio ?? 0) * 100)} max={100} note={`% (${pct(st.ratio)}, ○ ${st.counts.O}/${st.located}곳)`} />
        })}
      </section>
    </div>
  )
}

export function AdminPriority({ barriers }: { barriers: Barrier[] }) {
  const { rows, data, err } = usePriority(barriers)

  const W = PRIORITY_WEIGHTS
  return (
    <div className="adm-sec">
      <section className="rf-card">
        <h3>개선 우선순위(안)</h3>
        <p className="bm-meta">
          점수 = 제보 수 × {W.report} + (반경 {PRIORITY_DEMAND_RADIUS_M}m 안 정류장 수 × {W.bus} + 병원·복지시설 수 × {W.facility}) + 대안 경로 유무 × {W.alternative}.
          가중치는 팀이 정하는 안이고 <code>src/lib/config.ts</code>에서 바꿔요. 제보 수는 반경 {PRIORITY_REPORT_RADIUS_M}m 안의 시민 제보예요(합쳐진 건은 포함하고 반려된 건은 빼요).
        </p>
        <p className="bm-meta">길찾기에서 우회 경로를 찾지 못해 기록된 X 지점은 점수를 더해요(출발·도착 지점 자체는 빼요). 기록이 없거나 아직 검색하지 않은 지점은 0점이에요.</p>
        {err && <p className="rf-warn">{err}</p>}
        {!data && !err && <p className="bm-meta">이용 수요 자료를 불러오고 있어요…</p>}
        <ol className="adm-prio">
          {rows.slice(0, 15).map((c, i) => (
            <li key={c.pt.key}>
              <details>
                <summary>
                  <span className="adm-no">{i + 1}</span>
                  <span className="adm-prio-name">
                    {c.pt.label} <span className="adm-rate" style={{ background: RATING_STYLE[c.pt.rating].color, color: RATING_STYLE[c.pt.rating].ink }}>{RATING_STYLE[c.pt.rating].glyph}</span>
                  </span>
                  <b>{c.score}점</b>
                </summary>
                <ul className="cg-law">
                  <li>
                    제보 수 {c.reportsN}건 × {W.report} = {c.reportsN * W.report}점
                  </li>
                  <li>
                    정류장 {c.bus}곳 × {W.bus} = {c.bus * W.bus}점
                  </li>
                  <li>
                    병원·복지시설 {c.fac}곳 × {W.facility} = {c.fac * W.facility}점
                  </li>
                  <li>
                    {c.alt ? `대안 경로 없음으로 기록됨(${c.alt.join(', ')}) = ${W.alternative}점` : '대안 경로 없음 기록 없음 = 0점'}
                  </li>
                </ul>
              </details>
            </li>
          ))}
        </ol>
        <span className="bm-meta">이용 수요 출처: {data ? `${data.bus.source}(${data.bus.provider}), ${data.fac.source}(${data.fac.provider}), 수집일 ${data.fac.fetchedAt.slice(0, 10)}` : '불러오는 중'}. 공공데이터라서 판정은 아니에요.</span>
      </section>
    </div>
  )
}

