import { PERIODS, PROGRESS_INFO, PROGRESS_ORDER, type PeriodId, type ProgressItem, type ProgressStage, type ProgressSummary } from '../lib/progress'
import { fmtDate, pct } from '../lib/caseMetrics'

type Props = {
  items: ProgressItem[]
  summary: ProgressSummary
  period: PeriodId
  onPeriod: (p: PeriodId) => void
  stages: ProgressStage[]
  onToggleStage: (s: ProgressStage) => void
  onPick: (it: ProgressItem) => void
  onShowMap: () => void
  onExit: () => void
}

const LIST_MAX = 60

export default function ProgressPanel({ items, summary: sm, period, onPeriod, stages, onToggleStage, onPick, onShowMap, onExit }: Props) {
  const shown = items.filter((i) => stages.includes(i.stage))
  const stat = (label: string, value: string, tone = '') => (
    <div className={'pgp-stat' + (tone ? ' ' + tone : '')}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
  return (
    <div className="rp pgp" role="dialog" aria-label="개선 현황">
      <div className="rf-head">
        <h2>개선 현황</h2>
        <button type="button" className="bm-close" onClick={onShowMap}>
          지도 보기
        </button>
      </div>

      <div className="rf-seg" role="group" aria-label="기간 (최근 30일, 90일, 1년, 전체)">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" className={period === p.id ? 'on' : ''} aria-pressed={period === p.id} onClick={() => onPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <section className="pgp-sum" aria-label="요약">
        <div className="pgp-stats">
          {stat('접수된 제보', `${sm.received}건`)}
          {stat('기관 처리 중', `${sm.inProgress}건`)}
          {stat('조치 완료(재확인 포함)', `${sm.done}건`)}
          {stat('기한 지남', `${sm.overdue}건`, sm.overdue > 0 ? 'is-warn' : '')}
        </div>
        <div className="pgp-rate">
          <span>개선율</span>
          <strong>{pct(sm.rate)}</strong>
          <small>
            = (조치 완료 + 재확인 완료) ÷ 기관에 접수된 건{sm.rate !== null ? ` (${sm.done} ÷ ${sm.filed})` : ''}
          </small>
        </div>
        <p className="bm-meta">
          평균 처리 기간 {sm.avgDays === null ? '아직 자료가 없어요' : `${sm.avgDays.toFixed(1)}일`} · 개선계획 반영 {sm.planCount}곳(기간과 상관없이 늘 보여요)
        </p>
        <p className="bm-meta">제보는 접수일을 기준으로 기간을 나눠요. 반려되거나 다른 제보에 합쳐진 건은 세지 않아요.</p>
      </section>

      <div className="pgp-chips" role="group" aria-label="단계 고르기">
        {PROGRESS_ORDER.map((s) => (
          <button key={s} type="button" className={'pgp-chip pg-' + s} aria-pressed={stages.includes(s)} onClick={() => onToggleStage(s)}>
            <i aria-hidden="true">{PROGRESS_INFO[s].glyph}</i>
            {PROGRESS_INFO[s].label} {sm.counts[s]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rp-empty">고른 단계와 기간에 맞는 곳이 아직 없어요.</p>
      ) : (
        <ul className="rp-list pgp-list" aria-label="최근 순 목록">
          {shown.slice(0, LIST_MAX).map((it) => (
            <li key={it.key}>
              <button type="button" className="rp-row pgp-row" onClick={() => onPick(it)}>
                <span className="rp-row-text">
                  <strong>{it.title}</strong>
                  <span className="bm-meta">
                    {it.sub}
                    {it.at > 0 && ` · ${fmtDate(it.at)}`}
                  </span>
                </span>
                <span className={'pgp-tag pg-' + it.stage}>
                  <i aria-hidden="true">{PROGRESS_INFO[it.stage].glyph}</i>
                  {PROGRESS_INFO[it.stage].label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length > LIST_MAX && <p className="bm-meta">최근 {LIST_MAX}곳만 보여요.</p>}

      <button type="button" className="pgp-exit" onClick={onExit}>
        개선 현황 보기 끝내기
      </button>
    </div>
  )
}
