import { useState } from 'react'
import { agencyById, listAgencies } from '../lib/agencyGuide'
import { findAgencyName } from '../lib/agencyName'
import { fmtDate, nextInspection, pct } from '../lib/caseMetrics'
import { RATING_STYLE } from '../lib/rating'
import { STATUS_LABEL, nowMs, useReports } from '../lib/reportStore'
import { ROUTES, loadCoordinators, routeStats, saveCoordinator } from '../lib/routeStats'
import type { Barrier } from '../types'

export default function AdminRoute({ barriers, onOpen }: { barriers: Barrier[]; onOpen: (id: string) => void }) {
  const reports = useReports((s) => s.reports)
  const officer = useReports((s) => s.userId) === 'officer'
  const [coord, setCoord] = useState(loadCoordinators)
  const [pick, setPick] = useState<Record<string, string>>({})

  return (
    <div className="adm-sec">
      {ROUTES.map((route) => {
        const st = routeStats(route, barriers, reports)
        const coordinator = coord[route.id] ?? route.coordinatorAgencyId ?? ''
        const choice = pick[route.id] ?? coordinator
        const focusIds = st.rows.filter((r) => r.located).map((r) => r.b.id)
        return (
          <section key={route.id} className="rf-card">
            <h3>{route.name}</h3>

            <div className="adm-ratio">
              <strong>통과 가능 구간 비율(안): {pct(st.ratio)}</strong>
              <div className="adm-bar" role="img" aria-label={`○ ${st.counts.O}, △ ${st.counts.TRIANGLE}, X ${st.counts.X}, 평가 없음 ${st.counts.none}`}>
                {(['O', 'TRIANGLE', 'X', 'none'] as const).map((k) =>
                  st.counts[k] > 0 ? (
                    <span key={k} style={{ width: `${(st.counts[k] / Math.max(st.located, 1)) * 100}%`, background: RATING_STYLE[k].color, color: RATING_STYLE[k].ink }}>
                      {RATING_STYLE[k].glyph} {st.counts[k]}
                    </span>
                  ) : null,
                )}
              </div>
              <span className="bm-meta">
                ○ {st.counts.O}곳 · △ {st.counts.TRIANGLE}곳 · X {st.counts.X}곳 · 평가 없음 {st.counts.none}곳 · 위치 미확정 {st.counts.unplaced}곳(비율 계산에서 제외)
              </span>
              <span className="bm-meta">
                통과 가능 구간 비율은 위치가 정해진 지점 가운데 ○인 지점의 비율이에요. 선과 영역도 한 지점으로 세고, △·X·평가 없음은 ○가 아닌 것으로 봐요. 재확인을 통과한 지점은 ○로 바뀌어요.
              </span>
            </div>

            <h4>이 경로에 걸린 기관 ({st.agencies.size}곳)</h4>
            {st.agencies.size === 0 ? (
              <p className="bm-meta">아직 접수된 민원이 없어서 걸린 기관이 없어요.</p>
            ) : (
              <ul className="cg-law">
                {[...st.agencies].map(([id, n]) => (
                  <li key={id}>
                    {findAgencyName(id)} — 지점 {n}곳
                  </li>
                ))}
              </ul>
            )}

            <h4>경로 조정 담당</h4>
            <p>
              현재 지정: <strong>{coordinator ? findAgencyName(coordinator) : '미지정'}</strong>
              {st.agencies.size >= 2 && !coordinator && <span className="ps-flag"> 여러 기관이 걸려 있어서 조정 담당을 정해야 해요.</span>}
            </p>
            <div className="adm-coord">
              <label className="rf-field">
                조정 담당 기관
                <select value={choice} disabled={!officer} onChange={(e) => setPick((p) => ({ ...p, [route.id]: e.target.value }))}>
                  <option value="">미지정</option>
                  {listAgencies().map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="rf-primary"
                disabled={!officer || choice === coordinator}
                onClick={() => {
                  saveCoordinator(route.id, choice)
                  setCoord(loadCoordinators())
                }}
              >
                담당 기관 저장하기
              </button>
            </div>
            {!officer && <span className="bm-meta">담당 공무원(시연)만 정할 수 있어요. 이 브라우저에만 저장돼요.</span>}

            <h4>지점 목록</h4>
            <div className="adm-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>지점</th>
                    <th>평가</th>
                    <th>민원 상태</th>
                    <th>소관 기관</th>
                    <th>다음 점검일</th>
                  </tr>
                </thead>
                <tbody>
                  {st.rows.map((r) => {
                    const ni = r.flow ? nextInspection(r.flow, nowMs()) : null
                    const rs = RATING_STYLE[r.rating]
                    return (
                      <tr key={r.b.id}>
                        <td>
                          {r.flow ? (
                            <button type="button" className="adm-link" onClick={() => onOpen((r.flow as { id: string }).id)}>
                              {r.b.id} · {r.b.name}
                            </button>
                          ) : (
                            <>
                              {r.b.id} · {r.b.name}
                            </>
                          )}
                        </td>
                        <td>{r.located ? <span className="adm-rate" style={{ background: rs.color, color: rs.ink }}>{rs.label}</span> : <span className="bm-meta">위치 미확정</span>}</td>
                        <td>{r.flow ? STATUS_LABEL[r.flow.status] : '민원 전'}</td>
                        <td>{r.agencyId ? (agencyById(r.agencyId)?.name ?? r.agencyId) : '—'}</td>
                        <td>{ni ? `${fmtDate(ni.dueMs)}${ni.needed ? ' (점검 필요)' : ''}` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="rf-actions">
              <button
                type="button"
                className="rf-primary"
                onClick={() => {
                  try {
                    sessionStorage.setItem('wheelmap.focusRoute', JSON.stringify(focusIds))
                  } catch {
                    /* 저장 실패 시 강조 없이 지도로 이동 */
                  }
                  location.hash = '#/map'
                }}
              >
                지도에서 이 경로의 지점 보기
              </button>
            </div>
          </section>
        )
      })}
    </div>
  )
}
