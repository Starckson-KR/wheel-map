import { useMemo, useState, type ReactNode } from 'react'
import { agencyById, hasTodoLaw, legalLines } from '../lib/agencyGuide'
import { findAgencyName } from '../lib/agencyName'
import { DAY, agencyOf, deadlineOf, fmtDate, pct, pendingTransfer, tabOf } from '../lib/caseMetrics'
import { DEADLINE_SOON_DAYS } from '../lib/config'
import { lastExternal } from '../lib/externalStatus'
import { entryOf, usePlan } from '../lib/planStore'
import { avgProcessDays } from '../lib/progress'
import { agencyIdOf } from '../lib/priority'
import { RATING_STYLE } from '../lib/rating'
import { nowMs, useReports } from '../lib/reportStore'
import { usePriority } from '../lib/usePriority'
import { useRecurrence } from '../lib/useRecurrence'
import type { Barrier, Report } from '../types'

const PLAN_PREVIEW = 8
const won = (n: number) => n.toLocaleString('ko-KR')
const isTodo = (s: string) => s.startsWith('TODO')

const GROUPS = ['기한 경과', '기한 임박', '신규', '처리 중'] as const
type Task = { r: Report; group: (typeof GROUPS)[number]; note: string }

type Props = {
  deptId: string
  barriers: Barrier[]
  officer: boolean
  selected: string | null
  caseName: (r: Report) => string
  onOpen: (id: string) => void
  onGoPlan: () => void
  onGoDash: () => void
}

