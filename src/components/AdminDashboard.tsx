import { useEffect, useMemo, useState } from 'react'
import { listAgencies } from '../lib/agencyGuide'
import { DAY, agencyOf, deadlineOf, pct } from '../lib/caseMetrics'
import { DEMAND_FACILITY_TYPES, PRIORITY_DEMAND_RADIUS_M, PRIORITY_REPORT_RADIUS_M, PRIORITY_WEIGHTS } from '../lib/config'
import { distanceM, distanceToGeometryM } from '../lib/geo'
import { loadPubDataset, type PubDataset } from '../lib/publicLayers'
import { RATING_STYLE } from '../lib/rating'
import { dongKey, loadDongs } from '../lib/regions'
import { nowMs, useReports } from '../lib/reportStore'
import { loadNoAlt, noAltFor } from '../lib/routing/noAlt.ts'
import { ROUTES, ratingOfBarrier, routeStats, type RowRating } from '../lib/routeStats'
import type { Barrier, Report } from '../types'

const SHOWN = ['verified', 'filed', 'assigned', 'in_progress', 'resolved', 'rechecked']

// 지도에 올라간 지점(팀 조사 지점 + 검증 이후 시민 제보). 위치가 확정된 것만.
type Pt = { key: string; label: string; lat: number; lng: number; rating: RowRating; seed?: Barrier; report?: Report }

function collectPoints(barriers: Barrier[], reports: Report[]): Pt[] {
  const byId = new Map(barriers.map((b) => [b.id, b]))
  const out: Pt[] = []
  for (const b of barriers) {
    if (!b.geometry) continue
    const a = b.geometry.kind === 'point' ? b.geometry.at : b.geometry.path[0]
    out.push({ key: b.id, label: `${b.id} · ${b.name}`, lat: a[0], lng: a[1], rating: ratingOfBarrier(b, byId, reports), seed: b })
  }
  for (const r of reports) {
    if (r.seedId || !SHOWN.includes(r.status)) continue
    out.push({ key: r.id, label: `${r.type} (시민 제보)`, lat: r.lat, lng: r.lng, rating: r.verification.rating ?? 'none', report: r })
  }
  return out
}

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
    loadDongs(pts.map((p) => ({ lat: p.lat, lng: p.lng })))
      .then((d) => !cancelled && setDongs(d))
      .catch(() => !cancelled && setDongErr('행정동을 찾지 못했어요. 카카오 지도 설정을 확인해 주세요.'))
    return () => {
      cancelled = true
    }
  }, [pts])

  const byDong = new Map<string, { O: number; TRIANGLE: number; X: number; none: number }>()
  if (dongs) {
    for (const p of pts) {
      const d = dongs[dongKey(p.lat, p.lng)] ?? '확인 필요'
      const e = byDong.get(d) ?? { O: 0, TRIANGLE: 0, X: 0, none: 0 }
      e[p.rating]++
      byDong.set(d, e)
    }
  }
  const dongRows = [...byDong].sort((a, b) => b[1].X + b[1].TRIANGLE + b[1].O + b[1].none - (a[1].X + a[1].TRIANGLE + a[1].O + a[1].none))

  const cases = reports.filter((r) => r.complaint)
  const doneCases = cases.filter((r) => r.action?.doneAt)
  const avgDays = doneCases.length > 0 ? doneCases.reduce((s, r) => s + (new Date(r.action?.doneAt ?? 0).getTime() - new Date(r.complaint?.submittedAt ?? 0).getTime()) / DAY, 0) / doneCases.length : null
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

type Cand = { pt: Pt; reportsN: number; bus: number; fac: number; alt: string[] | null; score: number }

export function AdminPriority({ barriers }: { barriers: Barrier[] }) {
  const reports = useReports((s) => s.reports)
  const [data, setData] = useState<{ bus: PubDataset; fac: PubDataset } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([loadPubDataset('bus'), loadPubDataset('facility')])
      .then(([bus, fac]) => !cancelled && setData({ bus, fac }))
      .catch(() => !cancelled && setErr('이용 수요 자료(정류장·시설)를 불러오지 못했어요.'))
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo<Cand[]>(() => {
    if (!data) return []
    const W = PRIORITY_WEIGHTS
    const noAlt = loadNoAlt() // 길찾기에서 대안 경로 없음으로 기록된 지점
    const pts = collectPoints(
      barriers.filter((b) => !b.parentId),
      reports,
    )
    const citizen = reports.filter((r) => !r.seedId && r.status !== 'rejected')
    const fac = data.fac.items.filter((i) => i.lat != null && i.lng != null && DEMAND_FACILITY_TYPES.includes(String(i.fields['faclTyCd'])))
    const bus = data.bus.items.filter((i) => i.lat != null && i.lng != null)
    return pts
      .map((pt) => {
        const near = (lat: number, lng: number) => (pt.seed?.geometry ? distanceToGeometryM(lat, lng, pt.seed.geometry) : distanceM(pt.lat, pt.lng, lat, lng))
        const reportsN = citizen.filter((r) => distanceM(pt.lat, pt.lng, r.lat, r.lng) <= PRIORITY_REPORT_RADIUS_M).length
        const b = bus.filter((i) => near(i.lat as number, i.lng as number) <= PRIORITY_DEMAND_RADIUS_M).length
        const f = fac.filter((i) => near(i.lat as number, i.lng as number) <= PRIORITY_DEMAND_RADIUS_M).length
        // 지금도 X인 지점만 반영(재확인을 통과해 ○가 되면 점수에서 빠진다)
        const rec = pt.rating === 'X' ? noAltFor(noAlt, pt.key) : undefined
        return { pt, reportsN, bus: b, fac: f, alt: rec ? rec.pairs : null, score: reportsN * W.report + b * W.bus + f * W.facility + (rec ? W.alternative : 0) }
      })
      .sort((a, b) => b.score - a.score)
  }, [data, barriers, reports])

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

