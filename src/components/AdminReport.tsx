import { useEffect, useMemo, useState } from 'react'
import { findAgencyName } from '../lib/agencyName'
import { agencyOf, fmtDate, pct } from '../lib/caseMetrics'
import { downloadText, toCsv } from '../lib/csv'
import { dongKey, loadDongs } from '../lib/regions'
import { CHOICE_LABEL, isOngoing, periodRange, previousRange, quarterOf, type PeriodChoice } from '../lib/reportPeriod'
import { agencyKey, buildKpis, buildSummary, groupStats, inPeriod, periodSites, prevWord, reportCsvName, reportCsvRows, statsOf, type GroupRow, type Stats } from '../lib/reportStats'
import { nowMs, useReports } from '../lib/reportStore'
import { useRecurrence } from '../lib/useRecurrence'
import type { Report } from '../types'

const CHOICES: PeriodChoice[] = [1, 2, 3, 4, 'year']
const dayText = (v: number | null) => (v === null ? '자료 없음' : `${v.toFixed(1)}일`)

type Props = {
  caseName: (r: Report) => string
  onOpen: (id: string) => void
}

export default function AdminReport({ caseName, onOpen }: Props) {
  const reports = useReports((s) => s.reports)
  const offset = useReports((s) => s.offsetDays)
  void offset // 시간 앞당기기가 바뀌면 다시 계산
  const now = nowMs()
  const rec = useRecurrence()
  const q = quarterOf(now)
  const [year, setYear] = useState(q.year)
  const [choice, setChoice] = useState<PeriodChoice>(q.choice)
  const [dongs, setDongs] = useState<Record<string, string> | null>(null)
  const [dongErr, setDongErr] = useState('')

  // 인쇄할 때 보고서 영역만 나오도록 화면 전체에 표시를 단다(admin.css의 @media print).
  useEffect(() => {
    document.documentElement.classList.add('print-report')
    return () => document.documentElement.classList.remove('print-report')
  }, [])

  const p = useMemo(() => periodRange(year, choice), [year, choice])
  const prevP = useMemo(() => previousRange(p), [p])
  const list = useMemo(() => inPeriod(reports, p), [reports, p])
  const prevList = useMemo(() => inPeriod(reports, prevP), [reports, prevP])
  const cur = useMemo(() => statsOf(list, now, rec), [list, now, rec])
  const prev: Stats | null = useMemo(() => statsOf(prevList, now, rec), [prevList, now, rec])
  const hasPrev = prev.received > 0

  useEffect(() => {
    let cancelled = false
    if (list.length === 0) return
    loadDongs(list.map((r) => ({ lat: r.lat, lng: r.lng })))
      .then((d) => {
        if (cancelled) return
        setDongs(d)
        setDongErr('')
      })
      .catch(() => !cancelled && setDongErr('행정동을 찾지 못해서 동별 표를 건너뛰었어요. 카카오 지도 설정을 확인해 주세요.'))
    return () => {
      cancelled = true
    }
  }, [list])

  const years = useMemo(() => {
    const ys = new Set<number>([q.year])
    for (const r of reports) ys.add(new Date(r.createdAt).getFullYear())
    ys.add(year)
    return [...ys].sort((a, b) => b - a)
  }, [reports, q.year, year])

  const dongRows: GroupRow[] | null = dongs ? groupStats(list, (r) => dongs[dongKey(r.lat, r.lng)] ?? '확인 필요', now, rec) : null
  const typeRows = groupStats(list, (r) => r.type, now, rec)
  const agencyRows = groupStats(list, agencyKey, now, rec).map((g) => ({ ...g, name: findAgencyName(g.key) }))
  const byId = new Map(reports.map((r) => [r.id, r]))
  const siteRows = periodSites(rec, reports, p).map((s) => {
    const latest = byId.get(s.latestId)
    return { ...s, name: latest ? caseName(latest) : s.latestId, agency: latest ? (agencyOf(latest) ? findAgencyName(agencyOf(latest) as string) : '미정') : '' }
  })

  const kpis = buildKpis(cur, hasPrev ? prev : null, p)
  const summary = buildSummary(cur, hasPrev ? prev : null, p, now)
  const nowD = new Date(now)
  const ongoing = isOngoing(p, now)
  const notStarted = p.from > now

  const exportCsv = () => {
    const rows = reportCsvRows({
      p,
      cur,
      prev: hasPrev ? prev : null,
      dongs: dongRows,
      types: typeRows,
      agencies: agencyRows.map((g) => ({ name: g.name, stats: g.stats })),
      sites: siteRows.map((s) => ({ name: s.name, count: s.count, lastActionMs: s.lastActionMs, agency: s.agency })),
      summary,
      now,
    })
    downloadText(toCsv(rows, () => true), reportCsvName(p))
  }

  const empty = cur.received === 0

  return (
    <div className="adm-sec adm-report">
      <section className="rf-card adm-report-sec adm-noprint" aria-labelledby="rep-pick-h">
        <h3 id="rep-pick-h">보고서 기간</h3>
        <div className="adm-report-pick">
          <label className="rf-field">
            연도
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </label>
          <label className="rf-field">
            기간
            <select value={String(choice)} onChange={(e) => setChoice(e.target.value === 'year' ? 'year' : (Number(e.target.value) as PeriodChoice))}>
              {CHOICES.map((c) => (
                <option key={c} value={String(c)}>
                  {CHOICE_LABEL[String(c)]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="adm-plan-tools">
          <button type="button" onClick={exportCsv} disabled={empty}>
            CSV로 내보내기
          </button>
          <button type="button" onClick={() => window.print()} disabled={empty}>
            인쇄·PDF 저장
          </button>
        </div>
        <span className="bm-meta">달력 기준 분기예요(1분기 1~3월, 2분기 4~6월, 3분기 7~9월, 4분기 10~12월). 숫자는 이 기간에 접수된 건의 지금 상태를 센 거예요. 개선 현황 지도와 같은 계산이에요.</span>
      </section>

      <div className="adm-report-print">
        <header className="adm-report-head">
          <h3>북구동행지도 민원 보고서 · {p.label}</h3>
          <span className="bm-meta">
            {fmtDate(p.from)} ~ {fmtDate(p.to - 1)} · 이전 기간({prevP.label}) 대비
          </span>
          {notStarted ? (
            <p className="rf-notice" role="status">아직 시작하지 않은 기간이에요.</p>
          ) : (
            ongoing && (
              <p className="rf-notice" role="status">
                진행 중인 기간이에요({nowD.getMonth() + 1}월 {nowD.getDate()}일까지)
              </p>
            )
          )}
        </header>

        {empty ? (
          <p className="rp-empty">
            이 기간에 접수된 제보가 없어요.
            <br />
            다른 기간을 고르거나, 시연 도구에서 '시연 데이터 채우기'를 눌러 보세요.
          </p>
        ) : (
          <>
            <section className="rf-card adm-report-sec" aria-labelledby="rep-sum-h">
              <h3 id="rep-sum-h">한눈에 보기</h3>
              <div className="adm-report-sum">
                {summary.map((s) => (
                  <p key={s}>{s}</p>
                ))}
              </div>
            </section>

            <section className="rf-card adm-report-sec" aria-labelledby="rep-kpi-h">
              <h3 id="rep-kpi-h">지표</h3>
              <div className="adm-kpis adm-report-kpis">
                {kpis.map((k) => (
                  <div key={k.id} className="rf-card">
                    <span className="bm-meta">{k.label}</span>
                    <strong>{k.value}</strong>
                    {k.delta ? (
                      <span className={'adm-delta adm-delta-' + k.delta.dir}>
                        <span aria-hidden="true">{k.delta.text}</span>
                        <span className="sr-only">{k.delta.sr}</span>
                      </span>
                    ) : null}
                    <span className="bm-meta adm-dept-sub">{hasPrev ? k.prevText : `${prevWord(p)} 자료 없음`}</span>
                    <span className="adm-formula">{k.formula}</span>
                  </div>
                ))}
              </div>
              <span className="bm-meta">▲▼는 {prevWord(p)}와 비교한 차이예요. 개선율과 재발률의 차이는 %p(퍼센트 포인트)로 적어요.</span>
            </section>

            <section className="rf-card adm-report-sec" aria-labelledby="rep-dong-h">
              <h3 id="rep-dong-h">동별</h3>
              {dongErr && <p className="rf-warn">{dongErr}</p>}
              {!dongRows && !dongErr && <p className="bm-meta">행정동을 찾고 있어요…</p>}
              {dongRows && <GroupTable label="동" caption="동별 접수·해결·개선율·재발" rows={dongRows.map((g) => ({ name: g.key, stats: g.stats }))} />}
            </section>

            <section className="rf-card adm-report-sec" aria-labelledby="rep-type-h">
              <h3 id="rep-type-h">유형별</h3>
              <GroupTable label="유형" caption="유형별 접수·해결·개선율·재발" rows={typeRows.map((g) => ({ name: g.key, stats: g.stats }))} />
            </section>

            <section className="rf-card adm-report-sec" aria-labelledby="rep-ag-h">
              <h3 id="rep-ag-h">기관별</h3>
              <GroupTable label="기관" caption="기관별 접수·처리율·평균 처리 기간·재발" rows={agencyRows.map((g) => ({ name: g.name, stats: g.stats }))} avg />
              <span className="bm-meta">처리율은 해결 수 ÷ 민원 접수 수예요. 현재 처리 기관 기준이에요.</span>
            </section>

            <section className="rf-card adm-report-sec" aria-labelledby="rep-site-h">
              <h3 id="rep-site-h">자주 재발하는 곳 ({siteRows.length})</h3>
              {siteRows.length === 0 ? (
                <p className="rp-empty">이 기간에 다시 신고된 곳이 없어요.</p>
              ) : (
                <ol className="rp-list adm-report-sites">
                  {siteRows.map((s, i) => (
                    <li key={s.rootId}>
                      <button type="button" className="adm-row" onClick={() => onOpen(s.latestId)}>
                        <span className="adm-no">{i + 1}</span>
                        <span className="adm-row-main">
                          <strong>{s.name}</strong>
                          <span className="bm-meta">
                            재발 {s.count}회 · 마지막 조치 {s.lastActionMs === null ? '기록 없음' : fmtDate(s.lastActionMs)} · {s.agency}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <span className="bm-meta adm-noprint">누르면 가장 최근에 접수된 건의 상세가 열려요. 재발은 조치 완료(또는 재확인 완료) 뒤 같은 곳·같은 유형으로 다시 접수된 건이에요.</span>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function GroupTable({ label, caption, rows, avg = false }: { label: string; caption: string; rows: { name: string; stats: Stats }[]; avg?: boolean }) {
  if (rows.length === 0) return <p className="rp-empty">이 기간에 해당하는 건이 없어요.</p>
  return (
    <table className="adm-report-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{label}</th>
          <th scope="col">접수</th>
          {avg ? null : <th scope="col">해결</th>}
          <th scope="col">{avg ? '처리율' : '개선율'}</th>
          {avg ? <th scope="col">평균 처리</th> : null}
          <th scope="col">재발</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.name}>
            <th scope="row">{g.name}</th>
            <td>{g.stats.filed}건</td>
            {avg ? null : <td>{g.stats.done}건</td>}
            <td>{pct(g.stats.rate)}</td>
            {avg ? <td>{dayText(g.stats.avgDays)}</td> : null}
            <td>{g.stats.recur}건</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