export default function AdminDept({ deptId, barriers, officer, selected, caseName, onOpen, onGoPlan, onGoDash }: Props) {
  const reports = useReports((s) => s.reports)
  const offset = useReports((s) => s.offsetDays)
  const decideTransfer = useReports((s) => s.decideTransfer)
  const entries = usePlan((s) => s.entries)
  const { rows: cands, data, err } = usePriority(barriers)
  const recur = useRecurrence()
  const [more, setMore] = useState(false)
  void offset // 시간 앞당기기가 바뀌면 다시 계산
  const now = nowMs()

  const agency = agencyById(deptId)
  const cases = useMemo(() => reports.filter((r) => r.complaint), [reports])

  if (!agency) {
    return (
      <p className="rp-empty">
        부서를 골라 주세요.
        <br />
        고른 부서가 맡은 민원과 오늘 할 일을 모아 보여 드려요.
      </p>
    )
  }

  const mine = cases.filter((r) => agencyOf(r) === deptId) // 민원함 "담당 기관" 필터와 같은 기준(현재 처리 기관)
  const incoming = cases.filter((r) => pendingTransfer(r)?.toAgencyId === deptId) // 이관 대기 건은 받는 쪽에도 보인다
  const transfers = cases.flatMap((r) => r.transfers ?? [])
  const gotN = transfers.filter((t) => t.toAgencyId === deptId).length
  const sentN = transfers.filter((t) => t.fromAgencyId === deptId).length

  const byTab = (t: ReturnType<typeof tabOf>) => mine.filter((r) => tabOf(r) === t).length
  const newN = byTab('new')
  const doingN = byTab('doing')
  const doneN = byTab('done')
  const waitingOutN = byTab('transfer')
  const overdueN = mine.filter((r) => (deadlineOf(r, now)?.overdueDays ?? 0) > 0).length
  const longN = mine.filter((r) => (deadlineOf(r, now)?.longDays ?? 0) > 0).length
  const avgDays = avgProcessDays(mine.filter((r) => r.action?.doneAt))
  const recurN = mine.filter((r) => recur.byId.has(r.id)).length

  // 오늘 할 일: 이관을 보내고 답을 기다리는 건은 뺀다.
  const tasks: Task[] = []
  for (const r of mine) {
    const d = deadlineOf(r, now)
    if (!d || !d.open || pendingTransfer(r)) continue
    const left = Math.ceil((d.dueMs - now) / DAY)
    if (d.overdueDays > 0) tasks.push({ r, group: '기한 경과', note: `기한 ${d.overdueDays}일 지남` })
    else if (left <= DEADLINE_SOON_DAYS) tasks.push({ r, group: '기한 임박', note: left <= 0 ? '오늘까지' : `기한 ${left}일 남음` })
    else tasks.push({ r, group: tabOf(r) === 'doing' ? '처리 중' : '신규', note: `기한 ${left}일 남음` })
  }
  const dueOf = (t: Task) => deadlineOf(t.r, now)?.dueMs ?? 0
  tasks.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || dueOf(a) - dueOf(b))

  // 소관이 확실한 지점만(접수된 민원이 있거나 지점 종류로 소관이 하나로 정해질 때). 개선계획 CSV의 "담당 기관"과 같은 기준이다.
  const plan = cands.filter((c) => agencyIdOf(c.pt, reports) === deptId)
  const planShown = more ? plan : plan.slice(0, PLAN_PREVIEW)

  const law = legalLines(agency)
  const caseRow = (r: Report, note: string, extra?: ReactNode) => {
    const t = pendingTransfer(r)
    return (
      <li key={r.id} className="adm-case">
        <button type="button" className={'adm-row' + (selected === r.id ? ' on' : '')} onClick={() => onOpen(r.id)}>
          <span className="adm-row-main">
            <strong>{caseName(r)}</strong>
            <span className="bm-meta">
              {r.type} · {r.seedId ? '팀 조사 지점' : '시민 제보'} · 접수 {r.complaint ? fmtDate(new Date(r.complaint.submittedAt).getTime()) : '—'}
              {r.complaint ? ` · 접수번호 ${r.complaint.receiptNo}` : ''}
            </span>
            {t && (
              <span className="bm-meta">
                {findAgencyName(t.fromAgencyId)}에서 받은 요청 · 사유 {t.reason}
              </span>
            )}
          </span>
          {(note || lastExternal(r) || recur.byId.has(r.id)) && (
            <span className="adm-badges">
              {note && <span className="adm-flag">{note}</span>}
              {recur.byId.has(r.id) && <span className="adm-recur">재발</span>}
              {lastExternal(r) && <span className="adm-ext">바깥 진행: {lastExternal(r)?.stage}</span>}
            </span>
          )}
        </button>
        {extra}
      </li>
    )
  }

  const kpis: [string, string, string?][] = [
    ['맡은 민원', `${mine.length}건`, waitingOutN > 0 ? `이관 대기 ${waitingOutN}건 포함` : undefined],
    ['신규', `${newN}건`],
    ['처리 중', `${doingN}건`],
    ['처리기한 경과', `${overdueN}건`],
    ['장기 미조치(60일+)', `${longN}건`],
    ['조치 완료', `${doneN}건`, '재확인 포함'],
    ['처리율', mine.length > 0 ? pct(doneN / mine.length) : '산정 불가', '조치 완료 ÷ 맡은 민원'],
    ['평균 처리 기간', avgDays === null ? '자료 없음' : `${avgDays.toFixed(1)}일`, '접수부터 조치 완료까지'],
    ['받은 이관', `${gotN}회`, `수락 대기 ${incoming.length}건`],
    ['보낸 이관', `${sentN}회`],
    ['재발', `${recurN}건`, '조치 뒤 다시 신고된 건'],
  ]

  return (
    <div className="adm-sec adm-dept">
      <section className="rf-card adm-dept-sec" aria-labelledby="dept-card-h">
        <h3 id="dept-card-h">{agency.name}</h3>
        {!agency.verified && <p className="ps-flag">소관 확인 필요 · 이 부서의 소관은 아직 확인 중인 자료예요.</p>}
        <dl className="adm-dept-dl">
          <dt>소속</dt>
          <dd>
            {isTodo(agency.department) ? '확인 필요' : agency.department} ({agency.level})
          </dd>
          <dt>소관 유형</dt>
          <dd>{agency.types.join(', ') || '확인 필요'}</dd>
          <dt>위치 종류</dt>
          <dd>{agency.locationKinds.join(', ') || '확인 필요'}</dd>
          <dt>근거 법령</dt>
          <dd>
            {law.length > 0 && (
              <ul>
                {law.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {hasTodoLaw(agency) && <span className="bm-meta">{law.length > 0 ? '일부 조문은 확인 필요' : '확인 필요'}</span>}
          </dd>
        </dl>
      </section>

      <section className="rf-card adm-dept-sec" aria-labelledby="dept-kpi-h">
        <h3 id="dept-kpi-h">처리 현황</h3>
        <div className="adm-kpis adm-dept-kpis">
          {kpis.map(([label, value, sub]) => (
            <div key={label} className="rf-card">
              <span className="bm-meta">{label}</span>
              <strong>{value}</strong>
              {sub && <span className="bm-meta adm-dept-sub">{sub}</span>}
            </div>
          ))}
        </div>
        <span className="bm-meta">
          다른 기관과 처리율·이관 횟수를 비교하려면{' '}
          <button type="button" className="adm-link" onClick={onGoDash}>
            지역 현황
          </button>
          을 보세요.
        </span>
      </section>

      <section className="rf-card adm-dept-sec" aria-labelledby="dept-todo-h">
        <h3 id="dept-todo-h">오늘 할 일 ({tasks.length})</h3>
        {tasks.length === 0 ? (
          <p className="rp-empty">지금 처리할 민원이 없어요.</p>
        ) : (
          GROUPS.map((g) => {
            const list = tasks.filter((t) => t.group === g)
            if (list.length === 0) return null
            return (
              <div key={g} className="adm-dept-group">
                <h4>
                  {g} ({list.length})
                </h4>
                <ul className="rp-list">{list.map((t) => caseRow(t.r, t.note))}</ul>
              </div>
            )
          })
        )}
        <span className="bm-meta">기한 경과, 기한 임박({DEADLINE_SOON_DAYS}일 이내), 신규, 처리 중 순서예요. 누르면 민원 상세가 열려요. 이관을 보내고 답을 기다리는 건은 빠져 있어요.</span>
      </section>

      <section className="rf-card adm-dept-sec" aria-labelledby="dept-in-h">
        <h3 id="dept-in-h">받은 이관 요청 ({incoming.length})</h3>
        {incoming.length === 0 ? (
          <p className="rp-empty">수락을 기다리는 이관 요청이 없어요.</p>
        ) : (
          <ul className="rp-list">
            {incoming.map((r) =>
              caseRow(
                r,
                '',
                officer ? (
                  <span className="adm-actions">
                    <button type="button" className="rf-primary" onClick={() => decideTransfer(r.id, true)}>
                      수락
                    </button>
                    <button type="button" onClick={() => decideTransfer(r.id, false)}>
                      반려
                    </button>
                  </span>
                ) : undefined,
              ),
            )}
          </ul>
        )}
        {incoming.length > 0 && !officer && <span className="bm-meta">수락·반려는 담당 공무원만 할 수 있어요. 시연 도구에서 담당 공무원으로 바꾸면 쓸 수 있어요.</span>}
      </section>

      <section className="rf-card adm-dept-sec" aria-labelledby="dept-plan-h">
        <h3 id="dept-plan-h">소관 지점의 개선계획 ({plan.length})</h3>
        {err && <p className="rf-warn">{err}</p>}
        {!data && !err && <p className="bm-meta">이용 수요 자료를 불러오고 있어요…</p>}
        {data && plan.length === 0 && <p className="rp-empty">이 부서 소관으로 확실한 지점이 아직 없어요.</p>}
        {planShown.length > 0 && (
          <ol className="adm-dept-plan">
            {planShown.map((c, i) => {
              const e = entryOf(entries, c.pt.key)
              const st = RATING_STYLE[c.pt.rating]
              return (
                <li key={c.pt.key} className="adm-dept-pt">
                  <span className="adm-no">{i + 1}</span>
                  <span className="adm-prio-name">
                    {c.pt.label}
                    <span className="bm-meta">
                      {e.stage}
                      {e.program ? ` · ${e.program}` : ''}
                      {e.amount !== null ? ` · ${won(e.amount)}원` : ''}
                      {e.year !== null ? ` · ${e.year}년` : ''}
                    </span>
                  </span>
                  <span className="adm-rate" style={{ background: st.color, color: st.ink }} title={st.label}>
                    {st.glyph}
                  </span>
                  <b>{c.score}점</b>
                </li>
              )
            })}
          </ol>
        )}
        <div className="adm-plan-tools">
          {plan.length > PLAN_PREVIEW && (
            <button type="button" onClick={() => setMore((v) => !v)}>
              {more ? '접기' : `나머지 ${plan.length - PLAN_PREVIEW}곳 더 보기`}
            </button>
          )}
          <button type="button" onClick={onGoPlan}>
            개선계획·예산에서 입력하기
          </button>
        </div>
        <span className="bm-meta">소관이 확실한 지점만 보여요. 접수된 민원이 있거나 지점 종류로 소관이 하나로 정해지는 지점만 넣고, 불확실한 지점은 뺐어요. 순위는 우선순위(안) 점수 순이에요.</span>
      </section>
    </div>
  )
}
