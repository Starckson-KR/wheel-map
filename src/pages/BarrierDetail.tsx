import BusArrivals from '../components/BusArrivals'
import PhotoGallery from '../components/PhotoGallery'
import { PILOT_STOPS } from '../lib/bus/data.ts'
import SheetHandle from '../components/SheetHandle'
import { RATING_STYLE } from '../lib/rating'
import { IMPACT_INFO, impactLine, impactOf, shortName } from '../lib/display'
import { useState } from 'react'
import { REPORT_LOCATION_CHOICES, guessLocationKind } from '../lib/agencyGuide'
import { REPORT_TYPES } from '../lib/reportTypes'
import { usePlan } from '../lib/planStore'
import { PHOTOS_VISIBLE, photosFor } from '../lib/photos'
import { publicIssue } from '../lib/displayText'
import { STATUS_LABEL, useReports, userName } from '../lib/reportStore'
import type { Barrier, Rating, Report } from '../types'

type Props = {
  barrier: Barrier
  parent: Barrier | null
  subItems: Barrier[]
  onSelect: (id: string) => void
  onClose: () => void
  mergedReports?: Report[]
  onOpenReport?: (id: string) => void
  flowReport?: Report
  overrideRating?: Rating | null
  onStartFlow?: (type: string, kind: string) => void
}

export default function BarrierDetail({ barrier: b, parent, subItems, onSelect, onClose, mergedReports = [], onOpenReport, flowReport, overrideRating, onStartFlow }: Props) {
  const [flowType, setFlowType] = useState(b.reportType ?? '')
  const [flowKind, setFlowKind] = useState(guessLocationKind(b.type))
  const [open, setOpen] = useState(false) // 낮은 시트(기본) ↔ 펼친 시트
  const [flowOpen, setFlowOpen] = useState(false)
  const plan = usePlan((s) => s.entries[b.id])
  const me = useReports((s) => s.userId)
  const own = overrideRating !== undefined ? (overrideRating ?? undefined) : b.rating
  const inherited = !own && parent?.rating ? parent.rating : undefined
  const rating = own ?? inherited
  const style = RATING_STYLE[rating ?? 'none']
  const impact = impactOf(b, parent)
  const issue = publicIssue(b.issue) // 팀 내부 메모는 표시 단계에서 걸러 낸다
  const showPhotos = PHOTOS_VISIBLE && photosFor(b.id).length > 0
  // 7단계: 시범 정류장은 실제 BIS 정류소와 짝지어 둔 것이 있으면 저상버스 도착 정보를 보여 준다(없으면 이 구역은 나오지 않음)
  const stopEntry = PILOT_STOPS.items[b.id]

  return (
    <aside className={'bm-detail' + (open ? '' : ' bm-low')} data-sheet aria-label="지점 상세">
      <SheetHandle onDown={open ? () => setOpen(false) : onClose} onUp={() => setOpen(true)} expanded={open} onToggle={() => setOpen((o) => !o)} exit={!open} />
      <div className="bm-detail-head">
        <h2 className="bm-verdict">
          <span className="bm-badge" style={{ background: style.color, color: style.ink }}>
            {style.label}
          </span>
          {shortName(b.id, b.name)}
        </h2>
        <button type="button" className="bm-close" onClick={onClose} aria-label="닫기">
          닫기
        </button>
      </div>

      {showPhotos && (
        <div className="bm-shot">
          <PhotoGallery key={b.id} barrierId={b.id} />
        </div>
      )}

      <p className="bm-impact">
        <i className="hm-cat">{IMPACT_INFO[impact].glyph}</i>
        {impactLine(impact, rating ?? 'none')}
        {inherited && parent && <span className="bm-meta">상위 항목 평가</span>}
      </p>
      {issue && <p className="bm-issue">{issue}</p>}

      {onStartFlow && flowReport && (
        <div className="bm-act">
          <button type="button" className="rf-primary" onClick={() => onOpenReport?.(flowReport.id)}>
            진행 상황 보기 · {STATUS_LABEL[flowReport.status]}
          </button>
        </div>
      )}
      {onStartFlow && !flowReport && b.geometry && (
        <div className="bm-act">
          <button type="button" className={flowOpen ? '' : 'rf-primary'} aria-expanded={flowOpen} aria-controls="bm-flow-form" onClick={() => { setFlowOpen((o) => !o); setOpen(true) }}>
            이 지점 제보하기
          </button>
          {flowOpen && (
            <div className="rf-card" id="bm-flow-form">
              <label className="rf-field">
                어떤 문제인가요?
                <select value={flowType} onChange={(e) => setFlowType(e.target.value)}>
                  <option value="">골라 주세요</option>
                  {REPORT_TYPES.map((t) => (
                    <option key={t.type}>{t.type}</option>
                  ))}
                </select>
              </label>
              <label className="rf-field">
                어떤 곳인가요?
                <select value={flowKind} onChange={(e) => setFlowKind(e.target.value)}>
                  <option value="">골라 주세요</option>
                  {REPORT_LOCATION_CHOICES.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="rf-primary" disabled={!flowType || !flowKind} onClick={() => onStartFlow(flowType, flowKind)}>
                제보 시작하기
              </button>
            </div>
          )}
        </div>
      )}

      {plan && plan.stage !== '미반영' && (
        <p className="bm-plan" role="note">
          개선계획: {plan.stage}
          {plan.year ? ` · ${plan.year}년` : ''}
        </p>
      )}

      {stopEntry && (
        <section className="bus-sec" aria-label="저상버스 도착 정보">
          <BusArrivals
            key={b.id}
            choices={stopEntry.matches.map((m) => ({ stationId: m.stationId, name: m.name, next: m.next }))}
            listClosed
          />
        </section>
      )}

      {b.measurements.length > 0 && (
        <dl>
          <dt>직접 잰 값</dt>
          <dd>
            <ul>
              {b.measurements.map((m) => (
                <li key={m.label}>
                  {m.label}: {m.value}
                </li>
              ))}
            </ul>
          </dd>
        </dl>
      )}

      {mergedReports.length > 0 && (
        <div>
          <strong>합쳐진 시민 제보 {mergedReports.length}건</strong>
          <ul className="lr-list bm-children">
            {mergedReports.map((m) => (
              <li key={m.id}>
                <button type="button" className="lr" onClick={() => onOpenReport?.(m.id)}>
                  <span className="lr-main">
                    <span className="lr-title">
                      {m.userId === me ? userName(m.userId) : '이웃 제보'} · {m.type}
                    </span>
                    <span className="lr-sub">{m.description}</span>
                  </span>
                  <span className="lr-chev" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {parent && (
        <div>
          <strong>상위 항목</strong>
          <ul className="lr-list bm-children">
            <li>
              <button type="button" className="lr" onClick={() => onSelect(parent.id)}>
                <span className="lr-main">
                  <span className="lr-title">
                    {shortName(parent.id, parent.name)}
                  </span>
                </span>
                <span className="lr-chev" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </div>
      )}
      {subItems.length > 0 && (
        <div>
          <strong>하위 항목</strong>
          <ul className="lr-list bm-children">
            {subItems.map((c) => (
              <li key={c.id}>
                <button type="button" className="lr" onClick={() => onSelect(c.id)}>
                  <span className="lr-main">
                    <span className="lr-title">
                      {shortName(c.id, c.name)}
                    </span>
                  </span>
                  <span className="lr-chev" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
