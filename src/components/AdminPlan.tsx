import { useEffect, useMemo, useState } from 'react'
import { buildCsv, csvFileName, type CsvRow } from '../lib/planCsv'
import { STAGES, entryOf, usePlan, type Stage } from '../lib/planStore'
import { agencyNameOf, type Cand } from '../lib/priority'
import { RATING_STYLE } from '../lib/rating'
import { dongKey, loadDongs } from '../lib/regions'
import { nowMs, useReports } from '../lib/reportStore'
import { usePriority } from '../lib/usePriority'
import type { Barrier } from '../types'

const PROGRAM_EXAMPLES = ['교통약자 이동편의 증진계획', '보도 정비사업', '장애인 편의시설 개선'] // 예시일 뿐 입력을 제한하지 않는다
type Filter = 'all' | Stage
type Row = { c: Cand; rank: number; dong: string }

const won = (n: number) => n.toLocaleString('ko-KR')
const nameOf = (c: Cand) => c.pt.seed?.name ?? c.pt.label

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function AdminPlan({ barriers }: { barriers: Barrier[] }) {
  const reports = useReports((s) => s.reports)
  const entries = usePlan((s) => s.entries)
  const storageError = usePlan((s) => s.storageError)
  const patch = usePlan((s) => s.patch)
  const setStageMany = usePlan((s) => s.setStageMany)
  const { rows: cands, data, err } = usePriority(barriers)
  const [filter, setFilter] = useState<Filter>('all')
  const [dongs, setDongs] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    if (cands.length === 0) return
    let cancelled = false
    loadDongs(cands.map((c) => ({ lat: c.pt.lat, lng: c.pt.lng })))
      .then((d) => !cancelled && setDongs(d))
      .catch(() => !cancelled && setDongs({}))
    return () => {
      cancelled = true
    }
  }, [cands])

  const rows = useMemo<Row[]>(() => cands.map((c, i) => ({ c, rank: i + 1, dong: dongs ? (dongs[dongKey(c.pt.lat, c.pt.lng)] ?? '') : '' })), [cands, dongs])
  const shown = filter === 'all' ? rows : rows.filter((r) => entryOf(entries, r.c.pt.key).stage === filter)

  const count = (s: Stage) => rows.filter((r) => entryOf(entries, r.c.pt.key).stage === s).length
  const withAmount = rows.map((r) => entryOf(entries, r.c.pt.key).amount).filter((a): a is number => a !== null)
  const total = withAmount.reduce((s, a) => s + a, 0)

  const top5 = rows.slice(0, 5)
  const top5Todo = top5.filter((r) => entryOf(entries, r.c.pt.key).stage === '미반영')

  const exportCsv = (list: Row[]) => {
    const body: CsvRow[] = list.map(({ c, rank, dong }) => {
      const e = entryOf(entries, c.pt.key)
      return [
        rank,
        c.pt.key,
        nameOf(c),
        dong,
        RATING_STYLE[c.pt.rating].label,
        c.score,
        c.reportsN,
        c.bus,
        c.fac,
        c.alt ? '대안 없음 기록' : '기록 없음',
        e.stage,
        e.program,
        e.budgetItem,
        e.amount,
        e.year,
        e.memo,
        agencyNameOf(c.pt, reports),
      ]
    })
    download(buildCsv(body), csvFileName())
  }

  const thisYear = new Date(nowMs()).getFullYear()
  const yearOptions = (cur: number | null) => {
    const ys = Array.from({ length: 9 }, (_, i) => thisYear + i)
    return cur !== null && !ys.includes(cur) ? [cur, ...ys] : ys
  }

  return (
    <div className="adm-sec">
      <section className="rf-card">
        <h3>개선계획·예산 연결</h3>
        <p className="bm-meta">금액과 사업은 담당자가 입력해요. 앱이 금액을 정하지 않아요. 순위는 우선순위(안) 점수가 높은 순이고, 위치가 확정되지 않은 지점은 빠져 있어요. 입력한 내용은 이 브라우저에만 저장돼요.</p>
        {storageError && <p className="rf-warn">{storageError}</p>}
        {err && <p className="rf-warn">{err}</p>}
        {!data && !err && <p className="bm-meta">이용 수요 자료를 불러오고 있어요…</p>}
        <div className="adm-kpis">
          {STAGES.map((s) => (
            <div key={s} className="rf-card">
              <span className="bm-meta">{s}</span>
              <strong>{count(s)}곳</strong>
            </div>
          ))}
          <div className="rf-card adm-plan-total">
            <span className="bm-meta">입력된 금액 합계</span>
            <strong>{won(total)}원</strong>
            <span className="bm-meta">금액이 입력된 {withAmount.length}곳만 더했어요</span>
          </div>
        </div>
      </section>

      <section className="rf-card">
        <div className="rp-tabs" role="tablist" aria-label="반영 단계 보기">
          {(['all', ...STAGES] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? `전체 (${rows.length})` : `${f} (${count(f)})`}
            </button>
          ))}
        </div>
        <div className="adm-plan-tools">
          <button type="button" className="rf-primary" disabled={top5Todo.length === 0} onClick={() => setStageMany(top5Todo.map((r) => r.c.pt.key), '검토')}>
            상위 5곳 중 미반영 {top5Todo.length}곳을 검토로
          </button>
          {filter !== 'all' && (
            <button type="button" disabled={shown.length === 0} onClick={() => exportCsv(shown)}>
              '{filter}' {shown.length}곳만 CSV로 내보내기
            </button>
          )}
          <button type="button" disabled={rows.length === 0} onClick={() => exportCsv(rows)}>
            전체 {rows.length}곳 CSV로 내보내기
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="rp-empty">{rows.length === 0 ? '표시할 지점이 없어요.' : `'${filter}' 단계인 지점이 없어요.`}</p>
        ) : (
          <ul className="adm-plan-list">
            {shown.map(({ c, rank, dong }) => {
              const key = c.pt.key
              const e = entryOf(entries, key)
              const st = RATING_STYLE[c.pt.rating]
              const id = `plan-${key}`
              return (
                <li key={key} className="adm-plan-item">
                  <div className="adm-plan-head">
                    <span className="adm-no">{rank}</span>
                    <span className="adm-prio-name">
                      {c.pt.label}
                      <span className="bm-meta">
                        {dong ? `${dong} · ` : ''}제보 {c.reportsN} · 정류장 {c.bus} · 시설 {c.fac}
                      </span>
                    </span>
                    <span className="adm-rate" style={{ background: st.color, color: st.ink }} title={st.label}>
                      {st.glyph}
                    </span>
                    <b>{c.score}점</b>
                  </div>
                  <div className="adm-plan-grid">
                    <label className="rf-field" htmlFor={`${id}-stage`}>
                      반영 단계
                      <select id={`${id}-stage`} value={e.stage} onChange={(ev) => patch(key, { stage: ev.target.value as Stage })}>
                        {STAGES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label className="rf-field" htmlFor={`${id}-program`}>
                      연결 사업
                      <input id={`${id}-program`} type="text" list="plan-programs" value={e.program} onChange={(ev) => patch(key, { program: ev.target.value })} />
                    </label>
                    <label className="rf-field" htmlFor={`${id}-item`}>
                      세부 예산 항목
                      <input id={`${id}-item`} type="text" value={e.budgetItem} onChange={(ev) => patch(key, { budgetItem: ev.target.value })} />
                    </label>
                    <label className="rf-field" htmlFor={`${id}-amount`}>
                      금액(원)
                      <input
                        id={`${id}-amount`}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={e.amount === null ? '' : won(e.amount)}
                        onChange={(ev) => {
                          const d = ev.target.value.replace(/\D/g, '')
                          if (d.length > 15) return
                          patch(key, { amount: d ? Number(d) : null })
                        }}
                      />
                    </label>
                    <label className="rf-field" htmlFor={`${id}-year`}>
                      반영 연도
                      <select id={`${id}-year`} value={e.year ?? ''} onChange={(ev) => patch(key, { year: ev.target.value ? Number(ev.target.value) : null })}>
                        <option value="">정하지 않음</option>
                        {yearOptions(e.year).map((y) => (
                          <option key={y} value={y}>
                            {y}년
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rf-field adm-plan-memo" htmlFor={`${id}-memo`}>
                      메모
                      <textarea id={`${id}-memo`} rows={2} value={e.memo} onChange={(ev) => patch(key, { memo: ev.target.value })} />
                    </label>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <datalist id="plan-programs">
          {PROGRAM_EXAMPLES.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <span className="bm-meta">
          시민 화면에는 반영 단계와 연도만 보이고 금액·사업명은 보이지 않아요. 담당 기관은 CSV에만 들어가며, 접수된 민원이 있거나 소관이 하나로 정해지는 지점만 채워요.
        </span>
      </section>
    </div>
  )
}
